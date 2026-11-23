import type { AppEnv } from '../config/env';
import { FallbackLLMProvider } from './fallback';
import { OpenAICompatibleProvider } from './openai-compatible';
import type { LLMProvider } from './types';
import { WorkersAIProvider } from './workers-ai';

export function createLLMProvider(
  env: AppEnv,
  modelOverride?: string | null,
): LLMProvider {
  const chain: LLMProvider[] = [];

  if (env.LLM_PROVIDER === 'openai-compatible' && env.LLM_API_KEY) {
    chain.push(
      new OpenAICompatibleProvider(
        'custom-openai',
        env.LLM_BASE_URL ||
          'https://generativelanguage.googleapis.com/v1beta/openai',
        env.LLM_API_KEY,
        modelOverride || env.LLM_MODEL || 'gemini-3.5-flash-lite',
      ),
    );
  }

  // If user explicitly chose a Workers AI model (@cf/...), prioritize it first
  if (modelOverride && modelOverride.startsWith('@cf/')) {
    chain.push(new WorkersAIProvider(env.AI, modelOverride));
  }

  if (env.GEMINI_API_KEY) {
    chain.push(
      new OpenAICompatibleProvider(
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai',
        env.GEMINI_API_KEY,
        modelOverride && modelOverride.startsWith('gemini-')
          ? modelOverride
          : 'gemini-3.5-flash-lite',
      ),
    );
  }

  if (env.GROQ_API_KEY) {
    chain.push(
      new OpenAICompatibleProvider(
        'groq',
        'https://api.groq.com/openai/v1',
        env.GROQ_API_KEY,
        'llama-3.3-70b-versatile',
      ),
    );
  }

  if (env.IO_API_KEY) {
    chain.push(
      new OpenAICompatibleProvider(
        'io-net',
        'https://api.intelligence.io.solutions/api/v1',
        env.IO_API_KEY,
        'meta-llama/Llama-3.3-70B-Instruct',
      ),
    );
  }

  const workersFallbackModel =
    modelOverride && modelOverride.startsWith('@cf/')
      ? modelOverride
      : env.WORKERS_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it';

  if (!(modelOverride && modelOverride.startsWith('@cf/'))) {
    chain.push(new WorkersAIProvider(env.AI, workersFallbackModel));
  }

  return chain.length === 1 ? chain[0] : new FallbackLLMProvider(chain);
}
