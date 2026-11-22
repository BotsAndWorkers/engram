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
    };

    if (formattedTools.length > 0) {
      payload.tools = formattedTools;
    }

    const raw = (await this.ai.run(
      this.model as keyof AiModels,
      payload,
    )) as WorkersAIRawResponse;

    return normalizeWorkersAIResponse(raw);
  }
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

  return {
    content: content.trim(),
    toolCalls,
  };
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
