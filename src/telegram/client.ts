import type { InlineKeyboardMarkup } from './types';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;

export function splitTelegramMessage(
  text: string,
  maxLength = MAX_MESSAGE_LENGTH,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return ['(пустой ответ)'];
  if (trimmed.length <= maxLength) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < maxLength * 0.4) {
      splitAt = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitAt < maxLength * 0.4) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `${TELEGRAM_API_BASE}/bot${botToken}`;
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };

    if (!res.ok || !json.ok) {
      throw new Error(
        `Telegram API ${method} failed (${res.status}): ${json.description ?? 'unknown error'}`,
      );
    }
    return json.result as T;
  }

  async sendChatAction(
    chatId: number,
    action: 'typing' = 'typing',
  ): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action }).catch(
      () => undefined,
    );
  }

  async sendMessage(
    chatId: number,
    text: string,
    options?: {
      replyMarkup?: InlineKeyboardMarkup;
      parseMode?: 'HTML';
    },
  ): Promise<number> {
    const chunks = splitTelegramMessage(text);
    let lastMessageId = 0;

    for (let i = 0; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: chunks[i],
      };
      if (options?.parseMode) {
        payload.parse_mode = options.parseMode;
      }
      if (isLast && options?.replyMarkup) {
        payload.reply_markup = options.replyMarkup;
      }

      try {
        const result = await this.call<{ message_id: number }>(
          'sendMessage',
          payload,
        );
        lastMessageId = result.message_id;
      } catch (err) {
        if (!options?.parseMode) throw err;
        // Fallback to plain text if Telegram rejects HTML entities
        delete payload.parse_mode;
        const result = await this.call<{ message_id: number }>(
          'sendMessage',
          payload,
        );
        lastMessageId = result.message_id;
      }
    }

    return lastMessageId;
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options?: {
      replyMarkup?: InlineKeyboardMarkup;
      parseMode?: 'HTML';
    },
  ): Promise<void> {
    const chunks = splitTelegramMessage(text);
    const first = chunks[0];

    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: first,
    };
    if (options?.parseMode) {
      payload.parse_mode = options.parseMode;
    }
    if (chunks.length === 1 && options?.replyMarkup) {
      payload.reply_markup = options.replyMarkup;
    }

    try {
      await this.call('editMessageText', payload);
    } catch (err) {
      if (!options?.parseMode) throw err;
      delete payload.parse_mode;
      await this.call('editMessageText', payload);
    }

    for (let i = 1; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      await this.call('sendMessage', {
        chat_id: chatId,
        text: chunks[i],
        ...(isLast && options?.replyMarkup
          ? { reply_markup: options.replyMarkup }
          : {}),
      });
    }
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async getFileBytes(fileId: string): Promise<ArrayBuffer> {
    const fileInfo = await this.call<{ file_path?: string }>('getFile', {
      file_id: fileId,
    });
    if (!fileInfo.file_path) {
      throw new Error('Telegram getFile returned empty file_path');
    }

    const fileUrl = `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${fileInfo.file_path}`;
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`Failed to download Telegram file (${res.status})`);
    }
    return res.arrayBuffer();
  }
}
