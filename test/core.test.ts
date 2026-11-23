import { describe, expect, it } from 'vitest';
import { parseCompactionJson } from '../src/agent/compaction';
import { buildSystemPrompt, hydrateHistory } from '../src/agent/runner';
import { parseAllowedUserIds } from '../src/config/env';
import { isQuietHour } from '../src/cron/reminders';
import { buildSafeFtsQuery } from '../src/db/queries';
import { FallbackLLMProvider } from '../src/llm/fallback';
import { stripMarkdownForSpeech } from '../src/llm/tts';
import {
  extractInlineToolCall,
  normalizeWorkersAIResponse,
} from '../src/llm/workers-ai';
import { verifySecretToken } from '../src/telegram/auth';
import { splitTelegramMessage } from '../src/telegram/client';
import { markdownToTelegramHtml } from '../src/telegram/format';
import {
  buildClearConfirmScreen,
  buildHelpScreen,
  MODEL_PRESETS,
  TIMEZONE_PRESETS,
} from '../src/telegram/ui';
import {
  decodeDuckDuckGoUrl,
  isPublicHttpUrl,
  parseDuckDuckGoHtml,
} from '../src/tools/web';
import { verifyTelegramInitData } from '../src/webapp/api';
import { renderMiniAppHtml } from '../src/webapp/app';

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

