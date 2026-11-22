import type { AppEnv } from '../config/env';
import {
  getListItems,
  getListNames,
  getNoteById,
  getUserSettings,
  getUserStats,
  listMemories,
  listRecentNotes,
  listReminders,
} from '../db/queries';
import { formatLocalTime } from '../tools/reminders';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from './types';

export interface ScreenView {
  text: string;
  replyMarkup: InlineKeyboardMarkup;
}

export const MODEL_PRESETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B' },
  { id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1' },
  { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: '@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' },
  { id: '@cf/zai-org/glm-4.7-flash', label: 'GLM 4.7 Flash' },
];

export const TIMEZONE_PRESETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'Asia/Novosibirsk', label: 'Новосибирск (+7)' },
  { id: 'Europe/Moscow', label: 'Москва (+3)' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург (+5)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток (+10)' },
  { id: 'UTC', label: 'UTC (+0)' },
];

export const BRIEFING_PRESETS: ReadonlyArray<{
  hour: number | null;
  label: string;
}> = [
  { hour: null, label: 'Выкл' },
  { hour: 8, label: '08:00' },
  { hour: 9, label: '09:00' },
  { hour: 10, label: '10:00' },
  { hour: 20, label: '20:00' },
];

const NOTES_PAGE_SIZE = 5;

export async function buildHomeScreen(
  env: AppEnv,
  userId: number,
): Promise<ScreenView> {
  const [settings, stats] = await Promise.all([
    getUserSettings(env.DB, userId),
    getUserStats(env.DB, userId),
  ]);

  const model =
    settings?.model_override ||
    env.WORKERS_AI_MODEL ||
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const timezone = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';
  const modelLabel = MODEL_PRESETS.find((m) => m.id === model)?.label ?? model;

  const text = [
    'Engram — личный AI-ассистент и база знаний',
    '',
    `Заметок: ${stats.notes} | Напоминаний: ${stats.pendingReminders} | Списки: ${stats.openListItems} | Фактов: ${stats.memories}`,
    `Модель: ${modelLabel}`,
    `Часовой пояс: ${timezone}`,
    '',
    'Можно писать текст, кидать ссылки, голосовые, фото или пересылать посты.',
  ].join('\n');

  const replyMarkup: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: `Заметки (${stats.notes})`, callback_data: 'menu:notes:0' },
        {
          text: `Напоминания (${stats.pendingReminders})`,
          callback_data: 'menu:rems:pending',
        },
      ],
      [
        { text: `Списки (${stats.openListItems})`, callback_data: 'menu:lists:' },
        { text: `Память (${stats.memories})`, callback_data: 'menu:memory' },
      ],
      [
        { text: 'Настройки', callback_data: 'menu:settings' },
        { text: 'Экспорт (.md)', callback_data: 'menu:export' },
      ],
      [
        { text: 'Справка', callback_data: 'menu:help' },
        { text: 'Очистить чат', callback_data: 'menu:clear_ask' },
      ],
    ],
  };

  return { text, replyMarkup };
}

