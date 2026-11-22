import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from './types';

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const formattedMessages = messages.map((msg) => {
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    const body: Record<string, unknown> = {
      model: this.model,
      messages: formattedMessages,
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API error (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as OpenAICompatibleResponse;
    const message = data.choices?.[0]?.message;
    const content = (message?.content ?? '').trim();
    const rawCalls = message?.tool_calls ?? [];

    const toolCalls: ToolCall[] = [];
    for (let i = 0; i < rawCalls.length; i += 1) {
      const call = rawCalls[i];
      const fnName = call.function?.name;
      if (!fnName) continue;

      let args: Record<string, unknown> = {};
      if (call.function?.arguments) {
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
      }

      toolCalls.push({
        id: call.id || `call_${i}_${Date.now()}`,
        name: fnName,
        arguments: args,
      });
    }

    return { content, toolCalls };
  }
}
