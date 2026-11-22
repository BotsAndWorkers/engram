import { describe, expect, it } from 'vitest';
import { parseAllowedUserIds } from '../src/config/env';
import { buildSafeFtsQuery } from '../src/db/queries';
import { normalizeWorkersAIResponse } from '../src/llm/workers-ai';
import { verifySecretToken } from '../src/telegram/auth';
import { splitTelegramMessage } from '../src/telegram/client';
import { isPublicHttpUrl } from '../src/tools/web';

describe('buildSafeFtsQuery', () => {
  it('escapes special characters into prefix tokens', () => {
    expect(buildSafeFtsQuery('cloudflare: workers "d1" (test)')).toBe(
      '"cloudflare"* "workers"* "d1"* "test"*',
    );
  });

  it('drops single-character tokens and returns empty string when nothing remains', () => {
    expect(buildSafeFtsQuery('a ! ?')).toBe('');
  });
});

describe('splitTelegramMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(splitTelegramMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits long messages without exceeding maxLength', () => {
    const paragraph = 'word '.repeat(30).trim();
    const text = `${paragraph}\n\n${paragraph}`;
    const chunks = splitTelegramMessage(text, 160);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(160);
    }
  });
});

describe('isPublicHttpUrl', () => {
  it('allows public https URLs', () => {
    expect(isPublicHttpUrl('https://developers.cloudflare.com/workers/')?.hostname).toBe(
      'developers.cloudflare.com',
    );
  });

  it('blocks localhost, private networks, and non-http protocols', () => {
    expect(isPublicHttpUrl('http://localhost:8787')).toBeNull();
    expect(isPublicHttpUrl('http://127.0.0.1/admin')).toBeNull();
    expect(isPublicHttpUrl('http://192.168.1.1')).toBeNull();
    expect(isPublicHttpUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('normalizeWorkersAIResponse', () => {
  it('parses native Workers AI response with tool_calls', () => {
    const res = normalizeWorkersAIResponse({
      response: '',
      tool_calls: [
        {
          name: 'save_note',
          arguments: { title: 'Test', content: 'Body' },
        },
      ],
    });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe('save_note');
    expect(res.toolCalls[0].arguments).toEqual({ title: 'Test', content: 'Body' });
  });

  it('parses OpenAI-style choices response with JSON string arguments', () => {
    const res = normalizeWorkersAIResponse({
      choices: [
        {
          message: {
            content: 'Готово',
            tool_calls: [
              {
                id: 'tc_1',
                function: {
                  name: 'list_reminders',
                  arguments: '{"status":"pending"}',
                },
              },
            ],
          },
        },
      ],
    });
    expect(res.content).toBe('Готово');
    expect(res.toolCalls[0]).toEqual({
      id: 'tc_1',
      name: 'list_reminders',
      arguments: { status: 'pending' },
    });
  });
});

describe('auth helpers', () => {
  it('verifies matching secrets in constant time', async () => {
    expect(await verifySecretToken('my-secret-123', 'my-secret-123')).toBe(true);
    expect(await verifySecretToken('my-secret-123', 'my-secret-124')).toBe(false);
    expect(await verifySecretToken('short', 'much-longer-secret')).toBe(false);
    expect(await verifySecretToken(undefined, 'secret')).toBe(false);
  });

  it('parses comma-separated allowed user IDs', () => {
    const ids = parseAllowedUserIds('12345, 67890, invalid, -5');
    expect(ids.has(12345)).toBe(true);
    expect(ids.has(67890)).toBe(true);
    expect(ids.size).toBe(2);
  });
});
