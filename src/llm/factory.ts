import type { AppEnv } from '../config/env';
import { FallbackLLMProvider } from './fallback';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { LLMProvider } from './types';
import { WorkersAIProvider } from './workers-ai';

const IO_NET_DEFAULT_MODELS = [
  'nvidia/nemotron-3.5-super-vl',
  'zai-org/GLM-5.3',
  'deepseek-ai/DeepSeek-V4-Pro-0813',
  'moonshotai/Kimi-K3',
];

function parseModelOverride(override?: string | null): {
  provider?: 'gemini' | 'groq' | 'io' | 'workers-ai';
  model?: string;
} {
  if (!override) return {};
  if (override.startsWith('@cf/')) {
    return { provider: 'workers-ai', model: override };
  }
  if (override.startsWith('gemini:')) {
    return { provider: 'gemini', model: override.slice('gemini:'.length) };
  }
  if (override.startsWith('groq:')) {
    return { provider: 'groq', model: override.slice('groq:'.length) };
  }
  if (override.startsWith('io:')) {
    return { provider: 'io', model: override.slice('io:'.length) };
  }
  if (override.startsWith('gemini-')) {
    return { provider: 'gemini', model: override };
  }
  return { model: override };
}

export function createLLMProvider(
  env: AppEnv,
  modelOverride?: string | null,
): LLMProvider {
  const parsed = parseModelOverride(modelOverride);
  const chain: LLMProvider[] = [];

  if (env.LLM_PROVIDER === 'openai-compatible' && env.LLM_API_KEY) {
    chain.push(
      new OpenAICompatibleProvider(
        'custom-openai',
        env.LLM_BASE_URL ||
          'https://generativelanguage.googleapis.com/v1beta/openai',
        env.LLM_API_KEY,
        parsed.model || env.LLM_MODEL || 'gemini-3.5-flash-lite',
      ),
    );
  }

  // Put explicitly selected provider first
  if (parsed.provider === 'workers-ai' && parsed.model) {
    chain.push(new WorkersAIProvider(env.AI, parsed.model));
  } else if (parsed.provider === 'groq' && env.GROQ_API_KEY && parsed.model) {
    chain.push(
      new OpenAICompatibleProvider(
        'groq',
        'https://api.groq.com/openai/v1',
        env.GROQ_API_KEY,
        parsed.model,
      ),
    );
  } else if (parsed.provider === 'io' && env.IO_API_KEY && parsed.model) {
    chain.push(
      new OpenAICompatibleProvider(
        'io-net',
        'https://api.intelligence.io.solutions/api/v1',
        env.IO_API_KEY,
        parsed.model,
      ),
    );
  }

  if (env.GEMINI_API_KEY) {
    chain.push(
      new OpenAICompatibleProvider(
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai',
        env.GEMINI_API_KEY,
        parsed.provider === 'gemini' && parsed.model
          ? parsed.model
          : 'gemini-3.5-flash-lite',
      ),
    );
  }

  if (env.GROQ_API_KEY && parsed.provider !== 'groq') {
    chain.push(
      new OpenAICompatibleProvider(
        'groq',
        'https://api.groq.com/openai/v1',
        env.GROQ_API_KEY,
        'llama-3.1-8b-instant',
      ),
    );
  }

  if (env.IO_API_KEY) {
    for (const ioModel of IO_NET_DEFAULT_MODELS) {
      if (parsed.provider === 'io' && parsed.model === ioModel) continue;
      chain.push(
        new OpenAICompatibleProvider(
          'io-net',
          'https://api.intelligence.io.solutions/api/v1',
          env.IO_API_KEY,
          ioModel,
        ),
      );
    }
  }

  if (parsed.provider !== 'workers-ai') {
    chain.push(
      new WorkersAIProvider(
        env.AI,
        env.WORKERS_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it',
      ),
    );
  }

  return chain.length === 1 ? chain[0] : new FallbackLLMProvider(chain);
}
