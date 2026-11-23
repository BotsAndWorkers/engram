import {
  completeReminder,
  createReminder,
  deleteReminder,
  listReminders,
  updateReminder,
} from '../db/queries';
import type { RegisteredTool } from './types';

export function formatLocalTime(epochMs: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString();
  }
}

export const reminderTools: RegisteredTool[] = [
  {
    definition: {
      name: 'create_reminder',
      description:
        'Schedule a reminder for the user. Provide either due_at_iso (ISO 8601 timestamp with timezone offset, e.g. 2026-11-23T09:00:00+07:00) OR in_minutes (relative delay from now).',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Reminder message text',
          },
          due_at_iso: {
            type: 'string',
            description:
              'ISO 8601 date-time string with offset, e.g. 2026-11-23T10:00:00+07:00',
          },
          in_minutes: {
            type: 'number',
            description:
              'Alternative to due_at_iso: trigger after this many minutes from now',
          },
          repeat_minutes: {
            type: 'number',
            description:
              'Optional repeat interval in minutes (e.g. 1440 for daily, 10080 for weekly)',
          },
        },
        required: ['text'],
      },
    },
    async execute(args, ctx) {
      const text = String(args.text ?? '').trim();
      if (!text) {
        return { error: 'text is required.' };
      }

      let dueAt: number | null = null;
      if (args.in_minutes !== undefined) {
        const mins = Number(args.in_minutes);
        if (Number.isFinite(mins) && mins > 0) {
          dueAt = Date.now() + Math.round(mins * 60_000);
        }
      } else if (args.due_at_iso) {
        const parsed = Date.parse(String(args.due_at_iso));
        if (Number.isFinite(parsed)) {
          dueAt = parsed;
        }
      }

      if (!dueAt) {
        return {
          error:
            'Provide a valid due_at_iso (with timezone offset) or positive in_minutes.',
        };
      }

      const repeatMinutes =
        args.repeat_minutes !== undefined && Number(args.repeat_minutes) > 0
          ? Math.round(Number(args.repeat_minutes))
          : null;

      const reminder = await createReminder(ctx.db, {
        userId: ctx.userId,
        chatId: ctx.chatId,
        text,
        dueAt,
        repeatIntervalMinutes: repeatMinutes,
      });

      return {
        created: true,
        id: reminder.id,
        text: reminder.text,
        due_local: formatLocalTime(reminder.due_at, ctx.timezone),
        repeat_interval_minutes: reminder.repeat_interval_minutes,
      };
    },
  },
  {
    definition: {
      name: 'list_reminders',
      description: 'List user reminders filtered by status.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status: pending, done, or all',
            enum: ['pending', 'done', 'all'],
          },
        },
      },
    },
    async execute(args, ctx) {
      const statusRaw = String(args.status ?? 'pending');
      const status =
        statusRaw === 'done' || statusRaw === 'all' ? statusRaw : 'pending';

      const rows = await listReminders(ctx.db, ctx.userId, status, 20);
      return {
        count: rows.length,
        reminders: rows.map((r) => ({
          id: r.id,
          text: r.text,
          status: r.status,
          due_local: formatLocalTime(r.due_at, ctx.timezone),
          repeat_interval_minutes: r.repeat_interval_minutes,
        })),
      };
    },
  },
  {
    definition: {
      name: 'complete_reminder',
      description: 'Mark a pending reminder as completed by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric reminder ID',
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

      const completed = await completeReminder(ctx.db, ctx.userId, id);
      return { completed, id };
    },
  },
  {
    definition: {
      name: 'delete_reminder',
      description: 'Delete a reminder permanently by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric reminder ID',
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

      const deleted = await deleteReminder(ctx.db, ctx.userId, id);
      return { deleted, id };
    },
  },
  {
    definition: {
      name: 'update_reminder',
      description:
        'Update text, due date/time, or repeat interval of an existing reminder by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric reminder ID',
          },
          text: {
            type: 'string',
            description: 'New reminder text (optional)',
          },
          due_at_iso: {
            type: 'string',
            description:
              'New ISO 8601 date-time with timezone offset (optional)',
          },
          in_minutes: {
            type: 'number',
            description:
              'Alternative: reschedule to this many minutes from now (optional)',
          },
          repeat_minutes: {
            type: 'number',
            description:
              'New repeat interval in minutes, or 0 to disable repeating (optional)',
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

      let dueAt: number | undefined;
      if (args.in_minutes !== undefined) {
        const mins = Number(args.in_minutes);
        if (Number.isFinite(mins) && mins > 0) {
          dueAt = Date.now() + Math.round(mins * 60_000);
        }
      } else if (args.due_at_iso) {
        const parsed = Date.parse(String(args.due_at_iso));
        if (Number.isFinite(parsed)) {
          dueAt = parsed;
        }
      }

      const repeatIntervalMinutes =
        args.repeat_minutes === 0
          ? null
          : args.repeat_minutes !== undefined && Number(args.repeat_minutes) > 0
            ? Math.round(Number(args.repeat_minutes))
            : undefined;

      const updated = await updateReminder(ctx.db, ctx.userId, id, {
        text: args.text !== undefined ? String(args.text) : undefined,
        dueAt,
        repeatIntervalMinutes,
      });

      if (!updated) {
        return { error: `Reminder #${id} not found.` };
      }

      return {
        updated: true,
        id: updated.id,
        text: updated.text,
        due_local: formatLocalTime(updated.due_at, ctx.timezone),
        repeat_interval_minutes: updated.repeat_interval_minutes,
      };
    },
  },
];
