import { Hono } from 'hono';
import type { AppEnv } from '../config/env';
import {
  addListItems,
  addTrackerEntry,
  completeReminder,
  createNote,
  createReminder,
  deleteMemoryById,
  deleteNote,
  deleteReminder,
  getListItems,
  getTrackerSummary,
  getUserSettings,
  listMemories,
  listRecentDocuments,
  listRecentNotes,
  listReminders,
  setUserModel,
  toggleListItem,
  updateNote,
  updateReminder,
} from '../db/queries';
import {
  getProviderCatalogPage,
  getProvidersCatalog,
  probeAllProviders,
} from '../llm/diagnostics';
import { isUserAllowed } from '../telegram/auth';
import { MODEL_PRESETS } from '../telegram/ui';
import { renderMiniAppHtml } from './app';

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verifies Telegram Mini App `initData` using Web Crypto HMAC-SHA256
 * with the `WebAppData` key per Telegram's specification.
 * Returns the authenticated Telegram `user.id`, or `null` if invalid.
 */
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
): Promise<number | null> {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const expectedHashBytes = hexToBytes(hash);
  if (!expectedHashBytes) return null;

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') {
      pairs.push([key, value]);
    }
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const encoder = new TextEncoder();

  const webAppKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secretKeyBytes = await crypto.subtle.sign(
    'HMAC',
    webAppKey,
    encoder.encode(botToken),
  );

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    encoder.encode(dataCheckString),
  );

  const actualBytes = new Uint8Array(signature);
  if (actualBytes.length !== expectedHashBytes.length) return null;

  let diff = 0;
  for (let i = 0; i < actualBytes.length; i += 1) {
    diff |= actualBytes[i] ^ expectedHashBytes[i];
  }
  if (diff !== 0) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  try {
    const parsed = JSON.parse(userRaw) as { id?: unknown };
    if (
      typeof parsed.id === 'number' &&
      Number.isFinite(parsed.id) &&
      parsed.id > 0
    ) {
      return parsed.id;
    }
    return null;
  } catch {
    return null;
  }
}

export const webAppRoutes = new Hono<{
  Bindings: AppEnv;
  Variables: { userId: number };
}>();

webAppRoutes.get('/', (c) => {
  return c.html(renderMiniAppHtml());
});

webAppRoutes.use('/api/*', async (c, next) => {
  const initData = c.req.header('X-Telegram-Init-Data') ?? '';
  const userId = await verifyTelegramInitData(
    initData,
    c.env.TELEGRAM_BOT_TOKEN,
  );
  if (!userId || !isUserAllowed(userId, c.env.ALLOWED_USER_IDS)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userId', userId);
  await next();
});

webAppRoutes.get('/api/data', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const [notes, reminders, lists, memories, trackerSummary, documents, settings] =
    await Promise.all([
      listRecentNotes(db, userId, 30),
      listReminders(db, userId, 'pending', 30),
      getListItems(db, userId),
      listMemories(db, userId),
      getTrackerSummary(db, userId, 30),
      listRecentDocuments(db, userId, 20),
      getUserSettings(db, userId),
    ]);

  return c.json({
    notes,
    reminders,
    lists,
    memories,
    trackerSummary,
    documents,
    settings: {
      modelOverride: settings?.model_override ?? null,
      providers: {
        gemini: Boolean(c.env.GEMINI_API_KEY),
        groq: Boolean(c.env.GROQ_API_KEY),
        ioNet: Boolean(c.env.IO_API_KEY),
        workersAi: true,
      },
      presets: MODEL_PRESETS,
    },
  });
});

webAppRoutes.post('/api/notes', async (c) => {
  const userId = c.get('userId');
  let body: { title?: unknown; content?: unknown; tags?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const tags = typeof body.tags === 'string' ? body.tags.trim() : '';

  if (!content && !title) {
    return c.json({ error: 'Title or content is required' }, 400);
  }

  const note = await createNote(
    c.env.DB,
    userId,
    title || 'Заметка',
    content || title,
    tags,
  );
  return c.json({ ok: true, note }, 201);
});

webAppRoutes.delete('/api/notes/:id', async (c) => {
  const userId = c.get('userId');
  const noteId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return c.json({ error: 'Invalid note id' }, 400);
  }

  const deleted = await deleteNote(c.env.DB, userId, noteId);
  if (!deleted) {
    return c.json({ error: 'Note not found' }, 404);
  }
  return c.json({ ok: true });
});

webAppRoutes.put('/api/notes/:id', async (c) => {
  const userId = c.get('userId');
  const noteId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return c.json({ error: 'Invalid note id' }, 400);
  }

  let body: { title?: unknown; content?: unknown; tags?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const note = await updateNote(c.env.DB, userId, noteId, {
    title: typeof body.title === 'string' ? body.title : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    tags: typeof body.tags === 'string' ? body.tags : undefined,
  });
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }
  return c.json({ ok: true, note });
});

webAppRoutes.post('/api/lists/:id/toggle', async (c) => {
  const userId = c.get('userId');
  const itemId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return c.json({ error: 'Invalid list item id' }, 400);
  }

  const item = await toggleListItem(c.env.DB, userId, itemId);
  if (!item) {
    return c.json({ error: 'List item not found' }, 404);
  }
  return c.json({ ok: true, item });
});

webAppRoutes.post('/api/reminders/:id/done', async (c) => {
  const userId = c.get('userId');
  const reminderId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(reminderId) || reminderId <= 0) {
    return c.json({ error: 'Invalid reminder id' }, 400);
  }

  const done = await completeReminder(c.env.DB, userId, reminderId);
  if (!done) {
    return c.json({ error: 'Reminder not found' }, 404);
  }
  return c.json({ ok: true });
});

