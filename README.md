# Engram

Персональный AI-ассистент, база знаний и планировщик в Telegram на бесплатном стеке **Cloudflare Workers**, **Cloudflare D1 (SQLite + FTS5)**, **Cloudflare Vectorize** и **Workers AI** (с поддержкой внешних бесплатных LLM API).

## Возможности

- **Мульти-провайдерный AI-роутер:** автоматическая цепочка `Gemini -> Groq -> io.net -> Cloudflare Workers AI` с переключением при лимитах или сбоях, потоковой печатью ответа и самодиагностикой (`check_llm_providers`, `list_available_models`, `switch_llm_model`).
- **База знаний и заметки:** сохранение, редактирование, гибридный поиск (ключевые слова D1 FTS5 + семантический поиск Vectorize `@cf/baai/bge-m3`), экспорт всех заметок в Markdown (`/export`).
- **Напоминания и проактивность:** одноразовые и повторяющиеся напоминания (Cron `* * * * *`), утренний дайджест, вечерний чек-ин и настройка тихих часов (`quiet_hours`).
- **Интерактивные списки и трекеры:** чеклисты покупок/дел/фильмов (`/lists`) и учет расходов, привычек, тренировок из обычной переписки.
- **Память в трех уровнях:** рабочее окно диалога, фоновое скользящее саммари с авто-извлечением фактов и долговременный эпизодический архив (`conversation_episodes` + FTS5).
- **Мультимодальность и веб:**
  - распознавание голосовых сообщений (Whisper) и голосовые ответы TTS (`/voice`);
  - распознавание фото и скриншотов (Vision);
  - индексация загруженных документов (`PDF`, `TXT`, `MD`, `CSV`, `JSON`, код);
  - обработка пересланных постов с сохранением источника;
  - бесплатный поиск в интернете (`web_search`) и чтение веб-страниц (`fetch_url`).
- **Telegram Mini App (`/app`):** встроенный веб-интерфейс для просмотра и управления заметками, списками, задачами, трекерами, памятью и AI-моделями.

## Структура проекта

```text
engram/
├── .github/workflows/deploy.yml   # Автодеплой, миграции D1, секреты, webhook и меню
├── migrations/
│   ├── 0001_init.sql              # Базовые таблицы и FTS5 для заметок
│   ├── 0002_memory_summaries.sql  # Скользящие саммари и эпизодический архив
│   ├── 0003_lists_and_briefing.sql# Интерактивные списки и утренний дайджест
│   └── 0004_jarvis_upgrades.sql   # Документы, трекеры, тихие часы, чек-ины, TTS
├── src/
│   ├── index.ts                   # Hono роутер (/webhook, /app, /health) и cron
│   ├── agent/                     # Агентный цикл и фоновая компактификация
│   ├── llm/                       # Провайдеры (Gemini/Groq/io.net/Workers AI), fallback, TTS, диагностика
│   ├── tools/                     # Инструменты (notes, reminders, lists, documents, trackers, memory, web, infra)
│   ├── db/                        # D1 запросы и типы
│   ├── telegram/                  # Bot API клиент, auth, команды, UI и HTML-форматтер
│   ├── cron/                      # Напоминания, утренний дайджест и вечерние чек-ины
│   └── webapp/                    # Telegram Mini App UI и API с проверкой initData
├── test/                          # Юнит-тесты (Vitest)
└── wrangler.jsonc                 # Конфигурация Cloudflare Workers
```

## Развертывание после форка (полная инструкция)

### 1. Подготовка в Telegram

1. Откройте `@BotFather` в Telegram и создайте бота командой `/newbot` — сохраните токен (`TELEGRAM_BOT_TOKEN`).
2. Узнайте свой числовой Telegram ID (например, через `@userinfobot` -> `Id: ...`) — это будет `ALLOWED_USER_IDS`.
3. Придумайте случайную строку из 24–32 латинских букв/цифр для защиты webhook (`TELEGRAM_WEBHOOK_SECRET`), например в PowerShell:
   ```powershell
   [guid]::NewGuid().ToString("N")
   ```

### 2. Создание ресурсов в Cloudflare

