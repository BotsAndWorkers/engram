import {
  deleteMemory,
  listRecentEpisodes,
  searchEpisodes,
  upsertMemory,
} from '../db/queries';
import { formatLocalTime } from './reminders';
import type { RegisteredTool } from './types';

export const memoryTools: RegisteredTool[] = [
  {
    definition: {
      name: 'remember_fact',
      description:
        'Store or update a persistent fact about the user (preferences, projects, habits, names, contacts). Stored facts are always included in future conversations.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description:
              'Short snake_case identifier, e.g. "current_project", "favorite_stack", "city"',
          },
          value: {
            type: 'string',
            description: 'Concise fact value',
          },
        },
        required: ['key', 'value'],
      },
    },
    async execute(args, ctx) {
      const key = String(args.key ?? '').trim();
      const value = String(args.value ?? '').trim();

      if (!key || !value) {
        return { error: 'Both key and value are required.' };
      }

      const row = await upsertMemory(ctx.db, ctx.userId, key, value);
      return { saved: true, key: row.key, value: row.value };
    },
  },
  {
    definition: {
      name: 'forget_fact',
      description: 'Remove a previously remembered fact by its key.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Exact fact key to delete',
          },
        },
        required: ['key'],
      },
    },
    async execute(args, ctx) {
      const key = String(args.key ?? '').trim();
      if (!key) {
        return { error: 'key is required.' };
      }

      const deleted = await deleteMemory(ctx.db, ctx.userId, key);
      return { deleted, key };
    },
  },
  {
    definition: {
      name: 'search_past_conversations',
      description:
        'Search the episodic archive of past conversations by topic or keywords. Use this whenever the user asks what you discussed previously or asks to recall an older conversation.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Keywords or topic to search in past conversations (leave empty to list recent conversation episodes)',
          },
        },
      },
    },
    async execute(args, ctx) {
      const query = String(args.query ?? '').trim();
      const episodes = query
        ? await searchEpisodes(ctx.db, ctx.userId, query, 8)
        : await listRecentEpisodes(ctx.db, ctx.userId, 8);

      return {
        count: episodes.length,
        episodes: episodes.map((ep) => ({
          id: ep.id,
          topic: ep.topic,
          summary: ep.summary,
          date_local: formatLocalTime(ep.created_at, ctx.timezone),
        })),
      };
    },
  },
];
