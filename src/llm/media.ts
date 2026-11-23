import type { AppEnv } from '../config/env';
import {
  describeImageWithWorkersAI,
  transcribeAudioWithWorkersAI,
} from './workers-ai';

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function transcribeWithGemini(
  apiKey: string,
  audioBuffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const base64 = arrayBufferToBase64(audioBuffer);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Transcribe this voice message verbatim in its original language. Return only the transcribed text without quotes or extra commentary.',
              },
              {
                inline_data: {
                  mime_type: mimeType || 'audio/ogg',
                  data: base64,
                },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini audio error (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  if (!text) throw new Error('Gemini returned empty transcription');
  return text;
}

async function transcribeWithGroq(
  apiKey: string,
  audioBuffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([audioBuffer], { type: mimeType || 'audio/ogg' }),
    'voice.ogg',
  );
  form.append('model', 'whisper-large-v3-turbo');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'engram-bot/1.0',
    },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq whisper error (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? '').trim();
  if (!text) throw new Error('Groq returned empty transcription');
  return text;
}

export async function transcribeAudio(
  env: AppEnv,
  audioBuffer: ArrayBuffer,
  mimeType = 'audio/ogg',
): Promise<string> {
  const errors: string[] = [];

  if (env.GEMINI_API_KEY) {
    try {
      return await transcribeWithGemini(env.GEMINI_API_KEY, audioBuffer, mimeType);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (env.GROQ_API_KEY) {
    try {
      return await transcribeWithGroq(env.GROQ_API_KEY, audioBuffer, mimeType);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const whisperModel = env.WORKERS_AI_WHISPER_MODEL || '@cf/openai/whisper';
    return await transcribeAudioWithWorkersAI(env.AI, whisperModel, audioBuffer);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    throw new Error(`Не удалось распознать аудио: ${errors.join(' | ')}`);
  }
}

async function describeImageWithGemini(
  apiKey: string,
  imageBuffer: ArrayBuffer,
  caption?: string,
): Promise<string> {
  const base64 = arrayBufferToBase64(imageBuffer);
  const prompt = caption
    ? `Пользователь прислал изображение с подписью: "${caption}". Подробно опиши содержимое изображения, извлеки весь важный текст (если есть) и помоги ответить на запрос пользователя.`
    : 'Подробно опиши содержимое этого изображения на русском языке и точно извлеки весь видимый текст, цифры, даты или контакты, если они есть.';

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'engram-bot/1.0',
      },
      body: JSON.stringify({
        model: 'gemini-3.5-flash-lite',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64}` },
              },
            ],
          },
        ],
        max_tokens: 900,
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini vision error (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('Gemini returned empty vision description');
  return text;
}

export async function describeImage(
  env: AppEnv,
  imageBuffer: ArrayBuffer,
  caption?: string,
): Promise<string> {
  const errors: string[] = [];

  if (env.GEMINI_API_KEY) {
    try {
      return await describeImageWithGemini(
        env.GEMINI_API_KEY,
        imageBuffer,
        caption,
      );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const visionModel =
      env.WORKERS_AI_VISION_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct';
    return await describeImageWithWorkersAI(
      env.AI,
      visionModel,
      imageBuffer,
      caption,
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    throw new Error(`Не удалось распознать изображение: ${errors.join(' | ')}`);
  }
}
