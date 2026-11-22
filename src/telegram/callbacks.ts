import type { AppEnv } from '../config/env';
import {
  clearDoneListItems,
  clearMessages,
  completeReminder,
  deleteMemoryById,
  deleteNote,
  deleteReminder,
  getUserSettings,
  setUserBriefingHour,
  setUserModel,
  setUserTimezone,
  snoozeReminder,
  toggleListItem,
} from '../db/queries';
import { formatLocalTime } from '../tools/reminders';
import type { TelegramClient } from './client';
import { exportNotesAsMarkdown } from './commands';
import type { TelegramCallbackQuery } from './types';
import {
  BRIEFING_PRESETS,
  buildClearConfirmScreen,
  buildHelpScreen,
  buildHomeScreen,
  buildListsScreen,
  buildMemoryScreen,
  buildNoteDetailScreen,
  buildNotesScreen,
  buildRemindersScreen,
  buildSettingsScreen,
  MODEL_PRESETS,
  type ScreenView,
  TIMEZONE_PRESETS,
} from './ui';

async function renderScreen(
  telegram: TelegramClient,
  chatId: number | undefined,
  messageId: number | undefined,
  screen: ScreenView,
): Promise<void> {
  if (!chatId || !messageId) return;
  await telegram.editMessageText(chatId, messageId, screen.text, {
    replyMarkup: screen.replyMarkup,
  });
}

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
  const scope = parts[0];

  if (scope === 'menu') {
    const view = parts[1];
    switch (view) {
      case 'home': {
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildHomeScreen(env, userId),
        );
        return;
      }
      case 'notes': {
        const page = Number.parseInt(parts[2] ?? '0', 10) || 0;
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildNotesScreen(env, userId, page),
        );
        return;
      }
      case 'rems': {
        const status = parts[2] === 'done' ? 'done' : 'pending';
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildRemindersScreen(env, userId, status),
        );
        return;
      }
      case 'lists': {
        const listName = parts[2] || undefined;
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildListsScreen(env, userId, listName),
        );
        return;
      }
      case 'export': {
        await telegram.answerCallbackQuery(query.id, 'Готовлю экспорт...');
        if (chatId) {
          await exportNotesAsMarkdown(env, telegram, userId, chatId);
        }
        return;
      }
      case 'memory': {
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildMemoryScreen(env, userId),
        );
        return;
      }
      case 'settings': {
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildSettingsScreen(env, userId),
        );
        return;
      }
      case 'help': {
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(telegram, chatId, messageId, buildHelpScreen());
        return;
      }
      case 'clear_ask': {
        await telegram.answerCallbackQuery(query.id);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          buildClearConfirmScreen(),
        );
        return;
      }
      case 'clear_ok': {
        if (chatId) {
          await clearMessages(env.DB, chatId);
        }
        await telegram.answerCallbackQuery(query.id, 'История диалога очищена');
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildHomeScreen(env, userId),
        );
        return;
      }
      default: {
        await telegram.answerCallbackQuery(query.id);
        return;
      }
    }
  }

  if (scope === 'note') {
    const action = parts[1];
    const noteId = Number.parseInt(parts[2] ?? '', 10);
    const page = Number.parseInt(parts[3] ?? '0', 10) || 0;

    if (!Number.isFinite(noteId)) {
      await telegram.answerCallbackQuery(query.id, 'Некорректный ID заметки');
      return;
    }

    if (action === 'view') {
      await telegram.answerCallbackQuery(query.id);
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildNoteDetailScreen(env, userId, noteId, page, false),
      );
      return;
    }

    if (action === 'del_ask') {
      await telegram.answerCallbackQuery(query.id);
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildNoteDetailScreen(env, userId, noteId, page, true),
      );
      return;
    }

    if (action === 'del_ok') {
      const deleted = await deleteNote(env.DB, userId, noteId);
      await telegram.answerCallbackQuery(
        query.id,
        deleted ? `Заметка #${noteId} удалена` : 'Заметка не найдена',
      );
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildNotesScreen(env, userId, page),
      );
      return;
    }
  }

  if (scope === 'mem') {
    const action = parts[1];
    const memId = Number.parseInt(parts[2] ?? '', 10);
    if (action === 'del' && Number.isFinite(memId)) {
      const deleted = await deleteMemoryById(env.DB, userId, memId);
      await telegram.answerCallbackQuery(
        query.id,
        deleted ? 'Факт удален из памяти' : 'Факт не найден',
      );
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildMemoryScreen(env, userId),
      );
      return;
    }
  }

  if (scope === 'set') {
    const kind = parts[1];
    const idx = Number.parseInt(parts[2] ?? '', 10);

    if (kind === 'model' && MODEL_PRESETS[idx]) {
      const preset = MODEL_PRESETS[idx];
      await setUserModel(env.DB, userId, preset.id);
      await telegram.answerCallbackQuery(query.id, `Выбрана: ${preset.label}`);
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildSettingsScreen(env, userId),
      );
      return;
    }

    if (kind === 'tz' && TIMEZONE_PRESETS[idx]) {
      const preset = TIMEZONE_PRESETS[idx];
      await setUserTimezone(env.DB, userId, preset.id);
      await telegram.answerCallbackQuery(query.id, `Пояс: ${preset.id}`);
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildSettingsScreen(env, userId),
      );
      return;
    }

    if (kind === 'brief' && BRIEFING_PRESETS[idx] && chatId) {
      const preset = BRIEFING_PRESETS[idx];
      await setUserBriefingHour(env.DB, userId, chatId, preset.hour);
      await telegram.answerCallbackQuery(
        query.id,
        preset.hour === null
          ? 'Дайджест выключен'
          : `Дайджест в ${preset.label}`,
      );
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildSettingsScreen(env, userId),
      );
      return;
    }
  }

  if (scope === 'list') {
    const action = parts[1];
    if (action === 'toggle') {
      const itemId = Number.parseInt(parts[2] ?? '', 10);
      const listName = parts[3] || undefined;
      if (Number.isFinite(itemId)) {
        const updated = await toggleListItem(env.DB, userId, itemId);
        await telegram.answerCallbackQuery(
          query.id,
          updated?.done ? 'Отмечено' : 'Снято',
        );
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildListsScreen(env, userId, listName),
        );
      }
      return;
    }

    if (action === 'clear') {
      const listName = parts[2] ?? '';
      if (listName) {
        const count = await clearDoneListItems(env.DB, userId, listName);
        await telegram.answerCallbackQuery(query.id, `Удалено: ${count}`);
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildListsScreen(env, userId, listName),
        );
      }
      return;
    }
  }

  if (scope === 'rem') {
    const action = parts[1];
    const reminderId = Number.parseInt(parts[2] ?? '', 10);
    if (!Number.isFinite(reminderId)) {
      await telegram.answerCallbackQuery(query.id, 'Некорректный ID напоминания');
      return;
    }

    if (action === 'done') {
      const fromList = parts[3] === 'list';
      const ok = await completeReminder(env.DB, userId, reminderId);
      await telegram.answerCallbackQuery(
        query.id,
        ok ? 'Отмечено выполненным' : 'Напоминание не найдено',
      );
      if (fromList) {
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildRemindersScreen(env, userId, 'pending'),
        );
      } else if (ok && chatId && messageId && query.message?.text) {
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
      const fromList = parts[4] === 'list';
      const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
      const updated = await snoozeReminder(
        env.DB,
        userId,
        reminderId,
        safeMinutes,
      );

      if (!updated) {
        await telegram.answerCallbackQuery(query.id, 'Напоминание не найдено');
        return;
      }

      const settings = await getUserSettings(env.DB, userId);
      const timezone = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';
      const nextLocal = formatLocalTime(updated.due_at, timezone);

      await telegram.answerCallbackQuery(query.id, `Отложено до ${nextLocal}`);
      if (fromList) {
        await renderScreen(
          telegram,
          chatId,
          messageId,
          await buildRemindersScreen(env, userId, 'pending'),
        );
      } else if (chatId && messageId && query.message?.text) {
        await telegram.editMessageText(
          chatId,
          messageId,
          `${query.message.text}\n\n[Отложено до ${nextLocal}]`,
        );
      }
      return;
    }

    if (action === 'del') {
      const listStatus = parts[3] === 'done' ? 'done' : 'pending';
      const deleted = await deleteReminder(env.DB, userId, reminderId);
      await telegram.answerCallbackQuery(
        query.id,
        deleted ? 'Напоминание удалено' : 'Напоминание не найдено',
      );
      await renderScreen(
        telegram,
        chatId,
        messageId,
        await buildRemindersScreen(env, userId, listStatus),
      );
      return;
    }
  }

  await telegram.answerCallbackQuery(query.id);
}
