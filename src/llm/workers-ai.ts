import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  ToolCall,
  ToolDefinition,
} from './types';

interface WorkersAIRawToolCall {
  id?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

interface WorkersAIRawResponse {
  response?: string | null;
  tool_calls?: WorkersAIRawToolCall[];
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: WorkersAIRawToolCall[];
    };
  }>;
}

export class WorkersAIProvider implements LLMProvider {
  readonly name = 'workers-ai';

  constructor(
    private readonly ai: Ai,
    readonly model: string,
  ) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    const payload = this.buildPayload(messages, tools, false);
    const raw = (await this.ai.run(
      this.model as keyof AiModels,
      payload,
    )) as WorkersAIRawResponse;

    return normalizeWorkersAIResponse(raw);
  }

  async chatStream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onDelta: (partialText: string) => Promise<void> | void,
  ): Promise<LLMResponse> {
    const payload = this.buildPayload(messages, tools, true);
    const raw = await this.ai.run(this.model as keyof AiModels, payload);

    if (
      raw &&
      typeof raw === 'object' &&
      'getReader' in raw &&
      typeof (raw as ReadableStream).getReader === 'function'
    ) {
      return readWorkersAISseStream(
        raw as ReadableStream<Uint8Array>,
        onDelta,
      );
    }

    const normalized = normalizeWorkersAIResponse(raw as WorkersAIRawResponse);
    if (normalized.content) {
      await onDelta(normalized.content);
    }
    return normalized;
  }

  private buildPayload(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    stream: boolean,
  ): Record<string, unknown> {
    const formattedMessages = messages.map((msg) => {
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        return {
          role: 'assistant' as const,
          content: msg.content || '',
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.tool_call_id,
          name: msg.name,
        };
      }

      return {
        role: msg.role,
        content: msg.content,
      };
    });

    const formattedTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const payload: Record<string, unknown> = {
      messages: formattedMessages,
      max_tokens: 1500,
      ...(stream ? { stream: true } : {}),
    };

    if (formattedTools.length > 0) {
      payload.tools = formattedTools;
    }

    return payload;
  }
}

interface WorkersAISseChunk {
  response?: string | null;
  tool_calls?: WorkersAIRawToolCall[];
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
    message?: {
      content?: string | null;
      tool_calls?: WorkersAIRawToolCall[];
    };
  }>;
}

