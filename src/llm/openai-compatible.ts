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

interface OpenAISseChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
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
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = this.buildRequestBody(messages, tools, false);

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
      throw new Error(
        `${this.name} API error (${res.status}): ${errText.slice(0, 260)}`,
      );
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

  async chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onDelta: (partialText: string) => Promise<void> | void,
  ): Promise<LLMResponse> {
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = this.buildRequestBody(messages, tools, true);

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
      throw new Error(
        `${this.name} API error (${res.status}): ${errText.slice(0, 260)}`,
      );
    }

    if (!res.body) {
      throw new Error(`${this.name} returned empty stream body`);
    }

    return readOpenAISseStream(res.body, onDelta);
  }

  private buildRequestBody(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    stream: boolean,
  ): Record<string, unknown> {
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
          ...(msg.name ? { name: msg.name } : {}),
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
      ...(stream ? { stream: true } : {}),
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

    return body;
  }
}

async function readOpenAISseStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (partialText: string) => Promise<void> | void,
): Promise<LLMResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  const indexedCalls = new Map<
    number,
    { id?: string; name: string; argsRaw: string }
  >();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk: OpenAISseChunk;
        try {
          chunk = JSON.parse(payload) as OpenAISseChunk;
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullText += delta.content;
          await onDelta(fullText);
        }

        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const prev = indexedCalls.get(idx) ?? {
              id: tc.id,
              name: '',
              argsRaw: '',
            };
            if (tc.id) prev.id = tc.id;
            if (tc.function?.name) prev.name += tc.function.name;
            if (tc.function?.arguments) prev.argsRaw += tc.function.arguments;
            indexedCalls.set(idx, prev);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ToolCall[] = [];
  for (const [idx, entry] of indexedCalls) {
    if (!entry.name) continue;
    let args: Record<string, unknown> = {};
    if (entry.argsRaw.trim()) {
      try {
        args = JSON.parse(entry.argsRaw) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    toolCalls.push({
      id: entry.id || `call_${idx}_${Date.now()}`,
      name: entry.name,
      arguments: args,
    });
  }

  return { content: fullText.trim(), toolCalls };
}
