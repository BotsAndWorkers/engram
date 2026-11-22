import {
  createNote,
  deleteNote,
  getNoteById,
  getNotesByIds,
  listRecentNotes,
  searchNotes,
  updateNote,
} from '../db/queries';
import type { NoteRow } from '../db/types';
import { generateEmbeddingWithWorkersAI } from '../llm/workers-ai';
import type { RegisteredTool, ToolContext } from './types';

async function indexNoteVector(ctx: ToolContext, note: NoteRow): Promise<void> {
  if (!ctx.ai || !ctx.vectorize) return;
  try {
    const model = ctx.embeddingModel || '@cf/baai/bge-m3';
    const text = `${note.title}\n${note.tags}\n${note.content}`;
    const values = await generateEmbeddingWithWorkersAI(ctx.ai, model, text);
    if (!values) return;

    await ctx.vectorize.upsert([
      {
        id: `note_${note.id}`,
        values,
        metadata: { userId: ctx.userId, noteId: note.id },
      },
    ]);
  } catch (err) {
    console.error('Vectorize upsert failed', err);
  }
}

async function deleteNoteVector(ctx: ToolContext, noteId: number): Promise<void> {
  if (!ctx.vectorize) return;
  try {
    await ctx.vectorize.deleteByIds([`note_${noteId}`]);
  } catch (err) {
    console.error('Vectorize delete failed', err);
  }
}

async function semanticSearchNotes(
  ctx: ToolContext,
  query: string,
  topK = 6,
): Promise<NoteRow[]> {
  if (!ctx.ai || !ctx.vectorize) return [];
  try {
    const model = ctx.embeddingModel || '@cf/baai/bge-m3';
    const values = await generateEmbeddingWithWorkersAI(ctx.ai, model, query);
    if (!values) return [];

    const result = await ctx.vectorize.query(values, {
      topK,
      returnMetadata: 'all',
    });

    const ids: number[] = [];
    for (const match of result.matches) {
      if (match.score < 0.35) continue;
      const meta = match.metadata as { userId?: number; noteId?: number } | undefined;
      if (meta?.userId !== ctx.userId) continue;
      const noteId =
        typeof meta?.noteId === 'number'
          ? meta.noteId
          : Number.parseInt(match.id.replace('note_', ''), 10);
      if (Number.isFinite(noteId)) ids.push(noteId);
    }

    if (ids.length === 0) return [];
    const rows = await getNotesByIds(ctx.db, ctx.userId, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is NoteRow => Boolean(r));
  } catch (err) {
    console.error('Vectorize query failed', err);
    return [];
  }
}

export const noteTools: RegisteredTool[] = [
  {
    definition: {
      name: 'save_note',
      description:
        'Save a new note to the personal knowledge base. Use this when the user wants to store information, ideas, links, or summaries.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short descriptive title for the note',
          },
          content: {
            type: 'string',
            description: 'Full note text or markdown summary',
          },
          tags: {
            type: 'string',
            description:
              'Comma-separated lowercase tags without #, e.g. "ideas, work, cloudflare"',
          },
        },
        required: ['title', 'content'],
      },
    },
    async execute(args, ctx) {
      const title = String(args.title ?? '').trim();
      const content = String(args.content ?? '').trim();
      const tags = String(args.tags ?? '');

      if (!title || !content) {
        return { error: 'Both title and content are required.' };
      }

      const note = await createNote(ctx.db, ctx.userId, title, content, tags);
      await indexNoteVector(ctx, note);
      return {
        saved: true,
        id: note.id,
        title: note.title,
        tags: note.tags,
      };
    },
  },
  {
    definition: {
      name: 'search_notes',
      description:
        'Search saved notes by keywords and optional tag. Always use this before answering questions about past notes or saved knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search keywords or phrase',
          },
          tag: {
            type: 'string',
            description: 'Optional tag filter',
          },
        },
        required: ['query'],
      },
    },
    async execute(args, ctx) {
      const query = String(args.query ?? '').trim();
      const tag = args.tag ? String(args.tag) : undefined;

      if (!query) {
        return { error: 'query is required.' };
      }

      const [ftsNotes, vectorNotes] = await Promise.all([
        searchNotes(ctx.db, ctx.userId, query, tag, 8),
        tag ? Promise.resolve([]) : semanticSearchNotes(ctx, query, 6),
      ]);

      const merged = new Map<number, NoteRow>();
      for (const n of ftsNotes) merged.set(n.id, n);
      for (const n of vectorNotes) {
        if (!merged.has(n.id)) merged.set(n.id, n);
      }
      const notes = Array.from(merged.values()).slice(0, 8);

      return {
        count: notes.length,
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags,
          preview:
            n.content.length > 350
              ? `${n.content.slice(0, 350)}...`
              : n.content,
          updated_at: new Date(n.updated_at).toISOString(),
        })),
      };
    },
  },
  {
    definition: {
      name: 'get_note',
      description: 'Read the full content of a specific note by its numeric ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric note ID',
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

      const note = await getNoteById(ctx.db, ctx.userId, id);
      if (!note) {
        return { error: `Note #${id} not found.` };
      }
      return {
        id: note.id,
        title: note.title,
        content: note.content,
        tags: note.tags,
        updated_at: new Date(note.updated_at).toISOString(),
      };
    },
  },
  {
    definition: {
      name: 'update_note',
      description: 'Update title, content, or tags of an existing note by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric note ID',
          },
          title: {
            type: 'string',
            description: 'New title (optional)',
          },
          content: {
            type: 'string',
            description: 'New full content (optional)',
          },
          tags: {
            type: 'string',
            description: 'New comma-separated tags (optional)',
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

      const updated = await updateNote(ctx.db, ctx.userId, id, {
        title: args.title !== undefined ? String(args.title) : undefined,
        content: args.content !== undefined ? String(args.content) : undefined,
        tags: args.tags !== undefined ? String(args.tags) : undefined,
      });

      if (!updated) {
        return { error: `Note #${id} not found.` };
      }

      await indexNoteVector(ctx, updated);
      return {
        updated: true,
        id: updated.id,
        title: updated.title,
        tags: updated.tags,
      };
    },
  },
  {
    definition: {
      name: 'delete_note',
      description: 'Delete a note permanently by its numeric ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric note ID',
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

      const deleted = await deleteNote(ctx.db, ctx.userId, id);
      if (deleted) {
        await deleteNoteVector(ctx, id);
      }
      return { deleted, id };
    },
  },
  {
    definition: {
      name: 'list_recent_notes',
      description: 'List the most recently updated notes.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of notes to return (default 10, max 20)',
          },
        },
      },
    },
    async execute(args, ctx) {
      const rawLimit = Number(args.limit ?? 10);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(1, rawLimit), 20)
        : 10;

      const notes = await listRecentNotes(ctx.db, ctx.userId, limit);
      return {
        count: notes.length,
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags,
          updated_at: new Date(n.updated_at).toISOString(),
        })),
      };
    },
  },
];
