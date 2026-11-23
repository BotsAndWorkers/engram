import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  ToolDefinition,
} from './types';

export class FallbackLLMProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error('FallbackLLMProvider requires at least one provider');
    }
    this.name = providers.map((p) => p.name).join('->');
    this.model = providers[0].model;
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await provider.chat(messages, tools);
      } catch (err) {
        lastError = err;
        console.warn(`LLM provider ${provider.name} failed, trying next`, {
          model: provider.model,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('All LLM providers failed');
  }

  async chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onDelta: (partialText: string) => Promise<void> | void,
  ): Promise<LLMResponse> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        if (provider.chatStream) {
          return await provider.chatStream(messages, tools, onDelta);
        }
        const res = await provider.chat(messages, tools);
        if (res.content) await onDelta(res.content);
        return res;
      } catch (err) {
        lastError = err;
        console.warn(`LLM stream ${provider.name} failed, trying next`, {
          model: provider.model,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('All LLM providers failed');
  }
}
