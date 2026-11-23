import {
  deleteDocument,
  getDocumentById,
  listRecentDocuments,
  searchDocuments,
} from '../db/queries';
import { formatLocalTime } from './reminders';
import type { RegisteredTool } from './types';

export const documentTools: RegisteredTool[] = [
  {
    definition: {
      name: 'search_documents',
      description:
        'Search saved documents (PDF, text, code, etc.) by filename or extracted content.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query or keywords',
          },
        },
        required: ['query'],
      },
    },
    async execute(args, ctx) {
      const query = String(args.query ?? '').trim();
      if (!query) {
        return { error: 'query is required.' };
      }

      const rows = await searchDocuments(ctx.db, ctx.userId, query);
      return {
        count: rows.length,
        documents: rows.map((d) => ({
          id: d.id,
          file_name: d.file_name,
          mime_type: d.mime_type,
          preview: d.content.slice(0, 300),
          created_local: formatLocalTime(d.created_at, ctx.timezone),
        })),
      };
    },
  },
  {
    definition: {
      name: 'get_document',
      description:
        'Get the full extracted content and metadata of a saved document by ID, including telegram_file_id so the user can ask to resend the original file.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric document ID',
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

      const doc = await getDocumentById(ctx.db, ctx.userId, id);
      if (!doc) {
        return { error: 'Document not found.' };
      }

      return {
        id: doc.id,
        file_name: doc.file_name,
        mime_type: doc.mime_type,
        telegram_file_id: doc.telegram_file_id,
        content: doc.content,
        created_local: formatLocalTime(doc.created_at, ctx.timezone),
      };
    },
  },
  {
    definition: {
      name: 'list_documents',
      description: 'List recently saved documents.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of documents to return (default 10)',
          },
        },
      },
    },
    async execute(args, ctx) {
      const rawLimit = args.limit !== undefined ? Number(args.limit) : 10;
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.round(rawLimit), 1), 50)
        : 10;

      const rows = await listRecentDocuments(ctx.db, ctx.userId, limit);
      return {
        count: rows.length,
        documents: rows.map((d) => ({
          id: d.id,
          file_name: d.file_name,
          mime_type: d.mime_type,
          created_local: formatLocalTime(d.created_at, ctx.timezone),
        })),
      };
    },
  },
  {
    definition: {
      name: 'delete_document',
      description: 'Delete a saved document permanently by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Numeric document ID',
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

      const deleted = await deleteDocument(ctx.db, ctx.userId, id);
      return { deleted, id };
    },
  },
];
