import type { ToolDefinition } from '../llm/types';

export interface ToolContext {
  db: D1Database;
  userId: number;
  chatId: number;
  timezone: string;
  ai?: Ai;
  vectorize?: VectorizeIndex;
  embeddingModel?: string;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  execute(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<Record<string, unknown>>;
}
