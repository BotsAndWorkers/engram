# Engram

Персональный Telegram-ассистент, база знаний и система напоминаний на базе **Cloudflare Workers**, **Cloudflare D1 (SQLite + FTS5)** и **Workers AI**.

## Возможности

- **AI-чат с вызовами инструментов (Tool Calling):** работает через Cloudflare Workers AI (бесплатные 10 000 Neurons/день) или любой OpenAI-compatible API (Gemini, Groq, OpenRouter).
- **База знаний (заметки):** сохранение, редактирование, удаление и полнотекстовый поиск (SQLite FTS5) с тегами.
- **Напоминания:** одноразовые и повторяющиеся задачи по расписанию (Cloudflare Cron Triggers каждую минуту) с inline-кнопками "Выполнено", "+1 час", "+1 день".
- **Долгосрочная память:** бот запоминает факты о пользователе и автоматически учитывает их в будущих диалогах.
- **Веб-ридер:** извлечение текста по ссылке (`fetch_url`) для суммаризации и сохранения в заметки.
- **Голосовые сообщения:** распознавание речи через Workers AI Whisper (`@cf/openai/whisper`).
- **Безопасность:** проверка `X-Telegram-Bot-Api-Secret-Token` в constant-time, whitelist по `ALLOWED_USER_IDS`, дедупликация `update_id`.

## Структура проекта

```text
engram/
├── migrations/
│   └── 0001_init.sql       # Схема D1 (messages, notes + FTS5, reminders, memories, user_settings)
├── src/
│   ├── index.ts            # Точка входа: Hono webhook + scheduled cron
│   ├── config/env.ts       # Типы окружения и парсинг ALLOWED_USER_IDS
│   ├── db/                 # Запросы к D1 и типы строк
│   ├── llm/                # Адаптеры Workers AI и OpenAI-compatible API
│   ├── tools/              # Инструменты (notes, reminders, memory, web)
│   ├── telegram/           # Клиент Telegram API, auth, команды, callback-кнопки
│   ├── agent/runner.ts     # Агентный цикл (tool-calling loop)
│   └── cron/reminders.ts   # Отправка сработавших напоминаний
├── test/                   # Юнит-тесты (Vitest)
└── wrangler.jsonc          # Конфигурация Cloudflare Workers
```

## Быстрый старт и деплой

### 1. Установка зависимостей

```bash
npm install
```

### 2. Создание бота в Telegram

1. Откройте `@BotFather` в Telegram и выполните `/newbot`.
2. Сохраните полученный `TELEGRAM_BOT_TOKEN`.
3. Узнайте свой числовой Telegram ID (например, через `@userinfobot`).
4. Придумайте случайную строку для `TELEGRAM_WEBHOOK_SECRET` (например, 32 символа).

### 3. Создание базы данных Cloudflare D1

```bash
npx wrangler login
npx wrangler d1 create engram-db
```

Скопируйте `database_id` из вывода команды и вставьте его в `wrangler.jsonc` вместо `00000000-0000-0000-0000-000000000000`.

Примените миграцию:

```bash
npm run db:migrate:remote
```

### 4. Добавление секретов в Cloudflare

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ALLOWED_USER_IDS
```

В `ALLOWED_USER_IDS` укажите ваш Telegram ID (или несколько через запятую).

### 5. Деплой

Вручную:

```bash
npm run deploy
```

Либо через Git (рекомендуется):
1. Отправьте код в репозиторий `BotsAndWorkers/engram`.
2. В панели Cloudflare перейдите в **Workers & Pages -> Create -> Import a repository** и выберите `BotsAndWorkers/engram`.
3. В настройках сборки укажите:
   - Build command: `npm run db:migrate:remote` (или накатывайте миграции вручную перед пушем новых SQL-файлов)
   - Deploy command: `npx wrangler deploy`
4. Добавьте секреты (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_USER_IDS`) в настройках воркера **Settings -> Variables and Secrets**.

### 6. Регистрация Telegram Webhook

После деплоя выполните запрос (подставив ваш токен, URL воркера и секрет):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://engram.<your-subdomain>.workers.dev/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Проверить здоровье воркера можно по адресу `https://engram.<your-subdomain>.workers.dev/health`.

## Команды бота

- `/start` — краткая справка
- `/help` — список команд и примеры запросов
- `/notes [запрос]` — последние заметки или поиск по базе
- `/reminders` — список активных напоминаний
- `/memory` — сохраненные факты долгосрочной памяти
- `/model [id | reset]` — посмотреть или сменить модель LLM
- `/tz [Asia/Novosibirsk]` — посмотреть или сменить часовой пояс
- `/clear` — очистить историю текущего диалога

## Переключение на внешний LLM (опционально)

По умолчанию используется Cloudflare Workers AI. Чтобы переключиться на Gemini API, Groq или OpenRouter:

1. В `wrangler.jsonc` поменяйте `LLM_PROVIDER` на `"openai-compatible"`.
2. Добавьте секреты:
   - `LLM_API_KEY`
   - `LLM_BASE_URL` (например, `https://generativelanguage.googleapis.com/v1beta/openai`)
   - `LLM_MODEL` (например, `gemini-2.5-flash`)
