import type { AppEnv } from '../config/env';
import {
  createEpisode,
  deleteMessagesUpToId,
  getChatSummary,
  getMessagesForSummarization,
  upsertChatSummary,
  upsertMemory,
} from '../db/queries';
import type { MessageRow } from '../db/types';
import { createLLMProvider } from '../llm/factory';

const MIN_MESSAGES_TO_COMPACT = 6;
const MAX_TRANSCRIPT_CHARS = 5000;

export interface ExtractedFact {
  key: string;
  value: string;
}

export interface CompactionOutput {
  topic: string;
  episodeSummary: string;
  rollingSummary: string;
  facts: ExtractedFact[];
}

export function parseCompactionJson(raw: string): CompactionOutput {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      topic?: unknown;
      episode_summary?: unknown;
      rolling_summary?: unknown;
      facts?: unknown;
    };

    const topic =
      typeof parsed.topic === 'string' && parsed.topic.trim()
        ? parsed.topic.trim().slice(0, 120)
        : 'Диалог';
    const episodeSummary =
      typeof parsed.episode_summary === 'string' && parsed.episode_summary.trim()
        ? parsed.episode_summary.trim().slice(0, 1200)
        : cleaned.slice(0, 1200);
    const rollingSummary =
      typeof parsed.rolling_summary === 'string' && parsed.rolling_summary.trim()
        ? parsed.rolling_summary.trim().slice(0, 1500)
        : episodeSummary;

    const facts: ExtractedFact[] = [];
    if (Array.isArray(parsed.facts)) {
      for (const item of parsed.facts) {
        if (
          item &&
          typeof item === 'object' &&
          typeof (item as { key?: unknown }).key === 'string' &&
          typeof (item as { value?: unknown }).value === 'string'
        ) {
          const key = (item as { key: string }).key.trim().slice(0, 64);
          const value = (item as { value: string }).value.trim().slice(0, 300);
          if (key && value) {
            facts.push({ key, value });
          }
        }
      }
    }

    return { topic, episodeSummary, rollingSummary, facts };
  } catch {
    const fallback = cleaned.slice(0, 1200) || 'Краткая сводка разговора.';
    return {
      topic: 'Диалог',
      episodeSummary: fallback,
      rollingSummary: fallback,
      facts: [],
    };
  }
}

function formatMessagesForSummary(rows: MessageRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.role === 'tool') continue;
    const text = row.content.trim();
    if (!text) continue;
    const speaker = row.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${speaker}: ${text.slice(0, 500)}`);
  }

  const joined = lines.join('\n');
  return joined.length > MAX_TRANSCRIPT_CHARS
    ? joined.slice(0, MAX_TRANSCRIPT_CHARS)
    : joined;
}

export async function compactConversationIfNeeded(params: {
  env: AppEnv;
  userId: number;
  chatId: number;
  keepRecent: number;
  modelOverride?: string | null;
}): Promise<void> {
  const { env, userId, chatId, keepRecent, modelOverride } = params;

  const oldMessages = await getMessagesForSummarization(
    env.DB,
    chatId,
    keepRecent,
  );
  if (oldMessages.length < MIN_MESSAGES_TO_COMPACT) {
    return;
  }

  const transcript = formatMessagesForSummary(oldMessages);
  const maxMessageId = oldMessages[oldMessages.length - 1].id;

  if (!transcript) {
    await deleteMessagesUpToId(env.DB, chatId, maxMessageId);
    return;
  }

  const existingSummary = await getChatSummary(env.DB, chatId);
  const llm = createLLMProvider(env, modelOverride);

  const prompt = [
    'Summarize the conversation segment below into strict JSON with 4 keys (text in Russian):',
    '1. "topic": short 3-7 word title of what was discussed.',
    '2. "episode_summary": concise summary of this specific segment (key decisions, questions, facts, outcomes).',
    '3. "rolling_summary": updated combined summary merging the previous summary (if any) with this segment, up to 1200 characters.',
    '4. "facts": array of {"key": "snake_case_id", "value": "concise personal fact"} for any new durable personal facts about the user revealed in this segment (empty array [] if none).',
    '',
    existingSummary?.summary
      ? `Previous rolling summary:\n${existingSummary.summary}\n`
      : 'Previous rolling summary: (none)\n',
    `New messages to archive:\n${transcript}`,
    '',
    'Return ONLY valid JSON without markdown fences.',
  ].join('\n');

  const response = await llm.chat(
    [
      {
        role: 'system',
        content: 'You are a precise conversation summarizer that outputs valid JSON only.',
      },
      { role: 'user', content: prompt },
    ],
    [],
  );

  const parsed = parseCompactionJson(response.content);

  await Promise.all([
    createEpisode(env.DB, {
      chatId,
      userId,
      topic: parsed.topic,
      summary: parsed.episodeSummary,
    }),
    upsertChatSummary(env.DB, chatId, parsed.rollingSummary),
    ...parsed.facts.slice(0, 5).map((fact) =>
      upsertMemory(env.DB, userId, fact.key, fact.value),
    ),
  ]);

  await deleteMessagesUpToId(env.DB, chatId, maxMessageId);
}
