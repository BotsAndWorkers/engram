import type { AppEnv } from '../config/env';
import {
  listAllNotes,
  searchNotes,
  setUserModel,
  setUserTimezone,
  setUserVoiceMode,
} from '../db/queries';
import type { TelegramClient } from './client';
import {
  buildClearConfirmScreen,
  buildHelpScreen,
  buildHomeScreen,
  buildListsScreen,
  buildMemoryScreen,
  buildNotesScreen,
  buildRemindersScreen,
  buildSettingsScreen,
} from './ui';

export async function exportNotesAsMarkdown(
  env: AppEnv,
  telegram: TelegramClient,
  userId: number,
  chatId: number,
): Promise<boolean> {
  const notes = await listAllNotes(env.DB, userId);
  if (notes.length === 0) {
    await telegram.sendMessage(chatId, 'Заметок для экспорта пока нет.');
    return false;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const sections = notes.map((n) => {
    const tags = n.tags ? `\nТеги: ${n.tags}` : '';
    const updated = new Date(n.updated_at).toISOString();
    return `# ${n.title} (#${n.id})\nОбновлено: ${updated}${tags}\n\n${n.content}\n`;
  });

  const markdown = `---\nexported_at: ${new Date().toISOString()}\ncount: ${notes.length}\n---\n\n${sections.join('\n---\n\n')}`;
  await telegram.sendDocument(
    chatId,
    `engram-notes-${dateStr}.md`,
    markdown,
    `Экспорт заметок: ${notes.length} шт.`,
  );
  return true;
}

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

  switch (cmd) {
    case '/start':
    case '/menu': {
      const screen = await buildHomeScreen(ctx.env, ctx.userId);
      await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
        replyMarkup: screen.replyMarkup,
      });
      return true;
    }

    case '/help': {
      const screen = buildHelpScreen();
      await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
        replyMarkup: screen.replyMarkup,
      });
      return true;
    }

    case '/notes': {
      if (!arg) {
        const screen = await buildNotesScreen(ctx.env, ctx.userId, 0);
        await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
          replyMarkup: screen.replyMarkup,
        });
        return true;
      }

      const notes = await searchNotes(ctx.env.DB, ctx.userId, arg, undefined, 8);
      if (notes.length === 0) {
        await ctx.telegram.sendMessage(
          ctx.chatId,
          `По запросу "${arg}" заметок не найдено.`,
          {
            replyMarkup: {
              inline_keyboard: [
                [{ text: 'Все заметки', callback_data: 'menu:notes:0' }],
              ],
            },
          },
        );
        return true;
      }

      const lines = notes.map((n) => {
        const tagPart = n.tags ? ` [${n.tags}]` : '';
        return `#${n.id} ${n.title}${tagPart}`;
      });
      await ctx.telegram.sendMessage(
        ctx.chatId,
        [`Результаты поиска "${arg}":`, '', ...lines].join('\n'),
        {
          replyMarkup: {
            inline_keyboard: [
              ...notes.slice(0, 5).map((n) => [
                {
                  text: `#${n.id} ${n.title.slice(0, 32)}`,
                  callback_data: `note:view:${n.id}:0`,
                },
              ]),
              [{ text: 'В главное меню', callback_data: 'menu:home' }],
            ],
          },
        },
      );
      return true;
    }

    case '/reminders': {
      const screen = await buildRemindersScreen(ctx.env, ctx.userId, 'pending');
      await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
        replyMarkup: screen.replyMarkup,
      });
      return true;
    }

    case '/lists': {
      const screen = await buildListsScreen(ctx.env, ctx.userId, arg || undefined);
      await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
        replyMarkup: screen.replyMarkup,
      });
      return true;
    }

    case '/export': {
      await exportNotesAsMarkdown(ctx.env, ctx.telegram, ctx.userId, ctx.chatId);
      return true;
    }

    case '/memory': {
      const screen = await buildMemoryScreen(ctx.env, ctx.userId);
      await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
        replyMarkup: screen.replyMarkup,
      });
      return true;
    }

    case '/clear': {
      const screen = buildClearConfirmScreen();
      await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
        replyMarkup: screen.replyMarkup,
      });
      return true;
    }

    case '/model': {
      if (!arg) {
        const screen = await buildSettingsScreen(ctx.env, ctx.userId);
        await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
          replyMarkup: screen.replyMarkup,
        });
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
        const screen = await buildSettingsScreen(ctx.env, ctx.userId);
        await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
          replyMarkup: screen.replyMarkup,
        });
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

    case '/voice': {
      if (!arg) {
        const screen = await buildSettingsScreen(ctx.env, ctx.userId);
        await ctx.telegram.sendMessage(ctx.chatId, screen.text, {
          replyMarkup: screen.replyMarkup,
        });
        return true;
      }

      const mode = arg.toLowerCase();
      if (mode !== 'off' && mode !== 'voice' && mode !== 'always') {
        await ctx.telegram.sendMessage(
          ctx.chatId,
          `Некорректный режим "${arg}". Доступные значения: off, voice, always.`,
        );
        return true;
      }

      await setUserVoiceMode(ctx.env.DB, ctx.userId, mode);
      await ctx.telegram.sendMessage(
        ctx.chatId,
        `Режим голосовых ответов обновлен: ${mode}`,
      );
      return true;
    }

    case '/app': {
      await ctx.telegram.sendMessage(
        ctx.chatId,
        'Открой Mini App для удобной работы с заметками, списками, напоминаниями и трекерами:',
        {
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: 'Открыть Mini App',
                  web_app: { url: 'https://engram.liam3301j.workers.dev/app' },
                },
              ],
            ],
          },
        },
      );
      return true;
    }

    default:
      return false;
  }
}
