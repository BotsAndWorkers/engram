import type { RegisteredTool } from './types';

const MAX_CONTENT_CHARS = 6000;
const FETCH_TIMEOUT_MS = 8000;

export function isPublicHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export const webTools: RegisteredTool[] = [
  {
    definition: {
      name: 'fetch_url',
      description:
        'Fetch and extract clean readable markdown text from a public web URL. Useful when the user shares a link and wants a summary or wants to save it as a note.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Public http:// or https:// URL',
          },
        },
        required: ['url'],
      },
    },
    async execute(args) {
      const rawUrl = String(args.url ?? '').trim();
      const parsed = isPublicHttpUrl(rawUrl);
      if (!parsed) {
        return { error: 'Invalid or non-public URL.' };
      }

      const readerUrl = `https://r.jina.ai/${parsed.toString()}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const res = await fetch(readerUrl, {
          headers: { Accept: 'text/plain' },
          signal: controller.signal,
        });

        if (!res.ok) {
          return { error: `Failed to fetch URL (HTTP ${res.status}).` };
        }

        const text = await res.text();
        const truncated = text.length > MAX_CONTENT_CHARS;
        return {
          url: parsed.toString(),
          truncated,
          content: truncated
            ? `${text.slice(0, MAX_CONTENT_CHARS)}\n\n[truncated]`
            : text,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Fetch error';
        return { error: `Failed to fetch URL: ${message}` };
      } finally {
        clearTimeout(timer);
      }
    },
  },
];