async function readWorkersAISseStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (partialText: string) => Promise<void> | void,
): Promise<LLMResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  const directToolCalls: WorkersAIRawToolCall[] = [];
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

        let chunk: WorkersAISseChunk;
        try {
          chunk = JSON.parse(payload) as WorkersAISseChunk;
        } catch {
          continue;
        }

        const deltaText =
          chunk.choices?.[0]?.delta?.content ??
          chunk.choices?.[0]?.message?.content ??
          chunk.response ??
          '';

        if (deltaText) {
          fullText += deltaText;
          await onDelta(fullText);
        }

        if (chunk.tool_calls?.length) {
          directToolCalls.push(...chunk.tool_calls);
        }
        if (chunk.choices?.[0]?.message?.tool_calls?.length) {
          directToolCalls.push(...chunk.choices[0].message.tool_calls);
        }

        const deltaCalls = chunk.choices?.[0]?.delta?.tool_calls;
        if (deltaCalls?.length) {
          for (const dc of deltaCalls) {
            const idx = dc.index ?? 0;
            const prev = indexedCalls.get(idx) ?? {
              id: dc.id,
              name: '',
              argsRaw: '',
            };
            if (dc.id) prev.id = dc.id;
            if (dc.function?.name) prev.name += dc.function.name;
            if (dc.function?.arguments) prev.argsRaw += dc.function.arguments;
            indexedCalls.set(idx, prev);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combinedRawCalls: WorkersAIRawToolCall[] = [...directToolCalls];
  for (const [, entry] of indexedCalls) {
    if (entry.name) {
      combinedRawCalls.push({
        id: entry.id,
        name: entry.name,
        arguments: entry.argsRaw,
      });
    }
  }

  return normalizeWorkersAIResponse({
    response: fullText,
    tool_calls: combinedRawCalls,
  });
}

export function normalizeWorkersAIResponse(
  raw: WorkersAIRawResponse,
): LLMResponse {
  const choiceMsg = raw.choices?.[0]?.message;
  const content = (choiceMsg?.content ?? raw.response ?? '') || '';
  const rawCalls = choiceMsg?.tool_calls ?? raw.tool_calls ?? [];

  const toolCalls: ToolCall[] = [];
  for (let i = 0; i < rawCalls.length; i += 1) {
    const call = rawCalls[i];
    const name = call.function?.name ?? call.name;
    if (!name) continue;

    const rawArgs = call.function?.arguments ?? call.arguments ?? {};
    const parsedArgs = parseToolArguments(rawArgs);

    toolCalls.push({
      id: call.id || `call_${i}_${Date.now()}`,
      name,
      arguments: parsedArgs,
    });
  }

  let cleanContent = content.trim();
  if (toolCalls.length === 0 && cleanContent) {
    const extracted = extractInlineToolCall(cleanContent);
    if (extracted) {
      cleanContent = extracted.cleanText;
      toolCalls.push(extracted.toolCall);
    }
  }

  return {
    content: cleanContent,
    toolCalls,
  };
}

/**
 * Some open-weight models emit a raw JSON tool call inline at the end of text
 * instead of structured tool_calls. Extract it so it executes cleanly and
 * never leaks raw JSON to the user.
 */
export function extractInlineToolCall(
  text: string,
): { cleanText: string; toolCall: ToolCall } | null {
  const match = text.match(
    /\{\s*"name"\s*:\s*"([a-z0-9_]+)"\s*,\s*"(?:parameters|arguments)"\s*:\s*(\{[\s\S]*\})\s*\}\s*$/i,
  );
  if (!match) return null;

  const toolName = match[1];
  const argsRaw = match[2];
  try {
    const parsedArgs = JSON.parse(argsRaw) as Record<string, unknown>;
    const cleanText = text.slice(0, match.index).trim();
    return {
      cleanText,
      toolCall: {
        id: `inline_${Date.now()}`,
        name: toolName,
        arguments:
          typeof parsedArgs === 'object' && parsedArgs !== null ? parsedArgs : {},
      },
    };
  } catch {
    return null;
  }
}

function parseToolArguments(
  raw: string | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof raw !== 'string') {
    return raw ?? {};
  }
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function transcribeAudioWithWorkersAI(
  ai: Ai,
  whisperModel: string,
  audioBuffer: ArrayBuffer,
): Promise<string> {
  const result = (await ai.run(whisperModel as keyof AiModels, {
    audio: [...new Uint8Array(audioBuffer)],
  })) as { text?: string };

  return (result.text ?? '').trim();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function describeImageWithWorkersAI(
  ai: Ai,
  visionModel: string,
  imageBuffer: ArrayBuffer,
  caption?: string,
): Promise<string> {
  const base64 = arrayBufferToBase64(imageBuffer);
  const prompt = caption
    ? `Пользователь прислал изображение с подписью: "${caption}". Подробно опиши содержимое изображения, извлеки весь важный текст (если есть) и помоги ответить на запрос пользователя.`
    : 'Подробно опиши содержимое этого изображения на русском языке и точно извлеки весь видимый текст, цифры, даты или контакты, если они есть.';

  const result = (await ai.run(visionModel as keyof AiModels, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          },
        ],
      },
    ],
    max_tokens: 900,
  })) as WorkersAIRawResponse;

  return normalizeWorkersAIResponse(result).content;
}

export async function generateEmbeddingWithWorkersAI(
  ai: Ai,
  embeddingModel: string,
  text: string,
): Promise<number[] | null> {
  const trimmed = text.trim().slice(0, 4000);
  if (!trimmed) return null;

  const result = (await ai.run(embeddingModel as keyof AiModels, {
    text: [trimmed],
  })) as { data?: number[][] };

  const vector = result.data?.[0];
  return Array.isArray(vector) && vector.length > 0 ? vector : null;
}
