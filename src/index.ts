import { Hono } from 'hono';
import { runAgentTurn } from './agent/runner';
import type { AppEnv } from './config/env';
import { processDueReminders } from './cron/reminders';
import { tryMarkUpdateProcessed } from './db/queries';
import { transcribeAudioWithWorkersAI } from './llm/workers-ai';
import { isUserAllowed, verifySecretToken } from './telegram/auth';
import { handleCallbackQuery } from './telegram/callbacks';
import { TelegramClient } from './telegram/client';
import { handleSlashCommand } from './telegram/commands';
import type { TelegramUpdate } from './telegram/types';

const app = new Hono<{ Bindings: AppEnv }>();

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
    let userText = (msg.text ?? msg.caption ?? '').trim();

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

    await runAgentTurn({
      env,
      telegram,
      userId,
      chatId,
      userText,
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