describe('telegram UI screens', () => {
  it('builds help and clear confirmation screens with valid callback_data lengths', () => {
    const help = buildHelpScreen();
    const clear = buildClearConfirmScreen();
    expect(help.replyMarkup.inline_keyboard[0][0].callback_data).toBe('menu:home');
    expect(clear.replyMarkup.inline_keyboard[0][0].callback_data).toBe('menu:clear_ok');
    expect(MODEL_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(TIMEZONE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('markdownToTelegramHtml', () => {
  it('converts headings, bold, italic, lists, links, and code blocks', () => {
    const input = [
      '# Заголовок',
      '',
      '**Жирный** и *курсив* и `inline <tag>`',
      '* Пункт 1',
      '- Пункт 2',
      '[Ссылка](https://example.com)',
      '```ts',
      'const x = a < b && c > d;',
      '```',
    ].join('\n');

    const html = markdownToTelegramHtml(input);
    expect(html).toContain('<b>Заголовок</b>');
    expect(html).toContain('<b>Жирный</b>');
    expect(html).toContain('<i>курсив</i>');
    expect(html).toContain('<code>inline &lt;tag&gt;</code>');
    expect(html).toContain('• Пункт 1');
    expect(html).toContain('• Пункт 2');
    expect(html).toContain('<a href="https://example.com">Ссылка</a>');
    expect(html).toContain('<pre><code>const x = a &lt; b &amp;&amp; c &gt; d;</code></pre>');
  });
});

describe('hydrateHistory', () => {
  it('drops orphan tool messages and enforces single tool call per assistant turn', () => {
    const hydrated = hydrateHistory([
      {
        id: 1,
        chat_id: 1,
        role: 'tool',
        content: '{"orphan":true}',
        tool_calls_json: null,
        tool_call_id: 'call_0',
        created_at: 1,
      },
      {
        id: 2,
        chat_id: 1,
        role: 'assistant',
        content: '',
        tool_calls_json: JSON.stringify([
          { id: 'call_1', name: 'a', arguments: {} },
          { id: 'call_2', name: 'b', arguments: {} },
        ]),
        tool_call_id: null,
        created_at: 2,
      },
      {
        id: 3,
        chat_id: 1,
        role: 'tool',
        content: '{"ok":1}',
        tool_calls_json: null,
        tool_call_id: 'call_1',
        created_at: 3,
      },
      {
        id: 4,
        chat_id: 1,
        role: 'tool',
        content: '{"ok":2}',
        tool_calls_json: null,
        tool_call_id: 'call_2',
        created_at: 4,
      },
    ]);

    expect(hydrated).toHaveLength(2);
    expect(hydrated[0].role).toBe('assistant');
    expect(hydrated[0].tool_calls).toHaveLength(1);
    expect(hydrated[1]).toEqual({
      role: 'tool',
      content: '{"ok":1}',
      tool_call_id: 'call_1',
    });
  });
});

describe('parseCompactionJson', () => {
  it('parses json wrapped in markdown fences including extracted facts', () => {
    const parsed = parseCompactionJson(
      '```json\n{"topic":"Настройка бота","episode_summary":"Обсудили память","rolling_summary":"Настроили бота и память","facts":[{"key":"bot_name","value":"Engram"}]}\n```',
    );
    expect(parsed.topic).toBe('Настройка бота');
    expect(parsed.episodeSummary).toBe('Обсудили память');
    expect(parsed.rollingSummary).toBe('Настроили бота и память');
    expect(parsed.facts).toEqual([{ key: 'bot_name', value: 'Engram' }]);
  });

  it('falls back gracefully on non-json output', () => {
    const parsed = parseCompactionJson('Краткая сводка без JSON');
    expect(parsed.topic).toBe('Диалог');
    expect(parsed.episodeSummary).toBe('Краткая сводка без JSON');
    expect(parsed.facts).toEqual([]);
  });

  it('extracts inline JSON tool call emitted as plain text', () => {
    const res = normalizeWorkersAIResponse({
      response:
        'Проверю историю. {"name": "search_past_conversations", "parameters": {"query": ""}}',
    });
    expect(res.content).toBe('Проверю историю.');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe('search_past_conversations');
    expect(res.toolCalls[0].arguments).toEqual({ query: '' });
    expect(extractInlineToolCall('Обычный ответ без JSON')).toBeNull();
  });

  it('builds structured XML system prompt with memory and summary', () => {
    const prompt = buildSystemPrompt(
      'Asia/Novosibirsk',
      [{ id: 1, user_id: 1, key: 'city', value: 'Novosibirsk', updated_at: 1 }],
      'Обсудили планы на неделю.',
    );
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<long_term_memory>');
    expect(prompt).toContain('city: Novosibirsk');
    expect(prompt).toContain('<recent_summary>');
    expect(prompt).toContain('<rules>');
  });
});

describe('web_search DuckDuckGo parser', () => {
  it('decodes uddg redirect URLs and parses search results', () => {
    expect(
      decodeDuckDuckGoUrl(
        '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc',
      ),
    ).toBe('https://example.com/docs');

    const sampleHtml = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcloudflare.com%2Fworkers">Cloudflare <b>Workers</b></a>
        <a class="result__snippet">Serverless edge runtime &amp; AI.</a>
      </div>
    `;
    const parsed = parseDuckDuckGoHtml(sampleHtml, 5);
    expect(parsed).toEqual([
      {
        title: 'Cloudflare Workers',
        url: 'https://cloudflare.com/workers',
        snippet: 'Serverless edge runtime & AI.',
      },
    ]);
  });
});

describe('jarvis upgrades (quiet hours, tts, mini app)', () => {
  it('evaluates quiet hours across midnight and daytime ranges', () => {
    expect(isQuietHour(23, 23, 8)).toBe(true);
    expect(isQuietHour(3, 23, 8)).toBe(true);
    expect(isQuietHour(8, 23, 8)).toBe(false);
    expect(isQuietHour(14, 23, 8)).toBe(false);
    expect(isQuietHour(12, 9, 18)).toBe(true);
    expect(isQuietHour(19, 9, 18)).toBe(false);
    expect(isQuietHour(12, null, null)).toBe(false);
  });

  it('strips markdown syntax cleanly for TTS speech', () => {
    const clean = stripMarkdownForSpeech(
      '# Заголовок\n**Привет**, вот [ссылка](https://example.com) и `код`!',
    );
    expect(clean).toBe('Заголовок Привет, вот ссылка и код!');
  });

  it('renders Mini App HTML and rejects invalid initData', async () => {
    const html = renderMiniAppHtml();
    expect(html).toContain('telegram-web-app.js');
    expect(html).toContain('/api/data');
    expect(await verifyTelegramInitData('', 'bot-token')).toBeNull();
    expect(await verifyTelegramInitData('user=%7B%22id%22%3A1%7D&hash=bad', 'bot-token')).toBeNull();
  });

  it('falls back to next LLM provider when primary fails', async () => {
    const provider = new FallbackLLMProvider([
      {
        name: 'primary',
        model: 'm1',
        async chat() {
          throw new Error('429 rate limit');
        },
      },
      {
        name: 'secondary',
        model: 'm2',
        async chat() {
          return { content: 'fallback ok', toolCalls: [] };
        },
      },
    ]);

    const res = await provider.chat([{ role: 'user', content: 'hi' }], []);
    expect(res.content).toBe('fallback ok');
  });
});