Установите зависимости и авторизуйтесь в Wrangler:

```bash
npm install
npx wrangler login
```

1. **Создайте базу данных D1:**
   ```bash
   npx wrangler d1 create engram-db
   ```
   Скопируйте `database_id` из вывода команды и вставьте его в `wrangler.jsonc` в секцию `d1_databases[0].database_id`.

2. **Создайте индекс Vectorize для семантического поиска:**
   ```bash
   npx wrangler vectorize create engram-notes --dimensions=1024 --metric=cosine
   ```

3. **Получите `CLOUDFLARE_ACCOUNT_ID` и `CLOUDFLARE_API_TOKEN`:**
   - **Account ID:** виден в URL дашборда Cloudflare (`dash.cloudflare.com/<ACCOUNT_ID>/home`) или в разделе **Compute -> Workers & Pages**.
   - **API Token:** откройте **My Profile -> API Tokens -> Create Token -> шаблон "Edit Cloudflare Workers"** и добавьте в `Account policy` разрешение **D1: Edit**.

### 3. Бесплатные LLM-ключи (рекомендуется)

Бот умеет работать только на встроенном **Cloudflare Workers AI** (бесплатно 10 000 Neurons/день), но при активном общении лимит можно быстро исчерпать. Рекомендуется добавить хотя бы один внешний бесплатный ключ:

- `GEMINI_API_KEY` — Google AI Studio (`aistudio.google.com` -> **Get API key**).
- `GROQ_API_KEY` — Groq Console (`console.groq.com` -> **API Keys**).
- `IO_API_KEY` — io.net (`ai.io.net` -> **IO Intelligence -> API Keys**).

### 4. Настройка GitHub Secrets

В вашем форке на GitHub откройте **Settings -> Secrets and variables -> Actions -> New repository secret** и добавьте:

| Секрет | Обязательно | Описание |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Да | API-токен Cloudflare (Workers + D1) |
| `CLOUDFLARE_ACCOUNT_ID` | Да | ID аккаунта Cloudflare |
| `TELEGRAM_BOT_TOKEN` | Да | Токен бота от `@BotFather` |
| `TELEGRAM_WEBHOOK_SECRET` | Да | Случайная строка для проверки webhook |
| `ALLOWED_USER_IDS` | Да | Ваш числовой Telegram ID (можно несколько через запятую) |
| `GEMINI_API_KEY` | Нет | Ключ Google AI Studio |
| `GROQ_API_KEY` | Нет | Ключ Groq API |
| `IO_API_KEY` | Нет | Ключ io.net IO Intelligence |

### 5. Деплой

Закоммитьте ваш `database_id` в `wrangler.jsonc` и отправьте изменения в ветку `main` (или запустите workflow **Deploy Engram** вручную во вкладке **Actions**).

GitHub Actions автоматически:
1. Проверит TypeScript и прогонит тесты (`npm test`).
2. Применит все SQL-миграции к вашей D1 (`wrangler d1 migrations apply`).
3. Задеплоит Worker и автоматически определит ваш `*.workers.dev` URL.
4. Загрузит секреты в Cloudflare Worker (`wrangler secret bulk`).
5. Зарегистрирует Telegram webhook, список команд (`/setMyCommands`) и кнопку Mini App в меню (`/setChatMenuButton`).

После зеленого статуса в **Actions** откройте своего бота в Telegram и отправьте `/start`.

## Команды бота

- `/menu` — главное интерактивное меню
- `/app` — открыть Telegram Mini App
- `/notes [запрос]` — заметки и поиск
- `/reminders` — активные и выполненные напоминания
- `/lists` — интерактивные списки и чеклисты
- `/memory` — сохраненные факты долгосрочной памяти
- `/voice [off | voice | always]` — режим голосовых ответов
- `/export` — экспорт всех заметок в `.md` файл
- `/model [id | reset]` — управление моделью AI
- `/tz [IANA_timezone]` — часовой пояс (например `Europe/Moscow`)
- `/clear` — очистить историю текущего диалога (заметки, архив и память сохраняются)
- `/help` — справка

## Локальная разработка

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```