webAppRoutes.post('/api/reminders', async (c) => {
  const userId = c.get('userId');
  let body: {
    text?: unknown;
    inMinutes?: unknown;
    dueAtIso?: unknown;
    repeatMinutes?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);

  let dueAt: number | null = null;
  if (typeof body.dueAtIso === 'string' && body.dueAtIso.trim()) {
    const parsed = Date.parse(body.dueAtIso.trim());
    if (Number.isFinite(parsed)) dueAt = parsed;
  } else {
    const mins = Number(body.inMinutes ?? 60);
    if (Number.isFinite(mins) && mins > 0) {
      dueAt = Date.now() + Math.round(mins * 60_000);
    }
  }
  if (!dueAt) return c.json({ error: 'Valid due date is required' }, 400);

  const repeatIntervalMinutes =
    body.repeatMinutes !== undefined && Number(body.repeatMinutes) > 0
      ? Math.round(Number(body.repeatMinutes))
      : null;

  const settings = await getUserSettings(c.env.DB, userId);
  const reminder = await createReminder(c.env.DB, {
    userId,
    chatId: settings?.chat_id ?? userId,
    text,
    dueAt,
    repeatIntervalMinutes,
  });
  return c.json({ ok: true, reminder }, 201);
});

webAppRoutes.put('/api/reminders/:id', async (c) => {
  const userId = c.get('userId');
  const reminderId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(reminderId) || reminderId <= 0) {
    return c.json({ error: 'Invalid reminder id' }, 400);
  }

  let body: { text?: unknown; dueAtIso?: unknown; repeatMinutes?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  let dueAt: number | undefined;
  if (typeof body.dueAtIso === 'string' && body.dueAtIso.trim()) {
    const parsed = Date.parse(body.dueAtIso.trim());
    if (!Number.isFinite(parsed)) {
      return c.json({ error: 'Invalid dueAtIso' }, 400);
    }
    dueAt = parsed;
  }

  const repeatIntervalMinutes =
    body.repeatMinutes === null || body.repeatMinutes === 0 || body.repeatMinutes === ''
      ? null
      : body.repeatMinutes !== undefined && Number(body.repeatMinutes) > 0
        ? Math.round(Number(body.repeatMinutes))
        : undefined;

  const reminder = await updateReminder(c.env.DB, userId, reminderId, {
    text: typeof body.text === 'string' ? body.text : undefined,
    dueAt,
    repeatIntervalMinutes,
  });
  if (!reminder) {
    return c.json({ error: 'Reminder not found' }, 404);
  }
  return c.json({ ok: true, reminder });
});

webAppRoutes.delete('/api/reminders/:id', async (c) => {
  const userId = c.get('userId');
  const reminderId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(reminderId) || reminderId <= 0) {
    return c.json({ error: 'Invalid reminder id' }, 400);
  }
  const deleted = await deleteReminder(c.env.DB, userId, reminderId);
  return c.json({ ok: deleted });
});

webAppRoutes.post('/api/lists', async (c) => {
  const userId = c.get('userId');
  let body: { listName?: unknown; text?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const listName =
    typeof body.listName === 'string' && body.listName.trim()
      ? body.listName.trim()
      : 'покупки';
  if (!text) return c.json({ error: 'text is required' }, 400);

  const items = await addListItems(c.env.DB, userId, listName, [text]);
  return c.json({ ok: true, item: items[0] ?? null }, 201);
});

webAppRoutes.post('/api/trackers', async (c) => {
  const userId = c.get('userId');
  let body: {
    category?: unknown;
    label?: unknown;
    amount?: unknown;
    unit?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const category =
    typeof body.category === 'string' && body.category.trim()
      ? body.category.trim()
      : 'расходы';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) return c.json({ error: 'label is required' }, 400);

  const amount =
    body.amount !== undefined && body.amount !== '' && Number.isFinite(Number(body.amount))
      ? Number(body.amount)
      : null;
  const unit = typeof body.unit === 'string' ? body.unit.trim() : null;

  const entry = await addTrackerEntry(c.env.DB, {
    userId,
    category,
    label,
    amount,
    unit,
  });
  return c.json({ ok: true, entry }, 201);
});

webAppRoutes.delete('/api/memories/:id', async (c) => {
  const userId = c.get('userId');
  const memId = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(memId) || memId <= 0) {
    return c.json({ error: 'Invalid memory id' }, 400);
  }
  const deleted = await deleteMemoryById(c.env.DB, userId, memId);
  return c.json({ ok: deleted });
});

webAppRoutes.post('/api/settings/model', async (c) => {
  const userId = c.get('userId');
  let body: { model?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const raw = typeof body.model === 'string' ? body.model.trim() : '';
  const nextModel = !raw || raw === 'auto' ? null : raw;
  await setUserModel(c.env.DB, userId, nextModel);
  return c.json({ ok: true, modelOverride: nextModel });
});

webAppRoutes.post('/api/models/check', async (c) => {
  const results = await probeAllProviders(c.env);
  return c.json({ results });
});

webAppRoutes.get('/api/models/catalog', async (c) => {
  const provider = c.req.query('provider');
  const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
  if (provider) {
    const page = await getProviderCatalogPage(c.env, provider, offset, 10);
    return c.json({ provider: page });
  }
  const providers = await getProvidersCatalog(c.env);
  return c.json({ providers });
});
