const TTS_BASE_URL = 'https://translate.google.com/translate_tts';
const TTS_TIMEOUT_MS = 6000;
const MAX_TOTAL_CHARS = 600;
const MAX_CHUNK_CHARS = 180;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Strip markdown, code blocks, and URLs so text reads naturally in TTS.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongSegment(segment: string, maxLen: number): string[] {
  const words = segment.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxLen) {
      if (current) {
        parts.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxLen) {
        parts.push(word.slice(i, i + maxLen));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = word;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function chunkTextForSpeech(text: string): string[] {
  const capped =
    text.length > MAX_TOTAL_CHARS
      ? text.slice(0, MAX_TOTAL_CHARS).replace(/\s+\S*$/, '').trim() ||
        text.slice(0, MAX_TOTAL_CHARS)
      : text;

  const sentences = capped
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > MAX_CHUNK_CHARS) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitLongSegment(sentence, MAX_CHUNK_CHARS));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function fetchTtsChunk(chunk: string, lang: string): Promise<Uint8Array> {
  const url = `${TTS_BASE_URL}?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://translate.google.com/',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`TTS HTTP ${res.status}`);
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('TTS returned empty audio');
    }

    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}

/**
 * Synthesize speech using chunked Google Translate TTS.
 * Never throws; returns null on any error or empty input.
 */
export async function synthesizeSpeech(
  text: string,
  lang = 'ru',
): Promise<Uint8Array | null> {
  try {
    const cleaned = stripMarkdownForSpeech(text);
    if (!cleaned) return null;

    const chunks = chunkTextForSpeech(cleaned);
    if (chunks.length === 0) return null;

    const audioChunks: Uint8Array[] = [];
    for (const chunk of chunks) {
      const bytes = await fetchTtsChunk(chunk, lang);
      audioChunks.push(bytes);
    }

    const combined = concatUint8Arrays(audioChunks);
    return combined.byteLength > 0 ? combined : null;
  } catch (err) {
    console.error('TTS synthesis failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
