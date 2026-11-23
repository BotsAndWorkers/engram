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
    try {
      const listRes = await fetch(
        'https://api.intelligence.io.solutions/api/v1/models',
        {
          headers: {
            Authorization: `Bearer ${env.IO_API_KEY}`,
            'User-Agent': 'engram-bot/1.0',
          },
        },
      );
      if (!listRes.ok) {
        return {
          id: 'io-net',
          name: 'io.net',
          configured: true,
          ok: false,
          latencyMs: Date.now() - start,
          details: `HTTP ${listRes.status}`,
        };
      }
      const listJson = (await listRes.json()) as {
        data?: Array<{ id?: string }>;
      };
      const candidates = (listJson.data || [])
        .map((m) => m.id)
        .filter((id): id is string => Boolean(id));
      // Keep total subrequests well below Cloudflare Free Tier's 50-fetch limit
      const prioritized = [
        'nvidia/nemotron-3.5-super-vl',
        ...candidates.filter((id) => id !== 'nvidia/nemotron-3.5-super-vl'),
      ];
      const working = await findWorkingModels(
        'https://api.intelligence.io.solutions/api/v1',
        env.IO_API_KEY,
        prioritized,
        10,
      );
      const latencyMs = Date.now() - start;
      if (working.length === 0) {
        return {
          id: 'io-net',
          name: 'io.net',
          configured: true,
          ok: false,
          latencyMs,
          details: `Проверено ${Math.min(prioritized.length, 10)} моделей — бесплатных на этом тире нет (402)`,
        };
      }
      return {
        id: 'io-net',
        name: 'io.net',
        configured: true,
        ok: true,
        latencyMs,
        details: `Доступно моделей: ${working.length} (${working.slice(0, 2).join(', ')})`,
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
    probeOpenAIProvider({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: 'llama-3.1-8b-instant',
    }),
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
    let rawIds = (json.data || [])
      .map((m) => (m.id ?? '').replace(/^models\//, ''))
      .filter((id) => Boolean(id) && (!params.filterFn || params.filterFn(id)));

    if (params.verifyAccess && rawIds.length > 0 && params.apiKey) {
      rawIds = await findWorkingModels(params.baseUrl, params.apiKey, rawIds, 10);
    }

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
      ...(params.verifyAccess && models.length === 0
        ? { error: 'Нет доступных бесплатных моделей на этом тарифе' }
        : {}),
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

export async function getProvidersCatalog(
  env: AppEnv,
): Promise<CatalogProvider[]> {
  const workersModels = MODEL_PRESETS.filter((m) =>
    m.id.startsWith('@cf/'),
  ).map((m) => ({ id: m.id, label: m.label }));

  const [gemini, groq, ioNet] = await Promise.all([
    fetchOpenAIModelList({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: env.GEMINI_API_KEY,
      prefix: 'gemini:',
      verifyAccess: true,
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
      apiKey: env.GROQ_API_KEY,
      prefix: 'groq:',
      verifyAccess: true,
      filterFn: (id) => !id.includes('whisper') && !id.includes('guard'),
    }),
    fetchOpenAIModelList({
      id: 'io-net',
      name: 'io.net',
      baseUrl: 'https://api.intelligence.io.solutions/api/v1',
      apiKey: env.IO_API_KEY,
      prefix: 'io:',
      verifyAccess: true,
    }),
  ]);

  const workersAi: CatalogProvider = {
    id: 'workers-ai',
    name: 'Cloudflare Workers AI',
    configured: true,
    prefix: '',
    models: workersModels,
  };

  return [gemini, groq, ioNet, workersAi];
}
