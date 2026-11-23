import { Hono } from 'hono';
import { runAgentTurn } from './agent/runner';
import type { AppEnv } from './config/env';
import { processDueReminders } from './cron/reminders';
import {
  saveDocument,
  touchUserChatId,
  tryMarkUpdateProcessed,
} from './db/queries';
import {
  describeImageWithWorkersAI,
  transcribeAudioWithWorkersAI,
} from './llm/workers-ai';
import { isUserAllowed, verifySecretToken } from './telegram/auth';
import { handleCallbackQuery } from './telegram/callbacks';
import { TelegramClient } from './telegram/client';
import { handleSlashCommand } from './telegram/commands';
import type { TelegramForwardOrigin, TelegramUpdate } from './telegram/types';
import { webAppRoutes } from './webapp/api';

function formatForwardPrefix(origin: TelegramForwardOrigin | undefined): string {
  if (!origin) return '';
  if (origin.type === 'channel' && origin.chat?.title) {
    const handle = origin.chat.username ? ` (@${origin.chat.username})` : '';
    return `[Переслано из канала "${origin.chat.title}"${handle}]:\n`;
  }
  if (origin.type === 'chat' && origin.sender_chat?.title) {
    return `[Переслано из чата "${origin.sender_chat.title}"]:\n`;
  }
  if (origin.type === 'user' && origin.sender_user) {
    const name = origin.sender_user.username
      ? `${origin.sender_user.first_name} (@${origin.sender_user.username})`
      : origin.sender_user.first_name;
    return `[Переслано от ${name}]:\n`;
  }
  if (origin.type === 'hidden_user' && origin.sender_user_name) {
    return `[Переслано от ${origin.sender_user_name}]:\n`;
  }
  return '[Пересланное сообщение]:\n';
}

const app = new Hono<{ Bindings: AppEnv }>();

app.route('/app', webAppRoutes);

app.get('/health', (c) => {
  return c.json({ ok: true, service: 'engram' });
});

app.post('/webhook', async (c) => {
  const secretHeader = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  const validSecret = await verifySecretToken(
    secretHeader,
    c.env.TELEGRAM_WEBHOOK_SECRET,
  );

  if (!validSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (typeof update.update_id !== 'number') {
    return c.json({ error: 'Missing update_id' }, 400);
  }

  const userId = update.message?.from?.id ?? update.callback_query?.from.id;
  if (!isUserAllowed(userId, c.env.ALLOWED_USER_IDS)) {
    return c.json({ ok: true, ignored: true });
  }

  const isNew = await tryMarkUpdateProcessed(c.env.DB, update.update_id);
  if (!isNew) {
    return c.json({ ok: true, duplicate: true });
  }

  c.executionCtx.waitUntil(handleUpdate(c.env, update));
  return c.json({ ok: true });
});

async function extractDocumentText(
  ai: Ai,
  fileName: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const lower = fileName.toLowerCase();
  const isTextLike =
    mimeType.startsWith('text/') ||
    /\.(txt|md|csv|json|ts|tsx|js|jsx|py|sql|ya?ml|xml|html|log|env|ini|conf)$/i.test(
      lower,
    );

  if (isTextLike) {
    return new TextDecoder().decode(bytes).slice(0, 50_000);
  }

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    const converted = await ai.toMarkdown([
      {
        name: fileName,
        blob: new Blob([bytes], { type: 'application/pdf' }),
      },
    ]);
    const doc = Array.isArray(converted) ? converted[0] : converted;
    if (doc && 'data' in doc && typeof doc.data === 'string' && doc.data.trim()) {
      return doc.data.slice(0, 50_000);
    }
  }

  throw new Error(
    `Формат файла "${fileName}" (${mimeType}) пока не поддерживается для чтения.`,
  );
}

