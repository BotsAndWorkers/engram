import {
  addTrackerEntry,
  deleteTrackerEntry,
  getTrackerEntries,
  getTrackerSummary,
} from '../db/queries';
import { formatLocalTime } from './reminders';
import type { RegisteredTool } from './types';

function parseDays(raw: unknown, defaultDays = 30): number {
  if (raw === undefined || raw === null) return defaultDays;
  const num = Number(raw);
  if (!Number.isFinite(num)) return defaultDays;
  return Math.min(Math.max(Math.round(num), 1), 365);
}

export const trackerTools: RegisteredTool[] = [
  {
    definition: {
      name: 'log_tracker_entry',
      description:
        'Log a personal tracker entry (e.g. expense, workout, habit, water, sleep, mood).',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description:
              'Lowercase category name, e.g. "expense", "workout", "habit", "water", "mood"',
          },
          label: {
            type: 'string',
            description: 'Short label or item description, e.g. "coffee", "running"',
          },
          amount: {
            type: 'number',
            description: 'Optional numeric value (e.g. 250, 5.5)',
          },
          unit: {
            type: 'string',
            description: 'Optional unit for amount (e.g. "RUB", "km", "ml", "min")',
          },
          note: {
            type: 'string',
            description: 'Optional extra note',
          },
        },
        required: ['category', 'label'],
      },
    },
    async execute(args, ctx) {
      const category = String(args.category ?? '').trim();
      const label = String(args.label ?? '').trim();
      if (!category || !label) {
        return { error: 'Both category and label are required.' };
      }

      let amount: number | null = null;
      if (args.amount !== undefined && args.amount !== null && args.amount !== '') {
        const parsed = Number(args.amount);
        if (!Number.isFinite(parsed)) {
          return { error: 'amount must be a valid number.' };
        }
        amount = parsed;
      }

      const unit = args.unit !== undefined && args.unit !== null ? String(args.unit) : null;
      const note = args.note !== undefined && args.note !== null ? String(args.note) : null;

      const entry = await addTrackerEntry(ctx.db, {
        userId: ctx.userId,
        category,
        label,
        amount,
        unit,
        note,
      });

      return {
        logged: true,
        id: entry.id,
        category: entry.category,
        label: entry.label,
        amount: entry.amount,
        unit: entry.unit,
        note: entry.note,
        created_local: formatLocalTime(entry.created_at, ctx.timezone),
      };
    },
  },
  {
    definition: {
      name: 'get_tracker_summary',
      description:
        'Get aggregated counts and totals per tracker category and unit over the last N days.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Number of days to look back (default 30)',
          },
        },
      },
    },
    async execute(args, ctx) {
      const days = parseDays(args.days, 30);
      const summary = await getTrackerSummary(ctx.db, ctx.userId, days);
      return {
        days,
        summary,
      };
    },
  },
  {
    definition: {
      name: 'list_tracker_entries',
      description:
        'List recent personal tracker entries, optionally filtered by category and lookback days.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Optional category filter',
          },
          days: {
            type: 'number',
            description: 'Number of days to look back (default 30)',
          },
        },
      },
    },
    async execute(args, ctx) {
      const category =
        typeof args.category === 'string' && args.category.trim()
          ? args.category.trim()
          : undefined;
      const days = parseDays(args.days, 30);

      const rows = await getTrackerEntries(ctx.db, ctx.userId, category, days);
      return {
        days,
        count: rows.length,
        entries: rows.map((e) => ({
          id: e.id,
          category: e.category,
          label: e.label,
          amount: e.amount,
          unit: e.unit,
          note: e.note,
          created_local: formatLocalTime(e.created_at, ctx.timezone),
        })),
      };
    },
  },
  {
    definition: {
      name: 'delete_tracker_entry',
      description: 'Delete a tracker entry permanently by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric tracker entry ID',
          },
        },
        required: ['id'],
      },
    },
    async execute(args, ctx) {
      const id = Number(args.id);
      if (!Number.isFinite(id)) {
        return { error: 'Valid numeric id is required.' };
      }

      const deleted = await deleteTrackerEntry(ctx.db, ctx.userId, id);
      return { deleted, id };
    },
  },
];
