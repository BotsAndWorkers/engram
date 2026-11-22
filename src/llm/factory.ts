import type { AppEnv } from '../config/env';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { LLMProvider } from './types';
import { WorkersAIProvider } from './workers-ai';

export function createLLMProvider(
  env: AppEnv,
  modelOverride?: string | null,
): LLMProvider {
  if (env.LLM_PROVIDER === 'openai-compatible' && env.LLM_API_KEY) {
    const baseUrl =
      env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
    const model = modelOverride || env.LLM_MODEL || 'gemini-2.5-flash';
    return new OpenAICompatibleProvider(baseUrl, env.LLM_API_KEY, model);
  }

  const model =
    modelOverride || env.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  return new WorkersAIProvider(env.AI, model);
}