async function handleUpdate(
  env: AppEnv,
  update: TelegramUpdate,
): Promise<void> {
  const telegram = new TelegramClient(env.TELEGRAM_BOT_TOKEN);

  if (update.callback_query) {
    try {
      await handleCallbackQuery(env, telegram, update.callback_query);
    } catch (err) {
      console.error('Callback query error', err);
    }
    return;
  }

  const msg = update.message;
  if (!msg || !msg.from) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;

  try {
    await touchUserChatId(env.DB, userId, chatId);
    let userText = (msg.text ?? msg.caption ?? '').trim();
    let isVoiceInput = false;

    if (msg.document) {
      await telegram.sendChatAction(chatId, 'typing');
      const fileName = msg.document.file_name || 'document';
      const mimeType = msg.document.mime_type || 'application/octet-stream';

      if (msg.document.file_size && msg.document.file_size > 10 * 1024 * 1024) {
        await telegram.sendMessage(
          chatId,
          `Файл "${fileName}" слишком большой (максимум 10 МБ).`,
        );
        return;
      }

      try {
        const docBytes = await telegram.getFileBytes(msg.document.file_id);
        const extracted = await extractDocumentText(
          env.AI,
          fileName,
          mimeType,
          docBytes,
        );
        const saved = await saveDocument(env.DB, {
          userId,
          fileName,
          mimeType,
          telegramFileId: msg.document.file_id,
          content: extracted,
        });

        const preview = extracted.slice(0, 6000);
        userText = userText
          ? `${userText}\n\n[Прикреплен и сохранен документ #${saved.id} "${fileName}"]:\n${preview}`
          : `[Пользователь прислал и сохранил документ #${saved.id} "${fileName}" (${extracted.length} симв.)]:\n${preview}`;
      } catch (docErr) {
        const reason =
          docErr instanceof Error ? docErr.message : 'неизвестная ошибка';
        await telegram.sendMessage(
          chatId,
          `Не удалось обработать документ "${fileName}": ${reason}`,
        );
        return;
      }
    }

    if (msg.photo && msg.photo.length > 0) {
      await telegram.sendChatAction(chatId, 'typing');
      const bestPhoto =
        msg.photo.find((p) => p.width >= 320 && p.width <= 900) ??
        msg.photo[msg.photo.length - 1];
      const visionModel =
        env.WORKERS_AI_VISION_MODEL ||
        '@cf/meta/llama-4-scout-17b-16e-instruct';

      let visionDescription: string;
      try {
        const imageBuffer = await telegram.getFileBytes(bestPhoto.file_id);
        visionDescription = await describeImageWithWorkersAI(
          env.AI,
          visionModel,
          imageBuffer,
          userText || undefined,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        throw new Error(`Ошибка анализа изображения: ${reason}`);
      }

      if (!visionDescription) {
        await telegram.sendMessage(
          chatId,
          'Не удалось распознать содержимое изображения.',
        );
        return;
      }

      userText = userText
        ? `${userText}\n\n[Содержимое приложенного изображения]:\n${visionDescription}`
        : `[Пользователь прислал изображение. Распознанное содержимое]:\n${visionDescription}`;
    }

    if (!userText && msg.voice) {
      await telegram.sendChatAction(chatId, 'typing');
      const audioBuffer = await telegram.getFileBytes(msg.voice.file_id);
      const whisperModel = env.WORKERS_AI_WHISPER_MODEL || '@cf/openai/whisper';
      const transcript = await transcribeAudioWithWorkersAI(
        env.AI,
        whisperModel,
        audioBuffer,
      );

      if (!transcript) {
        await telegram.sendMessage(
          chatId,
          'Не удалось распознать голосовое сообщение.',
        );
        return;
      }
      userText = `[Голосовое сообщение]: ${transcript}`;
      isVoiceInput = true;
    }

    if (!userText) return;

    const handledCommand = await handleSlashCommand({
      env,
      telegram,
      userId,
      chatId,
      text: userText,
    });
    if (handledCommand) return;

    const forwardPrefix = formatForwardPrefix(msg.forward_origin);
    if (forwardPrefix) {
      userText = `${forwardPrefix}${userText}`;
    }

    await runAgentTurn({
      env,
      telegram,
      userId,
      chatId,
      userText,
      isVoiceInput,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Update handling failed', { userId, chatId, message });
    await telegram
      .sendMessage(chatId, `Ошибка обработки запроса: ${message}`)
      .catch(() => undefined);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(processDueReminders(env));
  },
};
