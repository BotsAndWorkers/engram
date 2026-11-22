import {
  addListItems,
  deleteListItem,
  getListItems,
  toggleListItem,
} from '../db/queries';
import type { RegisteredTool } from './types';

export const listTools: RegisteredTool[] = [
  {
    definition: {
      name: 'add_to_list',
      description:
        'Add one or more items to a named checklist (e.g. "покупки", "фильмы", "дела", "книги").',
      parameters: {
        type: 'object',
        properties: {
          list_name: {
            type: 'string',
            description: 'Short lowercase list name, e.g. "покупки" or "фильмы"',
          },
          items: {
            type: 'string',
            description:
              'Comma-separated or newline-separated items to add (e.g. "молоко, хлеб, кофе")',
          },
        },
        required: ['list_name', 'items'],
      },
    },
    async execute(args, ctx) {
      const listName = String(args.list_name ?? 'общий').trim();
      const rawItems = args.items;
      const parsedItems = Array.isArray(rawItems)
        ? rawItems.map((x) => String(x))
        : String(rawItems ?? '')
            .split(/[\n,;]+/)
            .map((x) => x.trim())
            .filter(Boolean);

      if (parsedItems.length === 0) {
        return { error: 'At least one item is required.' };
      }

      const added = await addListItems(ctx.db, ctx.userId, listName, parsedItems);
      return {
        added: added.length,
        list_name: listName.toLowerCase(),
        items: added.map((i) => ({ id: i.id, text: i.text })),
      };
    },
  },
  {
    definition: {
      name: 'get_list',
      description: 'Show items from a specific checklist or all checklists.',
      parameters: {
        type: 'object',
        properties: {
          list_name: {
            type: 'string',
            description: 'Optional list name filter',
          },
        },
      },
    },
    async execute(args, ctx) {
      const listName = args.list_name ? String(args.list_name) : undefined;
      const items = await getListItems(ctx.db, ctx.userId, listName);
      return {
        count: items.length,
        items: items.map((i) => ({
          id: i.id,
          list_name: i.list_name,
          text: i.text,
          done: Boolean(i.done),
        })),
      };
    },
  },
  {
    definition: {
      name: 'toggle_list_item',
      description: 'Mark a checklist item as done or undone by its numeric ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric list item ID',
          },
          done: {
            type: 'boolean',
            description: 'Optional explicit state (true = done, false = open)',
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
      const explicitDone =
        typeof args.done === 'boolean' ? args.done : undefined;
      const updated = await toggleListItem(ctx.db, ctx.userId, id, explicitDone);
      if (!updated) {
        return { error: `List item #${id} not found.` };
      }
      return {
        id: updated.id,
        text: updated.text,
        done: Boolean(updated.done),
      };
    },
  },
  {
    definition: {
      name: 'remove_list_item',
      description: 'Delete a checklist item permanently by its numeric ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric list item ID',
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
      const deleted = await deleteListItem(ctx.db, ctx.userId, id);
      return { deleted, id };
    },
  },
];
