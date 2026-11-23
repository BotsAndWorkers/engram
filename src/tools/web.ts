import type { RegisteredTool } from './types';

const MAX_CONTENT_CHARS = 6000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SEARCH_RESULTS = 5;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface DdgRelatedTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgRelatedTopic[];
}

interface DdgInstantAnswerResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: DdgRelatedTopic[];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function stripHtmlTags(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, '');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

export function decodeDuckDuckGoUrl(rawHref: string): string {
  const href = decodeHtmlEntities(rawHref).trim();
  if (!href) return '';

  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      return uddg;
    }
    if (href.startsWith('//')) {
      return `https:${href}`;
    }
    return href;
  } catch {
    const match = href.match(/[?&]uddg=([^&]+)/);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return href.startsWith('//') ? `https:${href}` : href;
  }
}

export function parseDuckDuckGoHtml(
  html: string,
  limit = MAX_SEARCH_RESULTS,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const anchorRegex =
    /<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const anchors = Array.from(html.matchAll(anchorRegex));

  for (let i = 0; i < anchors.length && results.length < limit; i++) {
    const match = anchors[i];
    const attrs = match[1] ?? '';
    const rawTitle = match[2] ?? '';
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) continue;

    const url = decodeDuckDuckGoUrl(hrefMatch[1]);
    if (!url || url.includes('duckduckgo.com/y.js')) continue;

    const title = stripHtmlTags(rawTitle);
    if (!title) continue;

    const blockStart = (match.index ?? 0) + match[0].length;
    const blockEnd = anchors[i + 1]?.index ?? html.length;
    const block = html.slice(blockStart, blockEnd);

    const snippetMatch = block.match(
      /<(?:a|div|span)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
    );
    const snippet = snippetMatch?.[1] ? stripHtmlTags(snippetMatch[1]) : '';

    results.push({ title, url, snippet });
  }

  return results;
}

function extractInstantAnswerResults(
  data: DdgInstantAnswerResponse,
  query: string,
  limit = MAX_SEARCH_RESULTS,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  const abstractText = data.AbstractText?.trim();
  if (abstractText) {
    results.push({
      title: data.Heading?.trim() || query,
      url: data.AbstractURL?.trim() || '',
      snippet: abstractText,
    });
  }

  const pushTopic = (topic: DdgRelatedTopic) => {
    if (results.length >= limit) return;
    if (Array.isArray(topic.Topics)) {
      for (const nested of topic.Topics) {
        pushTopic(nested);
        if (results.length >= limit) break;
      }
      return;
    }

    const text = topic.Text?.trim();
    const url = topic.FirstURL?.trim();
    if (!text || !url) return;

    const dashIdx = text.indexOf(' - ');
    const title = dashIdx > 0 ? text.slice(0, dashIdx).trim() : text;
    results.push({ title, url, snippet: text });
  };

  for (const topic of data.RelatedTopics ?? []) {
    pushTopic(topic);
    if (results.length >= limit) break;
  }

  return results;
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

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
  {
    definition: {
      name: 'web_search',
      description:
        'Search the public web for up-to-date information, documentation, news, or answers. Returns top matching titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
        },
        required: ['query'],
      },
    },
    async execute(args) {
      const query = String(args.query ?? '').trim();
      if (!query) {
        return { error: 'Search query is required.' };
      }

      const encoded = encodeURIComponent(query);
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;

      try {
        let results: WebSearchResult[] = [];

        const htmlRes = await fetchWithTimeout(htmlUrl, {
          'User-Agent': BROWSER_USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        });

        if (htmlRes.ok) {
          const html = await htmlRes.text();
          results = parseDuckDuckGoHtml(html, MAX_SEARCH_RESULTS);
        }

        if (results.length === 0) {
          const apiUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`;
          const apiRes = await fetchWithTimeout(apiUrl, {
            'User-Agent': BROWSER_USER_AGENT,
            Accept: 'application/json',
          });

          if (!apiRes.ok) {
            return {
              error: `Web search failed (HTTP ${apiRes.status}).`,
            };
          }

          const data = (await apiRes.json()) as DdgInstantAnswerResponse;
          results = extractInstantAnswerResults(
            data,
            query,
            MAX_SEARCH_RESULTS,
          );
        }

        return {
          query,
          results,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Search error';
        return { error: `Web search failed: ${message}` };
      }
    },
  },
];
