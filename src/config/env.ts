export interface AppSecrets {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_USER_IDS: string;
  LLM_PROVIDER?: 'workers-ai' | 'openai-compatible';
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  IO_API_KEY?: string;
}

export type AppEnv = Omit<Env, 'LLM_PROVIDER'> & AppSecrets;

export function parseAllowedUserIds(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  const ids = raw
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((num) => Number.isFinite(num) && num > 0);
  return new Set(ids);
}