export async function buildNotesScreen(
  env: AppEnv,
  userId: number,
  page = 0,
): Promise<ScreenView> {
  const safePage = Math.max(0, page);
  const rows = await listRecentNotes(
    env.DB,
    userId,
    NOTES_PAGE_SIZE + 1,
    safePage * NOTES_PAGE_SIZE,
  );

  const hasNext = rows.length > NOTES_PAGE_SIZE;
  const pageItems = rows.slice(0, NOTES_PAGE_SIZE);

  if (pageItems.length === 0) {
    return {
      text:
        safePage === 0
          ? 'Заметок пока нет. Просто напиши мне, что нужно сохранить.'
          : 'На этой странице заметок нет.',
      replyMarkup: {
        inline_keyboard: [
          ...(safePage > 0
            ? [[{ text: '< Назад', callback_data: `menu:notes:${safePage - 1}` }]]
            : []),
          [{ text: 'В главное меню', callback_data: 'menu:home' }],
        ],
      },
    };
  }

  const lines = pageItems.map((n) => {
    const tagPart = n.tags ? ` [${n.tags}]` : '';
    return `#${n.id} ${n.title}${tagPart}`;
  });

  const keyboard: InlineKeyboardButton[][] = pageItems.map((n) => {
    const shortTitle =
      n.title.length > 32 ? `${n.title.slice(0, 32)}...` : n.title;
    return [
      {
        text: `#${n.id} ${shortTitle}`,
        callback_data: `note:view:${n.id}:${safePage}`,
      },
    ];
  });

  const navRow: InlineKeyboardButton[] = [];
  if (safePage > 0) {
    navRow.push({
      text: '< Назад',
      callback_data: `menu:notes:${safePage - 1}`,
    });
  }
  if (hasNext) {
    navRow.push({
      text: 'Вперед >',
      callback_data: `menu:notes:${safePage + 1}`,
    });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([
    { text: 'Обновить', callback_data: `menu:notes:${safePage}` },
    { text: 'В главное меню', callback_data: 'menu:home' },
  ]);

  return {
    text: [`Заметки (стр. ${safePage + 1}):`, '', ...lines].join('\n'),
    replyMarkup: { inline_keyboard: keyboard },
  };
}

export async function buildNoteDetailScreen(
  env: AppEnv,
  userId: number,
  noteId: number,
  page: number,
  confirmDelete = false,
): Promise<ScreenView> {
  const note = await getNoteById(env.DB, userId, noteId);
  if (!note) {
    return {
      text: `Заметка #${noteId} не найдена.`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: 'К списку заметок', callback_data: `menu:notes:${page}` }],
        ],
      },
    };
  }

  const settings = await getUserSettings(env.DB, userId);
  const timezone = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';
  const tagsLine = note.tags ? `Теги: ${note.tags}` : 'Теги: нет';
  const updatedLine = `Обновлено: ${formatLocalTime(note.updated_at, timezone)}`;
  const body =
    note.content.length > 3200
      ? `${note.content.slice(0, 3200)}\n...`
      : note.content;

  const text = [
    `#${note.id} ${note.title}`,
    `${tagsLine} | ${updatedLine}`,
    '',
    body,
  ].join('\n');

  const keyboard: InlineKeyboardButton[][] = confirmDelete
    ? [
        [
          {
            text: 'Да, удалить заметку',
            callback_data: `note:del_ok:${note.id}:${page}`,
          },
          {
            text: 'Отмена',
            callback_data: `note:view:${note.id}:${page}`,
          },
        ],
      ]
    : [
        [
          {
            text: 'Удалить',
            callback_data: `note:del_ask:${note.id}:${page}`,
          },
          { text: 'К списку', callback_data: `menu:notes:${page}` },
        ],
        [{ text: 'В главное меню', callback_data: 'menu:home' }],
      ];

  return { text, replyMarkup: { inline_keyboard: keyboard } };
}

