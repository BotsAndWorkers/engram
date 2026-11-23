import { getUserSettings, setUserModel } from '../db/queries';
import {
  getProvidersCatalog,
  probeAllProviders,
  probeOpenAIProvider,
} from '../llm/diagnostics';
import type { RegisteredTool } from './types';

export const infraTools: RegisteredTool[] = [
  {
    definition: {
      name: 'check_llm_providers',
      description:
        'Check live status, latency, and rate limits across all configured LLM providers (Google Gemini, Groq, io.net, Cloudflare Workers AI) and show the active model setting.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    async execute(_args, ctx) {
      if (!ctx.env) {
        return { error: 'Environment bindings unavailable.' };
      }
      const [settings, probes] = await Promise.all([
        getUserSettings(ctx.db, ctx.userId),
        probeAllProviders(ctx.env),
      ]);

      return {
        active_setting: settings?.model_override || 'auto',
        providers: probes,
      };
    },
  },
  {
    definition: {
      name: 'list_available_models',
      description:
        'Fetch the live catalog of available models from all configured providers or a specific provider (gemini, groq, io-net, workers-ai).',
      parameters: {
        type: 'object',
        properties: {
          provider: {
            type: 'string',
            description:
              'Optional provider filter: gemini, groq, io-net, or workers-ai',
            enum: ['gemini', 'groq', 'io-net', 'workers-ai'],
          },
        },
      },
    },
    async execute(args, ctx) {
      if (!ctx.env) {
        return { error: 'Environment bindings unavailable.' };
      }
      const catalog = await getProvidersCatalog(ctx.env);
      const filter = args.provider ? String(args.provider) : '';
      const filtered = filter
        ? catalog.filter((p) => p.id === filter)
        : catalog;

      return {
        providers: filtered.map((p) => ({
          id: p.id,
          name: p.name,
          configured: p.configured,
          error: p.error,
          models: p.models.map((m) => m.id),
        })),
      };
    },
  },
  {
    definition: {
      name: 'switch_llm_model',
      description:
        'Switch the active LLM model or restore "auto" fallback routing. Validates that the target model is actually accessible before switching, and refuses if unavailable or blocked.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description:
              'Target model ID (e.g. "auto", "gemini:gemini-3.5-flash-lite", "io:zai-org/GLM-5.3", "groq:llama-3.3-70b-versatile", "@cf/google/gemma-4-26b-a4b-it")',
          },
        },
        required: ['model'],
      },
    },
    async execute(args, ctx) {
      if (!ctx.env) {
        return { error: 'Environment bindings unavailable.' };
      }

      const raw = String(args.model ?? '').trim();
      if (!raw) {
        return { error: 'model parameter is required.' };
      }

      if (raw.toLowerCase() === 'auto' || raw.toLowerCase() === 'reset') {
        await setUserModel(ctx.db, ctx.userId, null);
        return {
          switched: true,
          active_setting: 'auto',
          message: 'Restored automatic fallback routing.',
        };
      }

      // Normalize bare gemini- prefix
      const target = raw.startsWith('gemini-') ? `gemini:${raw}` : raw;

      // Live verification before committing the switch
      if (target.startsWith('gemini:')) {
        const modelId = target.slice('gemini:'.length);
        const probe = await probeOpenAIProvider({
          id: 'gemini',
          name: 'Google Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: ctx.env.GEMINI_API_KEY,
          model: modelId,
        });
        if (!probe.ok) {
          return {
            switched: false,
            refused_reason: probe.details,
          };
        }
      } else if (target.startsWith('groq:')) {
        const modelId = target.slice('groq:'.length);
        const probe = await probeOpenAIProvider({
          id: 'groq',
          name: 'Groq',
          baseUrl: 'https://api.groq.com/openai/v1',
          apiKey: ctx.env.GROQ_API_KEY,
          model: modelId,
        });
        if (!probe.ok) {
          return {
            switched: false,
            refused_reason: probe.details,
          };
        }
      } else if (target.startsWith('io:')) {
        const modelId = target.slice('io:'.length);
        const probe = await probeOpenAIProvider({
          id: 'io-net',
          name: 'io.net',
          baseUrl: 'https://api.intelligence.io.solutions/api/v1',
          apiKey: ctx.env.IO_API_KEY,
          model: modelId,
        });
        if (!probe.ok) {
          return {
            switched: false,
            refused_reason: probe.details,
          };
        }
      } else if (target.startsWith('@cf/')) {
        try {
          await ctx.env.AI.run(target as keyof AiModels, {
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 5,
          });
        } catch (err) {
          return {
            switched: false,
            refused_reason:
              err instanceof Error ? err.message.slice(0, 180) : 'Workers AI error',
          };
        }
      } else {
        return {
          switched: false,
          refused_reason:
            'Unknown model format. Use "auto", "gemini:<id>", "groq:<id>", "io:<id>", or "@cf/...". Call list_available_models first to see valid IDs.',
        };
      }

      await setUserModel(ctx.db, ctx.userId, target);
      return {
        switched: true,
        active_setting: target,
      };
    },
  },
];
