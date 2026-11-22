import type { AppEnv } from '../config/env';
import {
  appendMessage,
  getRecentMessages,
  getUserSettings,
  listMemories,
  pruneOldMessages,
} from '../db/queries';
import type { MemoryRow, MessageRow } from '../db/types';
import { createLLMProvider } from '../llm/factory';
import type { ChatMessage, ToolCall } from '../llm/types';
import type { TelegramClient } from '../telegram/client';
import type { InlineKeyboardButton } from '../telegram/types';
import { executeTool, getToolDefinitions } from '../tools/registry';

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_WINDOW = 14;

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
): string {
  const memoryBlock =
    memories.length > 0
      ? memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')
      : '(пока пусто)';

  return [
    'You are Engram, a loyal, intelligent, and slightly witty personal AI assistant in the spirit of Jarvis.',
    'Communicate naturally and warmly, like a sharp personal butler and chief of staff — polite, calm, attentive, and concise, without robotic boilerplate or emojis.',
    'Always reply in the same language as the user (usually Russian).',
    `Current local date & time: ${formatCurrentDateTimeWithOffset(timezone)}`,
    `User timezone: ${timezone}`,
    '',
    'Known facts about the user (long-term memory):',
    memoryBlock,
    '',
    'Guidelines:',
    '- Act autonomously with tools whenever the user implies an action: saving ideas/links/notes, searching past notes, scheduling or managing reminders, remembering personal facts, or reading a URL.',
    '- Proactively call remember_fact when the user mentions stable personal details, projects, preferences, or habits worth keeping.',
    '- When the user asks about past notes or saved information, call search_notes or list_recent_notes first instead of guessing.',
    '- When creating a reminder, convert relative dates like "завтра в 10:00" or "через 30 минут" accurately using the current local date & time above.',
    '- Keep replies natural, clear, and to the point.',
  ].join('\n');
}

function hydrateHistory(rows: MessageRow[]): ChatMessage[] {
  return rows.map((row) => {
    let toolCalls: ToolCall[] | undefined;
    if (row.tool_calls_json) {
      try {
        toolCalls = JSON.parse(row.tool_calls_json) as ToolCall[];
      } catch {
        toolCalls = undefined;
      }
    }

    return {
      role: row.role,
      content: row.content,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
      ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
    };
  });
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

  const [settings, memories, historyRows] = await Promise.all([
    getUserSettings(env.DB, userId),
    listMemories(env.DB, userId),
    getRecentMessages(env.DB, chatId, HISTORY_WINDOW),
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
    { role: 'system', content: buildSystemPrompt(timezone, memories) },
    ...hydrateHistory(historyRows),
    { role: 'user', content: userText },
  ];

  let finalText = '';
  let lastSavedNoteId: number | null = null;
  let touchedNotes = false;
  let touchedReminders = false;

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    await telegram.sendChatAction(chatId, 'typing');

    const response = await llm.chat(conversation, tools);

    if (response.toolCalls.length === 0) {
      finalText = response.content;
      break;
    }

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: response.content || '',
      tool_calls: response.toolCalls,
    };
    conversation.push(assistantMsg);

    await appendMessage(env.DB, {
      chatId,
      role: 'assistant',
      content: assistantMsg.content,
      toolCallsJson: JSON.stringify(response.toolCalls),
    });

    for (const tc of response.toolCalls) {
      const toolOutput = await executeTool(tc.name, tc.arguments, {
        db: env.DB,
        userId,
        chatId,
        timezone,
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
    const fallback = await llm.chat(conversation, []);
    finalText =
      fallback.content ||
      'Действия выполнены, но модель не сформировала текстовый ответ.';
  }

  await appendMessage(env.DB, {
    chatId,
    role: 'assistant',
    content: finalText,
  });

  await pruneOldMessages(env.DB, chatId, 60);

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

  await telegram.sendMessage(
    chatId,
    finalText,
    actionRow.length > 0
      ? { replyMarkup: { inline_keyboard: [actionRow] } }
      : undefined,
  );
}
