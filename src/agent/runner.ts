import type { AppEnv } from '../config/env';
import {
  appendMessage,
  getChatSummary,
  getRecentMessages,
  getUserSettings,
  listMemories,
} from '../db/queries';
import type { MemoryRow, MessageRow } from '../db/types';
import { createLLMProvider } from '../llm/factory';
import type { ChatMessage, ToolCall } from '../llm/types';
import type { TelegramClient } from '../telegram/client';
import { markdownToTelegramHtml } from '../telegram/format';
import type { InlineKeyboardButton } from '../telegram/types';
import { executeTool, getToolDefinitions } from '../tools/registry';
import { compactConversationIfNeeded } from './compaction';

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_WINDOW = 14;
const STREAM_EDIT_INTERVAL_MS = 1100;

const TOOL_STATUS_LABELS: Record<string, string> = {
  save_note: 'Сохраняю заметку...',
  search_notes: 'Ищу в заметках...',
  get_note: 'Читаю заметку...',
  update_note: 'Обновляю заметку...',
  delete_note: 'Удаляю заметку...',
  list_recent_notes: 'Просматриваю заметки...',
  create_reminder: 'Создаю напоминание...',
  list_reminders: 'Проверяю напоминания...',
  complete_reminder: 'Отмечаю напоминание выполненным...',
  delete_reminder: 'Удаляю напоминание...',
  add_to_list: 'Обновляю список...',
  get_list: 'Проверяю списки...',
  toggle_list_item: 'Обновляю список...',
  remove_list_item: 'Обновляю список...',
  search_past_conversations: 'Ищу в архиве диалогов...',
  fetch_url: 'Читаю страницу по ссылке...',
};

const SILENT_TOOLS = new Set(['remember_fact', 'forget_fact']);

function formatCurrentDateTimeWithOffset(timezone: string): string {
  const now = new Date();
  try {
    const formatted = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    const tzPart =
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';

    return `${formatted} (${timezone}, ${tzPart})`;
  } catch {
    return now.toISOString();
  }
}

