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
  getListItems,
  getTrackerSummary,
  getUserSettings,
  listMemories,
  listRecentDocuments,
  listRecentNotes,
  listReminders,
  setUserModel,
  toggleListItem,
} from '../db/queries';
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
  let body: { text?: unknown; inMinutes?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const mins = Number(body.inMinutes ?? 60);
  if (!text) return c.json({ error: 'text is required' }, 400);
  if (!Number.isFinite(mins) || mins <= 0) {
    return c.json({ error: 'Positive inMinutes required' }, 400);
  }

  const settings = await getUserSettings(c.env.DB, userId);
  const reminder = await createReminder(c.env.DB, {
    userId,
    chatId: settings?.chat_id ?? userId,
    text,
    dueAt: Date.now() + Math.round(mins * 60_000),
  });
  return c.json({ ok: true, reminder }, 201);
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

interface ProviderProbeResult {
  id: string;
  name: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  details: string;
}

async function probeOpenAIProvider(params: {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
}): Promise<ProviderProbeResult> {
  if (!params.apiKey) {
    return {
      id: params.id,
      name: params.name,
      configured: false,
      ok: false,
      latencyMs: null,
      details: 'Ключ не добавлен в секреты',
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(
      `${params.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
          'User-Agent': 'engram-bot/1.0',
        },
        body: JSON.stringify({
          model: params.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
        }),
        signal: controller.signal,
      },
    );

    const latencyMs = Date.now() - start;
    const remReq = res.headers.get('x-ratelimit-remaining-requests');
    const remTok = res.headers.get('x-ratelimit-remaining-tokens');
    const rateInfo = [
      remReq ? `запросов: ${remReq}` : '',
      remTok ? `токенов: ${remTok}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    if (!res.ok) {
      const errText = await res.text();
      let extraModels = '';
      if (res.status === 402 && params.id === 'io-net') {
        try {
          const modelsRes = await fetch(
            `${params.baseUrl.replace(/\/$/, '')}/models`,
            {
              headers: {
                Authorization: `Bearer ${params.apiKey}`,
                'User-Agent': 'engram-bot/1.0',
              },
            },
          );
          if (modelsRes.ok) {
            const mJson = (await modelsRes.json()) as {
              data?: Array<{ id?: string }>;
            };
            const ids = (mJson.data || [])
              .map((m) => m.id)
              .filter(Boolean)
              .slice(0, 5);
            if (ids.length > 0) {
              extraModels = ` | Доступны: ${ids.join(', ')}`;
            }
          }
        } catch {
          // ignore
        }
      }
      return {
        id: params.id,
        name: params.name,
        configured: true,
        ok: false,
        latencyMs,
        details: `HTTP ${res.status}: ${errText.slice(0, 110)}${extraModels}`,
      };
    }

    return {
      id: params.id,
      name: params.name,
      configured: true,
      ok: true,
      latencyMs,
      details: rateInfo ? `Доступен (${rateInfo})` : `Доступен (${params.model})`,
    };
  } catch (err) {
    return {
      id: params.id,
      name: params.name,
      configured: true,
      ok: false,
      latencyMs: Date.now() - start,
      details: err instanceof Error ? err.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

webAppRoutes.post('/api/models/check', async (c) => {
  const workersCheck = async (): Promise<ProviderProbeResult> => {
    const start = Date.now();
    const model =
      c.env.WORKERS_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it';
    try {
      await c.env.AI.run(model as keyof AiModels, {
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      });
      return {
        id: 'workers-ai',
        name: 'Cloudflare Workers AI',
        configured: true,
        ok: true,
        latencyMs: Date.now() - start,
        details: `Доступен (${model})`,
      };
    } catch (err) {
      return {
        id: 'workers-ai',
        name: 'Cloudflare Workers AI',
        configured: true,
        ok: false,
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message.slice(0, 140) : 'Error',
      };
    }
  };

  const results = await Promise.all([
    probeOpenAIProvider({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: c.env.GEMINI_API_KEY,
      model: 'gemini-3.5-flash-lite',
    }),
    probeOpenAIProvider({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: c.env.GROQ_API_KEY,
      model: 'llama-3.3-70b-versatile',
    }),
    probeOpenAIProvider({
      id: 'io-net',
      name: 'io.net',
      baseUrl: 'https://api.intelligence.io.solutions/api/v1',
      apiKey: c.env.IO_API_KEY,
      model: 'zai-org/GLM-5.3',
    }),
    workersCheck(),
  ]);

  return c.json({ results });
});

interface CatalogProvider {
  id: string;
  name: string;
  configured: boolean;
  prefix: string;
  models: Array<{ id: string; label: string }>;
  error?: string;
}

async function fetchOpenAIModelList(params: {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  prefix: string;
  filterFn?: (id: string) => boolean;
}): Promise<CatalogProvider> {
  if (!params.apiKey) {
    return {
      id: params.id,
      name: params.name,
      configured: false,
      prefix: params.prefix,
      models: [],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${params.baseUrl.replace(/\/$/, '')}/models`, {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'User-Agent': 'engram-bot/1.0',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        id: params.id,
        name: params.name,
        configured: true,
        prefix: params.prefix,
        models: [],
        error: `HTTP ${res.status}`,
      };
    }

    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const rawIds = (json.data || [])
      .map((m) => (m.id ?? '').replace(/^models\//, ''))
      .filter((id) => Boolean(id) && (!params.filterFn || params.filterFn(id)));

    const models = rawIds.slice(0, 24).map((id) => ({
      id: `${params.prefix}${id}`,
      label: id,
    }));

    return {
      id: params.id,
      name: params.name,
      configured: true,
      prefix: params.prefix,
      models,
    };
  } catch (err) {
    return {
      id: params.id,
      name: params.name,
      configured: true,
      prefix: params.prefix,
      models: [],
      error: err instanceof Error ? err.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

webAppRoutes.get('/api/models/catalog', async (c) => {
  const workersModels = MODEL_PRESETS.filter((m) =>
    m.id.startsWith('@cf/'),
  ).map((m) => ({ id: m.id, label: m.label }));

  const [gemini, groq, ioNet] = await Promise.all([
    fetchOpenAIModelList({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: c.env.GEMINI_API_KEY,
      prefix: 'gemini:',
      filterFn: (id) =>
        id.startsWith('gemini-') &&
        !id.includes('embedding') &&
        !id.includes('imagen') &&
        !id.includes('veo') &&
        !id.includes('tts'),
    }),
    fetchOpenAIModelList({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: c.env.GROQ_API_KEY,
      prefix: 'groq:',
      filterFn: (id) => !id.includes('whisper') && !id.includes('guard'),
    }),
    fetchOpenAIModelList({
      id: 'io-net',
      name: 'io.net',
      baseUrl: 'https://api.intelligence.io.solutions/api/v1',
      apiKey: c.env.IO_API_KEY,
      prefix: 'io:',
    }),
  ]);

  const workersAi: CatalogProvider = {
    id: 'workers-ai',
    name: 'Cloudflare Workers AI',
    configured: true,
    prefix: '',
    models: workersModels,
  };

  return c.json({ providers: [gemini, groq, ioNet, workersAi] });
});
