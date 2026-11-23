import type { AppEnv } from '../config/env';
import {
  cleanupOldProcessedUpdates,
  getDueReminders,
  getListItems,
  getUserSettings,
  getUsersForBriefing,
  getUsersForCheckin,
  listRecentNotes,
  listReminders,
  markBriefingSent,
  markCheckinSent,
  markReminderDispatched,
} from '../db/queries';
import { TelegramClient } from '../telegram/client';
import { formatLocalTime } from '../tools/reminders';

const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

export function isQuietHour(
  hour: number,
  quietStart: number | null,
  quietEnd: number | null,
): boolean {
  if (quietStart === null || quietEnd === null) return false;
  if (quietStart === quietEnd) return false;
  const h = ((hour % 24) + 24) % 24;
  const start = ((quietStart % 24) + 24) % 24;
  const end = ((quietEnd % 24) + 24) % 24;
  if (start < end) {
    return h >= start && h < end;
  }
  return h >= start || h < end;
}

function getLocalDateAndHour(
  nowMs: number,
  timezone: string,
): { dateStr: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date(nowMs));

    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '00';
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    const hour = Number.parseInt(get('hour'), 10) % 24;
    return { dateStr, hour };
  } catch {
    const d = new Date(nowMs);
    return {
      dateStr: d.toISOString().slice(0, 10),
      hour: d.getUTCHours(),
    };
  }
}

export async function processDueReminders(env: AppEnv): Promise<void> {
  const nowMs = Date.now();
  const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const due = await getDueReminders(env.DB, nowMs, 25);

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

  // Check daily briefings and evening check-ins in the first 5 minutes of each hour
  const utcMinutes = new Date(nowMs).getUTCMinutes();
  if (utcMinutes < 5) {
    await processDailyBriefings(env, telegram, nowMs);
    await processEveningCheckins(env, telegram, nowMs);
  }

  // Hourly cleanup of old webhook deduplication records
  if (utcMinutes === 0) {
    await cleanupOldProcessedUpdates(env.DB, TWO_DAYS_MS);
  }
}

async function processDailyBriefings(
  env: AppEnv,
  telegram: TelegramClient,
  nowMs: number,
): Promise<void> {
  const users = await getUsersForBriefing(env.DB);
  for (const user of users) {
    if (user.briefing_hour === null || !user.chat_id) continue;
    const timezone = user.timezone || env.DEFAULT_TIMEZONE || 'UTC';
    const { dateStr, hour } = getLocalDateAndHour(nowMs, timezone);

    if (hour !== user.briefing_hour || user.last_briefing_date === dateStr) {
      continue;
    }
    if (isQuietHour(hour, user.quiet_start, user.quiet_end)) {
      continue;
    }

    try {
      const [reminders, listItems, recentNotes] = await Promise.all([
        listReminders(env.DB, user.user_id, 'pending', 8),
        getListItems(env.DB, user.user_id),
        listRecentNotes(env.DB, user.user_id, 3),
      ]);

      const openItems = listItems.filter((i) => !i.done);
      const lines: string[] = [`<b>Сводка на ${dateStr}</b>`, ''];

      if (reminders.length > 0) {
        lines.push('<b>Напоминания:</b>');
        for (const r of reminders) {
          lines.push(`• [${formatLocalTime(r.due_at, timezone)}] ${r.text}`);
        }
        lines.push('');
      } else {
        lines.push('Активных напоминаний нет.', '');
      }

      if (openItems.length > 0) {
        lines.push(`<b>Открытых пунктов в списках:</b> ${openItems.length}`);
      }
      if (recentNotes.length > 0) {
        lines.push(
          `<b>Недавние заметки:</b> ${recentNotes.map((n) => n.title).join(', ')}`,
        );
      }

      await telegram.sendMessage(user.chat_id, lines.join('\n'), {
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [
            [
              { text: 'Напоминания', callback_data: 'menu:rems:pending' },
              { text: 'Списки', callback_data: 'menu:lists:' },
            ],
            [{ text: 'Главное меню', callback_data: 'menu:home' }],
          ],
        },
      });
      await markBriefingSent(env.DB, user.user_id, dateStr);
    } catch (err) {
      console.error('Daily briefing failed', {
        userId: user.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function processEveningCheckins(
  env: AppEnv,
  telegram: TelegramClient,
  nowMs: number,
): Promise<void> {
  const users = await getUsersForCheckin(env.DB);
  for (const user of users) {
    if (user.checkin_hour === null || !user.chat_id) continue;
    const timezone = user.timezone || env.DEFAULT_TIMEZONE || 'UTC';
    const { dateStr, hour } = getLocalDateAndHour(nowMs, timezone);

    if (hour !== user.checkin_hour || user.last_checkin_date === dateStr) {
      continue;
    }
    if (isQuietHour(hour, user.quiet_start, user.quiet_end)) {
      continue;
    }

    try {
      const [reminders, listItems] = await Promise.all([
        listReminders(env.DB, user.user_id, 'pending', 5),
        getListItems(env.DB, user.user_id),
      ]);

      const openItems = listItems.filter((i) => !i.done);
      const lines: string[] = [
        `<b>Вечерний чек-ин (${dateStr})</b>`,
        '',
        'Как прошёл день? Можешь коротко подвести итоги, отметить что удалось сделать или записать мысли на завтра.',
      ];

      if (reminders.length > 0 || openItems.length > 0) {
        lines.push('');
        if (reminders.length > 0) {
          lines.push(`<b>Осталось напоминаний:</b> ${reminders.length}`);
        }
        if (openItems.length > 0) {
          lines.push(`<b>Открытых пунктов в списках:</b> ${openItems.length}`);
        }
      }

      await telegram.sendMessage(user.chat_id, lines.join('\n'), {
        parseMode: 'HTML',
        replyMarkup: {
          inline_keyboard: [
            [
              { text: 'Напоминания', callback_data: 'menu:rems:pending' },
              { text: 'Списки', callback_data: 'menu:lists:' },
            ],
            [{ text: 'Главное меню', callback_data: 'menu:home' }],
          ],
        },
      });
      await markCheckinSent(env.DB, user.user_id, dateStr);
    } catch (err) {
      console.error('Evening checkin failed', {
        userId: user.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