export function buildSystemPrompt(
  timezone: string,
  memories: MemoryRow[],
  rollingSummary?: string | null,
): string {
  const memoryBlock =
    memories.length > 0
      ? memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')
      : '(пока пусто)';

  const summarySection = rollingSummary
    ? `\n<recent_summary>\n${rollingSummary}\n</recent_summary>\n`
    : '';

  return [
    '<role>',
    'You are Engram, a concise, sharp, and natural personal AI assistant in Telegram.',
    'Reply in the same language as the user (usually Russian).',
    'Match response length to the message: 1-2 short sentences for greetings, small talk, or confirmations; detailed structured answers only when the task requires depth.',
    'Do not use emojis in routine replies; use at most 1-2 only when clearly marking a status or genuine emotion.',
    '</role>',
    '',
    '<context>',
    `Current local date & time: ${formatCurrentDateTimeWithOffset(timezone)}`,
    `User timezone: ${timezone}`,
    '</context>',
    '',
    '<capabilities>',
    '- Notes & Knowledge Base: save, edit, delete, and search notes (keyword + semantic search), plus Markdown export via /export or /menu.',
    '- Reminders & Daily Briefing: one-time and recurring reminders, plus an optional daily summary at a chosen hour in /menu -> Настройки.',
    '- Interactive Checklists: manage named lists (shopping, movies, todos) with clickable checkboxes via chat or /lists.',
    '- Memory & Archive: silently remember personal facts and search past conversation summaries.',
    '- Multimodal & Web: understand voice messages, photos/screenshots, forwarded posts/messages, and read web links.',
    '</capabilities>',
    '',
    '<long_term_memory>',
    memoryBlock,
    '</long_term_memory>',
    summarySection,
    '<rules>',
    '- Do not call any tool for greetings, small talk, jokes, or general knowledge questions.',
    '- Separate personal facts, notes, and checklists automatically without asking for special commands:',
    '  * Personal facts (preferences, projects, habits, names, roles, goals) -> silently call remember_fact.',
    '  * Ideas, links, summaries, code, or reference info -> save with save_note.',
    '  * Shopping items, movies, books, or quick todo items -> use add_to_list / get_list / toggle_list_item.',
    '- Casual remarks or slang (e.g. "по факту", "жиза", "ок") are normal conversation, not a request to save data.',
    '- Never invent missing tool parameters; ask a brief clarifying question or search first.',
    '- When asked about saved notes or older conversations, call search_notes or search_past_conversations instead of guessing.',
    '- For reminders, convert relative dates accurately using the current local date & time.',
    '- Never mention internal tool or parameter names in your reply.',
    '- Format replies with clean Markdown (**bold**, bullet lists, > quotes, `code`).',
    '</rules>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function hydrateHistory(rows: MessageRow[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let expectedToolCallId: string | null = null;

  for (const row of rows) {
    if (row.role === 'tool') {
      if (expectedToolCallId && row.tool_call_id === expectedToolCallId) {
        result.push({
          role: 'tool',
          content: row.content,
          tool_call_id: row.tool_call_id,
        });
        expectedToolCallId = null;
      }
      continue;
    }

    // If previous assistant tool_call has no matching tool response, drop it
    if (expectedToolCallId) {
      result.pop();
      expectedToolCallId = null;
    }

    if (row.role === 'assistant' && row.tool_calls_json) {
      try {
        const parsed = JSON.parse(row.tool_calls_json) as ToolCall[];
        const firstCall = parsed[0];
        if (firstCall) {
          result.push({
            role: 'assistant',
            content: row.content,
            tool_calls: [firstCall],
          });
          expectedToolCallId = firstCall.id;
          continue;
        }
      } catch {
        // Fall through as plain assistant message
      }
    }

    result.push({
      role: row.role,
      content: row.content,
    });
  }

  if (expectedToolCallId) {
    result.pop();
  }

  return result;
}

export async function runAgentTurn(params: {
  env: AppEnv;
  telegram: TelegramClient;
  userId: number;
  chatId: number;
  userText: string;
}): Promise<void> {
  const { env, telegram, userId, chatId, userText } = params;

  await telegram.sendChatAction(chatId, 'typing');

  const [settings, memories, historyRows, chatSummary] = await Promise.all([
    getUserSettings(env.DB, userId),
    listMemories(env.DB, userId),
    getRecentMessages(env.DB, chatId, HISTORY_WINDOW),
    getChatSummary(env.DB, chatId),
  ]);

  const timezone = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';
  const llm = createLLMProvider(env, settings?.model_override);
  const tools = getToolDefinitions();

  await appendMessage(env.DB, {
    chatId,
    role: 'user',
    content: userText,
  });

  const conversation: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(timezone, memories, chatSummary?.summary),
    },
    ...hydrateHistory(historyRows),
    { role: 'user', content: userText },
  ];

  const statusMessageId = await telegram
    .sendMessage(chatId, 'Думаю...')
    .catch(() => 0);

  let lastEditAt = 0;
  let lastEditedText = 'Думаю...';

  const updatePlaceholder = async (text: string, force = false) => {
    if (!statusMessageId) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed === lastEditedText) return;
    const now = Date.now();
    if (!force && now - lastEditAt < STREAM_EDIT_INTERVAL_MS) return;

    lastEditAt = now;
    lastEditedText = trimmed;
    const preview =
      trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}...` : trimmed;
    await telegram
      .editMessageText(chatId, statusMessageId, markdownToTelegramHtml(preview), {
        parseMode: 'HTML',
      })
      .catch(() => undefined);
  };

  let finalText = '';
  let lastSavedNoteId: number | null = null;
  let touchedNotes = false;
  let touchedReminders = false;
  let touchedListName: string | null = null;
  let hasStreamedText = false;

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    await telegram.sendChatAction(chatId, 'typing');

    let response = llm.chatStream
      ? await llm.chatStream(conversation, tools, async (partial) => {
          if (partial.trim().length >= 8) {
            hasStreamedText = true;
            await updatePlaceholder(`${partial} ...`);
          }
        })
      : await llm.chat(conversation, tools);

    if (!response.content && response.toolCalls.length === 0 && llm.chatStream) {
      response = await llm.chat(conversation, tools);
    }

    if (response.toolCalls.length === 0) {
      finalText = response.content;
      break;
    }

    // Many Workers AI models only support one tool call per assistant turn
    const callsToRun = response.toolCalls.slice(0, 1);

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: response.content || '',
      tool_calls: callsToRun,
    };
    conversation.push(assistantMsg);

    await appendMessage(env.DB, {
      chatId,
      role: 'assistant',
      content: assistantMsg.content,
      toolCallsJson: JSON.stringify(callsToRun),
    });

    for (const tc of callsToRun) {
      if (!SILENT_TOOLS.has(tc.name) && !hasStreamedText) {
        const statusLabel =
          TOOL_STATUS_LABELS[tc.name] ?? `Выполняю ${tc.name}...`;
        await updatePlaceholder(statusLabel, true);
      }

      const toolOutput = await executeTool(tc.name, tc.arguments, {
        db: env.DB,
        userId,
        chatId,
        timezone,
        ai: env.AI,
        vectorize: env.VECTORIZE,
        embeddingModel: env.WORKERS_AI_EMBEDDING_MODEL,
      });

      if (tc.name === 'save_note' || tc.name === 'update_note') {
        touchedNotes = true;
        try {
          const parsed = JSON.parse(toolOutput) as { id?: number };
          if (typeof parsed.id === 'number') {
            lastSavedNoteId = parsed.id;
          }
        } catch {
          // ignore parse errors
        }
      } else if (tc.name === 'search_notes' || tc.name === 'list_recent_notes') {
        touchedNotes = true;
      } else if (
        tc.name === 'create_reminder' ||
        tc.name === 'list_reminders' ||
        tc.name === 'complete_reminder'
      ) {
        touchedReminders = true;
      } else if (
        tc.name === 'add_to_list' ||
        tc.name === 'get_list' ||
        tc.name === 'toggle_list_item'
      ) {
        touchedListName =
          typeof tc.arguments.list_name === 'string' && tc.arguments.list_name.trim()
            ? tc.arguments.list_name.trim().toLowerCase()
            : '';
      }

      const toolMsg: ChatMessage = {
        role: 'tool',
        content: toolOutput,
        tool_call_id: tc.id,
        name: tc.name,
      };
      conversation.push(toolMsg);

      await appendMessage(env.DB, {
        chatId,
        role: 'tool',
        content: toolOutput,
        toolCallId: tc.id,
      });
    }
  }

  if (!finalText) {
    // Force one final summary response without tools if loop hit iteration cap
    const fallback = llm.chatStream
      ? await llm.chatStream(conversation, [], async (partial) => {
          if (partial.trim().length >= 8) {
            await updatePlaceholder(`${partial} ...`);
          }
        })
      : await llm.chat(conversation, []);
    finalText =
      fallback.content ||
      'Действия выполнены, но модель не сформировала текстовый ответ.';
  }

  await appendMessage(env.DB, {
    chatId,
    role: 'assistant',
    content: finalText,
  });

  const actionRow: InlineKeyboardButton[] = [];
  if (lastSavedNoteId !== null) {
    actionRow.push({
      text: `Открыть заметку #${lastSavedNoteId}`,
      callback_data: `note:view:${lastSavedNoteId}:0`,
    });
  } else if (touchedNotes) {
    actionRow.push({ text: 'Все заметки', callback_data: 'menu:notes:0' });
  }
  if (touchedReminders) {
    actionRow.push({
      text: 'Напоминания',
      callback_data: 'menu:rems:pending',
    });
  }
  if (touchedListName !== null) {
    actionRow.push({
      text: touchedListName ? `Список: ${touchedListName}` : 'Списки',
      callback_data: `menu:lists:${touchedListName}`,
    });
  }

  const formattedFinal = markdownToTelegramHtml(finalText);
  const replyOptions = {
    parseMode: 'HTML' as const,
    ...(actionRow.length > 0
      ? { replyMarkup: { inline_keyboard: [actionRow] } }
      : {}),
  };

  if (statusMessageId) {
    await telegram.editMessageText(
      chatId,
      statusMessageId,
      formattedFinal,
      replyOptions,
    );
  } else {
    await telegram.sendMessage(chatId, formattedFinal, replyOptions);
  }

  // Run background compaction after the reply is already delivered
  await compactConversationIfNeeded({
    env,
    userId,
    chatId,
    keepRecent: HISTORY_WINDOW,
    modelOverride: settings?.model_override,
  }).catch((err) => {
    console.error('Conversation compaction failed', err);
  });
}
