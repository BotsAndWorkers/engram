import type { ToolDefinition } from '../llm/types';
import { documentTools } from './documents';
import { listTools } from './lists';
import { memoryTools } from './memory';
import { noteTools } from './notes';
import { reminderTools } from './reminders';
import { trackerTools } from './trackers';
import type { RegisteredTool, ToolContext } from './types';
import { webTools } from './web';

const ALL_TOOLS: RegisteredTool[] = [
  ...noteTools,
  ...reminderTools,
  ...listTools,
  ...documentTools,
  ...trackerTools,
  ...memoryTools,
  ...webTools,
];

const TOOL_MAP = new Map<string, RegisteredTool>(
  ALL_TOOLS.map((tool) => [tool.definition.name, tool]),
);

export function getToolDefinitions(): ToolDefinition[] {
  return ALL_TOOLS.map((t) => t.definition);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  try {
    const result = await tool.execute(args, ctx);
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution error';
    return JSON.stringify({ error: message });
  }
}
