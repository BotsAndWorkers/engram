import type { AppEnv } from '../config/env';
import {
  clearMessages,
  getUserSettings,
  listMemories,
  listRecentNotes,
  listReminders,
  searchNotes,
  setUserModel,
  setUserTimezone,
} from '../db/queries';
import { formatLocalTime } from '../tools/reminders';
import type { TelegramClient } from './client';

export interface CommandContext {
  env: AppEnv;
  telegram: TelegramClient;
  userId: number;
  chatId: number;
  text: string;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function handleSlashCommand(ctx: CommandContext): Promise<boolean> {
  const trimmed = ctx.text.trim();
  if (!trimmed.startsWith('/')) return false;

  const [rawCmd, ...rest] = trimmed.split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();

  const settings = await getUserSettings(ctx.env.DB, ctx.userId);
  const timezone = settings?.timezone || ctx.env.DEFAULT_TIMEZONE || 'UTC';

  switch (cmd) {
    case '/start': {
      await ctx.telegram.sendMessage(
        ctx.chatId,
        [
          'Engram запущен. Я твой персональный AI-ассистент и база знаний на Cloudflare Workers.',
          '',
          'Что я умею:',
          '- Общаться и вызывать инструменты',
          '- Сохранять заметки, идеи и выжимки по ссылкам',
          '- Ставить одноразовые и повторяющиеся напоминания',
          '- Запоминать важные факты о тебе между диалогами',
          '- Понимать голосовые сообщения',
          '',
          'Команды: /help, /notes, /reminders, /memory, /model, /tz, /clear',
        ].join('\n'),
      );
      return true;
    }

    case '/help': {
      await ctx.telegram.sendMessage(
        ctx.chatId,
        [
          'Доступные команды:',
          '/notes [запрос] — последние заметки или поиск по базе',
          '/reminders — активные напоминания',
          '/memory — сохраненные факты о тебе',
          '/model [id | reset] — текущая модель или смена модели',
          '/tz [Asia/Novosibirsk] — часовой пояс для напоминаний',
          '/clear — очистить историю диалога (заметки и память сохранятся)',
          '',
          'Примеры обычных сообщений:',
          '- "Запомни: ключ от тестового стенда лежит в KeePass"',
          '- "Напомни завтра в 10:00 позвонить врачу"',
          '- "Напоминай каждый день в 21:00 прочитать 20 страниц"',
          '- "https://example.com/article сделай выжимку и сохрани в заметки"',
        ].join('\n'),
      );
      return true;
    }

    case '/notes': {
      const notes = arg
        ? await searchNotes(ctx.env.DB, ctx.userId, arg, undefined, 10)
        : await listRecentNotes(ctx.env.DB, ctx.userId, 10);

      if (notes.length === 0) {
        await ctx.telegram.sendMessage(
          ctx.chatId,
          arg ? `По запросу "${arg}" заметок не найдено.` : 'Заметок пока нет.',
        );
        return true;
      }

      const lines = notes.map((n) => {
        const tagPart = n.tags ? ` [${n.tags}]` : '';
        return `#${n.id} ${n.title}${tagPart}`;
      });
      await ctx.telegram.sendMessage(ctx.chatId, lines.join('\n'));
      return true;
    }

    case '/reminders': {
      const reminders = await listReminders(ctx.env.DB, ctx.userId, 'pending', 20);
      if (reminders.length === 0) {
        await ctx.telegram.sendMessage(ctx.chatId, 'Активных напоминаний нет.');
        return true;
      }

      const lines = reminders.map((r) => {
        const repeat = r.repeat_interval_minutes
          ? ` (каждые ${r.repeat_interval_minutes} мин.)`
          : '';
        return `#${r.id} [${formatLocalTime(r.due_at, timezone)}] ${r.text}${repeat}`;
      });
      await ctx.telegram.sendMessage(ctx.chatId, lines.join('\n'));
      return true;
    }

    case '/memory': {
      const memories = await listMemories(ctx.env.DB, ctx.userId);
      if (memories.length === 0) {
        await ctx.telegram.sendMessage(ctx.chatId, 'Долгосрочная память пуста.');
        return true;
      }

      const lines = memories.map((m) => `- ${m.key}: ${m.value}`);
      await ctx.telegram.sendMessage(ctx.chatId, lines.join('\n'));
      return true;
    }

    case '/clear': {
      await clearMessages(ctx.env.DB, ctx.chatId);
      await ctx.telegram.sendMessage(
        ctx.chatId,
        'История текущего диалога очищена. Заметки, напоминания и память сохранены.',
      );
      return true;
    }

    case '/model': {
      if (!arg) {
        const current =
          settings?.model_override ||
          ctx.env.WORKERS_AI_MODEL ||
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        await ctx.telegram.sendMessage(
          ctx.chatId,
          `Текущая модель: ${current}\nПровайдер: ${ctx.env.LLM_PROVIDER || 'workers-ai'}\nСмена: /model <model_id> или /model reset`,
        );
        return true;
      }

      if (arg.toLowerCase() === 'reset') {
        await setUserModel(ctx.env.DB, ctx.userId, null);
        await ctx.telegram.sendMessage(
          ctx.chatId,
          'Модель сброшена на значение по умолчанию.',
        );
        return true;
      }

      await setUserModel(ctx.env.DB, ctx.userId, arg);
      await ctx.telegram.sendMessage(ctx.chatId, `Модель обновлена: ${arg}`);
      return true;
    }

    case '/tz': {
      if (!arg) {
        await ctx.telegram.sendMessage(
          ctx.chatId,
          `Текущий часовой пояс: ${timezone}\nСмена: /tz Asia/Novosibirsk`,
        );
        return true;
      }

      if (!isValidTimezone(arg)) {
        await ctx.telegram.sendMessage(
          ctx.chatId,
          `Некорректный часовой пояс "${arg}". Используй формат IANA, например Asia/Novosibirsk или Europe/Moscow.`,
        );
        return true;
      }

      await setUserTimezone(ctx.env.DB, ctx.userId, arg);
      await ctx.telegram.sendMessage(
        ctx.chatId,
        `Часовой пояс обновлен: ${arg}`,
      );
      return true;
    }

    default:
      return false;
  }
}
