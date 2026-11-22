import type { AppEnv } from '../config/env';
import {
  completeReminder,
  getUserSettings,
  snoozeReminder,
} from '../db/queries';
import { formatLocalTime } from '../tools/reminders';
import type { TelegramClient } from './client';
import type { TelegramCallbackQuery } from './types';

export async function handleCallbackQuery(
  env: AppEnv,
  telegram: TelegramClient,
  query: TelegramCallbackQuery,
): Promise<void> {
  const data = query.data ?? '';
  const userId = query.from.id;
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;

  const parts = data.split(':');
  if (parts[0] !== 'rem') {
    await telegram.answerCallbackQuery(query.id);
    return;
  }

  const action = parts[1];
  const reminderId = Number.parseInt(parts[2] ?? '', 10);
  if (!Number.isFinite(reminderId)) {
    await telegram.answerCallbackQuery(query.id, 'Некорректный ID напоминания');
    return;
  }

  if (action === 'done') {
    const ok = await completeReminder(env.DB, userId, reminderId);
    await telegram.answerCallbackQuery(
      query.id,
      ok ? 'Отмечено выполненным' : 'Напоминание не найдено',
    );
    if (ok && chatId && messageId && query.message?.text) {
      await telegram.editMessageText(
        chatId,
        messageId,
        `${query.message.text}\n\n[Выполнено]`,
      );
    }
    return;
  }

  if (action === 'snooze') {
    const minutes = Number.parseInt(parts[3] ?? '60', 10);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
    const updated = await snoozeReminder(env.DB, userId, reminderId, safeMinutes);

    if (!updated) {
      await telegram.answerCallbackQuery(query.id, 'Напоминание не найдено');
      return;
    }

    const settings = await getUserSettings(env.DB, userId);
    const timezone = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';
    const nextLocal = formatLocalTime(updated.due_at, timezone);

    await telegram.answerCallbackQuery(query.id, `Отложено до ${nextLocal}`);
    if (chatId && messageId && query.message?.text) {
      await telegram.editMessageText(
        chatId,
        messageId,
        `${query.message.text}\n\n[Отложено до ${nextLocal}]`,
      );
    }
    return;
  }

  await telegram.answerCallbackQuery(query.id);
}