export async function buildRemindersScreen(
  env: AppEnv,
  userId: number,
  status: 'pending' | 'done' = 'pending',
): Promise<ScreenView> {
  const [settings, rows] = await Promise.all([
    getUserSettings(env.DB, userId),
    listReminders(env.DB, userId, status, 10),
  ]);

  const timezone = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';

  const filterRow: InlineKeyboardButton[] = [
    {
      text: status === 'pending' ? '[*] Активные' : 'Активные',
      callback_data: 'menu:rems:pending',
    },
    {
      text: status === 'done' ? '[*] Выполненные' : 'Выполненные',
      callback_data: 'menu:rems:done',
    },
  ];

  if (rows.length === 0) {
    return {
      text:
        status === 'pending'
          ? 'Активных напоминаний нет.'
          : 'Выполненных напоминаний нет.',
      replyMarkup: {
        inline_keyboard: [
          filterRow,
          [{ text: 'В главное меню', callback_data: 'menu:home' }],
        ],
      },
    };
  }

  const lines = rows.map((r) => {
    const repeat = r.repeat_interval_minutes
      ? ` (каждые ${r.repeat_interval_minutes} мин.)`
      : '';
    return `#${r.id} [${formatLocalTime(r.due_at, timezone)}] ${r.text}${repeat}`;
  });

  const keyboard: InlineKeyboardButton[][] = [filterRow];

  if (status === 'pending') {
    for (const r of rows.slice(0, 5)) {
      keyboard.push([
        { text: `#${r.id} Готово`, callback_data: `rem:done:${r.id}:list` },
        {
          text: `#${r.id} +1ч`,
          callback_data: `rem:snooze:${r.id}:60:list`,
        },
        { text: `#${r.id} Удалить`, callback_data: `rem:del:${r.id}` },
      ]);
    }
  } else {
    for (const r of rows.slice(0, 5)) {
      keyboard.push([
        { text: `#${r.id} Удалить`, callback_data: `rem:del:${r.id}:done` },
      ]);
    }
  }

  keyboard.push([
    { text: 'Обновить', callback_data: `menu:rems:${status}` },
    { text: 'В главное меню', callback_data: 'menu:home' },
  ]);

  return {
    text: [
      status === 'pending'
        ? 'Активные напоминания:'
        : 'Выполненные напоминания:',
      '',
      ...lines,
    ].join('\n'),
    replyMarkup: { inline_keyboard: keyboard },
  };
}

export async function buildMemoryScreen(
  env: AppEnv,
  userId: number,
): Promise<ScreenView> {
  const memories = await listMemories(env.DB, userId);

  if (memories.length === 0) {
    return {
      text: 'Долгосрочная память пуста. Напиши, например: "Запомни, что я работаю в команде X".',
      replyMarkup: {
        inline_keyboard: [
          [{ text: 'В главное меню', callback_data: 'menu:home' }],
        ],
      },
    };
  }

  const lines = memories.map((m) => `- ${m.key}: ${m.value}`);
  const keyboard: InlineKeyboardButton[][] = memories.slice(0, 8).map((m) => {
    const label = m.key.length > 26 ? `${m.key.slice(0, 26)}...` : m.key;
    return [{ text: `Забыть: ${label}`, callback_data: `mem:del:${m.id}` }];
  });

  keyboard.push([{ text: 'В главное меню', callback_data: 'menu:home' }]);

  return {
    text: ['Сохраненные факты (долгосрочная память):', '', ...lines].join(
      '\n',
    ),
    replyMarkup: { inline_keyboard: keyboard },
  };
}

export async function buildSettingsScreen(
  env: AppEnv,
  userId: number,
): Promise<ScreenView> {
  const settings = await getUserSettings(env.DB, userId);
  const currentModel =
    settings?.model_override ||
    env.WORKERS_AI_MODEL ||
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const currentTz = settings?.timezone || env.DEFAULT_TIMEZONE || 'UTC';
  const currentBriefing = settings?.briefing_hour ?? null;

  const modelButtons: InlineKeyboardButton[][] = [];
  for (let i = 0; i < MODEL_PRESETS.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    for (let j = i; j < i + 2 && j < MODEL_PRESETS.length; j += 1) {
      const preset = MODEL_PRESETS[j];
      const active = preset.id === currentModel;
      row.push({
        text: active ? `[*] ${preset.label}` : preset.label,
        callback_data: `set:model:${j}`,
      });
    }
    modelButtons.push(row);
  }

  const tzButtons: InlineKeyboardButton[][] = [];
  for (let i = 0; i < TIMEZONE_PRESETS.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    for (let j = i; j < i + 2 && j < TIMEZONE_PRESETS.length; j += 1) {
      const tz = TIMEZONE_PRESETS[j];
      const active = tz.id === currentTz;
      row.push({
        text: active ? `[*] ${tz.label}` : tz.label,
        callback_data: `set:tz:${j}`,
      });
    }
    tzButtons.push(row);
  }

  const briefRow: InlineKeyboardButton[] = BRIEFING_PRESETS.map((b, idx) => ({
    text: b.hour === currentBriefing ? `[*] ${b.label}` : b.label,
    callback_data: `set:brief:${idx}`,
  }));

  const briefLabel =
    currentBriefing === null
      ? 'выключен'
      : `${String(currentBriefing).padStart(2, '0')}:00`;

  const text = [
    'Настройки',
    '',
    `Модель: ${currentModel}`,
    `Часовой пояс: ${currentTz}`,
    `Дайджест дня: ${briefLabel}`,
    '',
    'Выбери модель, часовой пояс или время ежедневной сводки:',
  ].join('\n');

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        ...modelButtons,
        ...tzButtons,
        briefRow,
        [{ text: 'В главное меню', callback_data: 'menu:home' }],
      ],
    },
  };
}

