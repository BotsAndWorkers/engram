import type { AppEnv } from '../config/env';
import {
  cleanupOldProcessedUpdates,
  getDueReminders,
  getUserSettings,
  markReminderDispatched,
} from '../db/queries';
import { TelegramClient } from '../telegram/client';

const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

export async function processDueReminders(env: AppEnv): Promise<void> {
  const nowMs = Date.now();
  const due = await getDueReminders(env.DB, nowMs, 25);

  if (due.length > 0) {
    const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);

    for (const reminder of due) {
      const settings = await getUserSettings(env.DB, reminder.user_id);
      const repeatLabel = reminder.repeat_interval_minutes
        ? `\nПовтор: каждые ${reminder.repeat_interval_minutes} мин.`
        : '';

      try {
        await telegram.sendMessage(
          reminder.chat_id,
          `Напоминание #${reminder.id}:\n${reminder.text}${repeatLabel}`,
          {
            replyMarkup: {
              inline_keyboard: [
                [
                  { text: 'Выполнено', callback_data: `rem:done:${reminder.id}` },
                  {
                    text: '+1 час',
                    callback_data: `rem:snooze:${reminder.id}:60`,
                  },
                  {
                    text: '+1 день',
                    callback_data: `rem:snooze:${reminder.id}:1440`,
                  },
                ],
              ],
            },
          },
        );
        await markReminderDispatched(env.DB, reminder, nowMs);
      } catch (err) {
        console.error('Failed to dispatch reminder', {
          reminderId: reminder.id,
          error: err instanceof Error ? err.message : String(err),
          timezone: settings?.timezone,
        });
      }
    }
  }

  // Hourly cleanup of old webhook deduplication records
  if (new Date(nowMs).getUTCMinutes() === 0) {
    await cleanupOldProcessedUpdates(env.DB, TWO_DAYS_MS);
  }
}
