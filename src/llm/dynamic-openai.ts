import { OpenAICompatibleProvider } from './openai-compatible';
import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  ToolDefinition,
} from './types';

const resolvedModelCache = new Map<string, string>();

/**
 * OpenAI-compatible provider that discovers working models dynamically via
 * `GET /models` when no cached model exists or when the current model fails
 * with a tier/availability error (HTTP 402/404).
 */
export class DynamicOpenAIProvider implements LLMProvider {
  readonly model: string;

  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly defaultModel?: string,
    private readonly filterFn?: (id: string) => boolean,
  ) {
    this.model =
      resolvedModelCache.get(this.cacheKey) || defaultModel || 'auto-discover';
  }

  private get cacheKey(): string {
    return `${this.name}:${this.baseUrl}`;
  }

  private async fetchCandidateModels(): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': 'engram-bot/1.0',
        },
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      return (json.data || [])
        .map((m) => (m.id ?? '').replace(/^models\//, ''))
        .filter(
          (id): id is string =>
            Boolean(id) && (!this.filterFn || this.filterFn(id)),
        );
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async runWithAutoDiscovery<T>(
    executor: (provider: OpenAICompatibleProvider) => Promise<T>,
  ): Promise<T> {
    const cached = resolvedModelCache.get(this.cacheKey) || this.defaultModel;
    if (cached) {
      try {
        const provider = new OpenAICompatibleProvider(
          this.name,
          this.baseUrl,
          this.apiKey,
          cached,
        );
        const result = await executor(provider);
        resolvedModelCache.set(this.cacheKey, cached);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Only retry other models on model/tier errors; rethrow auth/geo/rate errors immediately
        const isModelIssue =
          msg.includes('(402)') ||
          msg.includes('(404)') ||
          msg.includes('model_not_found');
        if (!isModelIssue) throw err;
        resolvedModelCache.delete(this.cacheKey);
      }
    }

    const candidates = (await this.fetchCandidateModels())
      .filter((id) => id !== cached)
      .slice(0, 10);

    if (candidates.length === 0) {
      throw new Error(`${this.name}: no accessible models found in /models`);
    }

    let lastError: unknown;
    for (const modelId of candidates) {
      try {
        const provider = new OpenAICompatibleProvider(
          this.name,
          this.baseUrl,
          this.apiKey,
          modelId,
        );
        const result = await executor(provider);
        resolvedModelCache.set(this.cacheKey, modelId);
        return result;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isModelIssue =
          msg.includes('(402)') ||
          msg.includes('(404)') ||
          msg.includes('model_not_found');
        if (!isModelIssue) throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${this.name}: all discovered models failed`);
  }

  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    return this.runWithAutoDiscovery((p) => p.chat(messages, tools));
  }

  chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onDelta: (partialText: string) => Promise<void> | void,
  ): Promise<LLMResponse> {
    return this.runWithAutoDiscovery((p) => p.chatStream(messages, tools, onDelta));
  }
}
