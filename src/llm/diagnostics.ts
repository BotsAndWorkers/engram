import type { AppEnv } from '../config/env';
import { MODEL_PRESETS } from '../telegram/ui';

export interface ProviderProbeResult {
  id: string;
  name: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  details: string;
}

export interface CatalogProvider {
  id: string;
  name: string;
  configured: boolean;
  prefix: string;
  models: Array<{ id: string; label: string }>;
  totalInCatalog?: number;
  nextOffset?: number | null;
  error?: string;
}

export async function probeOpenAIProvider(params: {
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
      return {
        id: params.id,
        name: params.name,
        configured: true,
        ok: false,
        latencyMs,
        details: `HTTP ${res.status}: ${errText.slice(0, 140)}`,
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

async function findWorkingModels(
  baseUrl: string,
  apiKey: string,
  candidateIds: string[],
  maxChecks = 12,
): Promise<string[]> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const checks = candidateIds.slice(0, maxChecks).map(async (modelId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'engram-bot/1.0',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      return res.ok ? modelId : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  const results = await Promise.all(checks);
  return results.filter((id): id is string => Boolean(id));
}

export async function probeAllProviders(
  env: AppEnv,
): Promise<ProviderProbeResult[]> {
  const workersCheck = async (): Promise<ProviderProbeResult> => {
    const start = Date.now();
    const model =
      env.WORKERS_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it';
    try {
      await env.AI.run(model as keyof AiModels, {
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

  const ioNetCheck = async (): Promise<ProviderProbeResult> => {
    if (!env.IO_API_KEY) {
      return {
        id: 'io-net',
        name: 'io.net',
        configured: false,
        ok: false,
        latencyMs: null,
        details: 'Ключ не добавлен в секреты',
      };
    }

    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const listRes = await fetch(
        'https://api.intelligence.io.solutions/api/v1/models',
        {
          headers: {
            Authorization: `Bearer ${env.IO_API_KEY}`,
            'User-Agent': 'engram-bot/1.0',
          },
          signal: controller.signal,
        },
      );
      const latencyMs = Date.now() - start;
      if (!listRes.ok) {
        return {
          id: 'io-net',
          name: 'io.net',
          configured: true,
          ok: false,
          latencyMs,
          details: `HTTP ${listRes.status}`,
        };
      }
      const listJson = (await listRes.json()) as {
        data?: Array<{ id?: string }>;
      };
      const total = (listJson.data || []).length;
      return {
        id: 'io-net',
        name: 'io.net',
        configured: true,
        ok: true,
        latencyMs,
        details: `Ключ активен (моделей в каталоге: ${total})`,
      };
    } catch (err) {
      return {
        id: 'io-net',
        name: 'io.net',
        configured: true,
        ok: false,
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : 'Network error',
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const groqCheck = async (): Promise<ProviderProbeResult> => {
    if (!env.GROQ_API_KEY) {
      return {
        id: 'groq',
        name: 'Groq',
        configured: false,
        ok: false,
        latencyMs: null,
        details: 'Ключ не добавлен в секреты',
      };
    }

    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const listRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'User-Agent': 'engram-bot/1.0',
        },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - start;
      if (!listRes.ok) {
        const errText = await listRes.text();
        return {
          id: 'groq',
          name: 'Groq',
          configured: true,
          ok: false,
          latencyMs,
          details: `HTTP ${listRes.status}: ${errText.slice(0, 140)}`,
        };
      }
      const listJson = (await listRes.json()) as {
        data?: Array<{ id?: string }>;
      };
      const chatModels = (listJson.data || [])
        .map((m) => m.id)
        .filter(
          (id): id is string =>
            typeof id === 'string' &&
            id.length > 0 &&
            !id.includes('whisper') &&
            !id.includes('guard'),
        );

      if (chatModels.length === 0) {
        return {
          id: 'groq',
          name: 'Groq',
          configured: true,
          ok: false,
          latencyMs,
          details: 'В каталоге ключа нет доступных чат-моделей',
        };
      }

      const probe = await probeOpenAIProvider({
        id: 'groq',
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: env.GROQ_API_KEY,
        model: chatModels[0],
      });
      return {
        ...probe,
        details: `${probe.details} (всего в каталоге: ${chatModels.length}, напр.: ${chatModels.slice(0, 3).join(', ')})`,
      };
    } catch (err) {
      return {
        id: 'groq',
        name: 'Groq',
        configured: true,
        ok: false,
        latencyMs: Date.now() - start,
        details: err instanceof Error ? err.message : 'Network error',
      };
    } finally {
      clearTimeout(timer);
    }
  };

  return Promise.all([
    probeOpenAIProvider({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      model: 'gemini-3.5-flash-lite',
    }),
    groqCheck(),
    ioNetCheck(),
    workersCheck(),
  ]);
}

async function fetchOpenAIModelList(params: {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  prefix: string;
  filterFn?: (id: string) => boolean;
  verifyAccess?: boolean;
  offset?: number;
  batchSize?: number;
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
    const allIds = (json.data || [])
      .map((m) => (m.id ?? '').replace(/^models\//, ''))
      .filter((id) => Boolean(id) && (!params.filterFn || params.filterFn(id)));

    const offset = Math.max(0, params.offset ?? 0);
    const batchSize = Math.max(1, Math.min(params.batchSize ?? 10, 15));
    const slice = allIds.slice(offset, offset + batchSize);
    const nextOffset =
      offset + batchSize < allIds.length ? offset + batchSize : null;

    let verifiedIds = slice;
    if (params.verifyAccess && slice.length > 0 && params.apiKey) {
      verifiedIds = await findWorkingModels(
        params.baseUrl,
        params.apiKey,
        slice,
        batchSize,
      );
    }

    const models = verifiedIds.map((id) => ({
      id: `${params.prefix}${id}`,
      label: id,
    }));

    return {
      id: params.id,
      name: params.name,
      configured: true,
      prefix: params.prefix,
      models,
      totalInCatalog: allIds.length,
      nextOffset,
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

export async function getProviderCatalogPage(
  env: AppEnv,
  providerId: string,
  offset = 0,
  batchSize = 10,
): Promise<CatalogProvider | null> {
  if (providerId === 'gemini') {
    return fetchOpenAIModelList({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      prefix: 'gemini:',
      verifyAccess: true,
      offset,
      batchSize,
      filterFn: (id) =>
        id.startsWith('gemini-') &&
        !id.includes('embedding') &&
        !id.includes('imagen') &&
        !id.includes('veo') &&
        !id.includes('tts'),
    });
  }
  if (providerId === 'groq') {
    return fetchOpenAIModelList({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      prefix: 'groq:',
      verifyAccess: true,
      offset,
      batchSize,
      filterFn: (id) => !id.includes('whisper') && !id.includes('guard'),
    });
  }
  if (providerId === 'io-net') {
    return fetchOpenAIModelList({
      id: 'io-net',
      name: 'io.net',
      baseUrl: 'https://api.intelligence.io.solutions/api/v1',
      apiKey: env.IO_API_KEY,
      prefix: 'io:',
      verifyAccess: true,
      offset,
      batchSize,
    });
  }
  if (providerId === 'workers-ai') {
    const workersModels = MODEL_PRESETS.filter((m) =>
      m.id.startsWith('@cf/'),
    ).map((m) => ({ id: m.id, label: m.label }));
    return {
      id: 'workers-ai',
      name: 'Cloudflare Workers AI',
      configured: true,
      prefix: '',
      models: workersModels,
      totalInCatalog: workersModels.length,
      nextOffset: null,
    };
  }
  return null;
}

export async function getProvidersCatalog(
  env: AppEnv,
): Promise<CatalogProvider[]> {
  const results = await Promise.all([
    getProviderCatalogPage(env, 'gemini', 0, 10),
    getProviderCatalogPage(env, 'groq', 0, 10),
    getProviderCatalogPage(env, 'io-net', 0, 10),
    getProviderCatalogPage(env, 'workers-ai', 0, 10),
  ]);
  return results.filter((r): r is CatalogProvider => Boolean(r));
}