export async function buildListsScreen(
  env: AppEnv,
  userId: number,
  selectedList?: string,
): Promise<ScreenView> {
  const listNames = await getListNames(env.DB, userId);

  if (listNames.length === 0) {
    return {
      text: 'Списков пока нет. Напиши в чат, например: "добавь молоко и кофе в список покупок".',
      replyMarkup: {
        inline_keyboard: [
          [{ text: 'В главное меню', callback_data: 'menu:home' }],
        ],
      },
    };
  }

  const activeList =
    selectedList && listNames.includes(selectedList)
      ? selectedList
      : listNames[0];

  const items = await getListItems(env.DB, userId, activeList);

  const tabRow: InlineKeyboardButton[] = listNames.slice(0, 4).map((name) => ({
    text: name === activeList ? `[*] ${name}` : name,
    callback_data: `menu:lists:${name.slice(0, 24)}`,
  }));

  const lines = items.map(
    (item) => `${item.done ? '[x]' : '[ ]'} ${item.text}`,
  );

  const itemButtons: InlineKeyboardButton[][] = items.slice(0, 8).map((item) => {
    const short =
      item.text.length > 32 ? `${item.text.slice(0, 32)}...` : item.text;
    return [
      {
        text: `${item.done ? '[x]' : '[ ]'} ${short}`,
        callback_data: `list:toggle:${item.id}:${activeList.slice(0, 20)}`,
      },
    ];
  });

  const hasDone = items.some((i) => Boolean(i.done));
  const footerRow: InlineKeyboardButton[] = [];
  if (hasDone) {
    footerRow.push({
      text: 'Убрать выполненные',
      callback_data: `list:clear:${activeList.slice(0, 24)}`,
    });
  }
  footerRow.push({ text: 'В главное меню', callback_data: 'menu:home' });

  return {
    text: [
      `Список "${activeList}":`,
      '',
      ...(lines.length > 0 ? lines : ['(пусто)']),
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [tabRow, ...itemButtons, footerRow],
    },
  };
}

export function buildHelpScreen(): ScreenView {
  return {
    text: [
      'Справка по Engram',
      '',
      'Команды:',
      '/menu — главное интерактивное меню',
      '/notes [запрос] — заметки или поиск',
      '/reminders — список напоминаний',
      '/lists — интерактивные списки',
      '/memory — долгосрочная память',
      '/export — экспорт всех заметок в Markdown',
      '/model [id | reset] — выбор модели AI',
      '/tz [Asia/Novosibirsk] — часовой пояс',
      '/clear — очистить историю диалога',
      '',
      'Примеры запросов:',
      '- "Запомни: сервер прода 10.0.1.5"',
      '- "Напомни завтра в 10:00 позвонить врачу"',
      '- "Напоминай каждый день в 21:00 почитать"',
      '- "https://example.com сделай выжимку и сохрани в заметки"',
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [{ text: 'В главное меню', callback_data: 'menu:home' }],
      ],
    },
  };
}

export function buildClearConfirmScreen(): ScreenView {
  return {
    text: 'Очистить историю текущего диалога? Заметки, напоминания и долгосрочная память останутся на месте.',
    replyMarkup: {
      inline_keyboard: [
        [
          { text: 'Да, очистить', callback_data: 'menu:clear_ok' },
          { text: 'Отмена', callback_data: 'menu:home' },
        ],
      ],
    },
  };
}
