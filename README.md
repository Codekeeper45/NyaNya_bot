# Опекун — AI-няня в Telegram

Персональный AI-компаньон, который живёт в Telegram, знает твои привычки, помнит важные факты и помогает не забывать о делах. Говорит голосом, рисует диаграммы, планирует день, ведёт дневник расходов и тренировок.

Бот работает как **реактивно** (отвечает на сообщения), так и **проактивно** (присылает напоминания, спрашивает о самочувствии, подбадривает).

---

## Быстрый старт

```bash
git clone <repo>
cd opekun
cp .env.example .env   # заполни обязательные переменные
npm install
npm run dev            # hot-reload разработка
```

Продакшен:

```bash
npm run build
npm start
```

## Обязательные переменные окружения

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | ID пользователей через запятую (авторизация) |
| `OPENROUTER_API_KEY` | Ключ к OpenRouter (LLM) |
| `DATABASE_URL` | PostgreSQL (Neon) |
| `UPSTASH_REDIS_URL` | Redis для очередей BullMQ |

Остальные (голос, поиск, календарь, звонки) — опциональны. См. `.env.example`.

## Что умеет

### Память

Трёхуровневая система долгосрочной памяти:

1. **GraphRAG** — автоматическая ассоциативная память. Сообщения индексируются каждые 6 часов в граф знаний (сущности + связи). При каждом сообщении строится плавающий подграф релевантных воспоминаний, который бот видит как системный контекст.

2. **Архивный поиск** (`memory_search_archive`) — осознанный глубокий поиск: сначала по явно сохранённым фактам, затем по фрагментам переписки. Используется когда нужны точные детали, даты или первоисточник.

3. **Сохранение фактов** — `memory_save` сохраняет новые факты о пользователе. Они видны в `/who` сразу, а в граф попадают при следующей индексации.

Команды: `/who` — что помню, `/index_memory` — форсировать индексацию, `/reset` — стереть память.

### Общение

- Текст через `message_send_text` (Telegram HTML)
- Голос через `message_send_voice` (30+ голосов OpenAI TTS + Google TTS, ротация ключей)
- Выбор голоса: `/voice <имя>`, список: `/voices`
- Изображения по URL (`message_send_photo`)
- Режим телефонных звонков через Twilio (опционально)

### Расписание и напоминания

- Ежедневные события (подъём, завтрак, обед, ужин, сон)
- Периодические напоминания (тренировки, учёба, привычки)
- Относительные напоминания («через 5 минут», «через час»)
- Автоматическая проверка: спит ли пользователь (не будить ночью)
- Самонастройка частоты follow-up на основе поведения

### Инструменты

- **Расходы** — парсинг сумм из сообщений, фото чеков, категории, статистика
- **Задачи** — список дел с дедлайнами, распознавание из текста
- **Привычки** — трекинг ежедневных привычек, streaks
- **Обучение** — планы уроков, расписание занятий, статусы
- **Погода** — Open-Meteo API
- **Карты** — OpenStreetMap
- **Веб-поиск** — Brave Search + Tavily
- **Диаграммы** — Mermaid (flowchart, sequence, mindmap, timeline, gantt, er, pie)
- **Документы** — чтение PDF, DOCX, XLSX, PPTX, TXT, CSV, MD, JSON, HTML
- **Календарь** — Google Calendar через OAuth

## Архитектура

```
src/
  index.ts            точка входа: бот + middleware + worker + call server
  config.ts           Zod-валидация переменных окружения
  agent/
    orchestrator.ts    AI-цикл (generateText, макс 15 шагов)
    tools/             инструменты агента (регистрация в index.ts)
    subagents/         research.ts, technical.ts
    prompts/           system.ts, proactive.ts, subagents.ts
  bot/
    bot.ts             Bot<BotContext> singleton
    handlers/          commands, message, voice
    middleware/         auth → rate limit → context
  memory/
    archive-search.ts  поиск по memory_save + graph_chunks
  graphrag/
    subgraph-builder.ts плавающий подграф для авто-retrieval
    indexer.ts          батч-индексация сообщений в граф
    extraction.ts       LLM-экстракция триплетов
    retrieval.ts        семантический вход + обход графа
    embeddings.ts       кеширование эмбеддингов
    cache.ts            кеш контекста, дедупликация запросов
  db/
    schema.ts          Drizzle таблицы + pgvector(1536)
    repos/             паттерн репозитория (без raw-запросов)
  scheduler/
    queue.ts           BullMQ очередь "opekun"
    worker.ts           обработчик заданий
    proactive.ts        проактивные уведомления
    jobs.ts             CRUD повторяющихся заданий
  voice/               STT/TTS (OpenAI Whisper + OpenAI/Google TTS)
  call/                Twilio голосовые звонки
  research/            Brave Search + Tavily + web fetch
  calendar/            Google Calendar OAuth
  documents/           парсинг файлов
  lib/                 logger (Pino), errors
  test/                харнесы, моки, фикстуры
  e2e/                 интеграционные тесты
```

## Стек

| Слой | Технологии |
|---|---|
| Runtime | Node.js 20+ |
| Язык | TypeScript, ESM (`moduleResolution: NodeNext`) |
| Telegram SDK | grammY |
| AI-цикл | Vercel AI SDK (`generateText`) |
| Модели | OpenRouter (Claude Sonnet, Gemini Flash) |
| База данных | PostgreSQL (Neon), Drizzle ORM |
| Поиск | pgvector (1536-мерные эмбеддинги) |
| Очереди | BullMQ, Upstash Redis |
| Сборка | esbuild (493 KB бандл) |
| Тесты | Vitest (146 unit + e2e тестов) |
| TTS | OpenAI TTS + Google GenAI TTS |
| Логирование | Pino |

## Модели по умолчанию

- **Основная**: `anthropic/claude-sonnet-4-5` (`OPENROUTER_PRIMARY_MODEL`)
- **Быстрая**: `google/gemini-2.5-flash` (`OPENROUTER_FAST_MODEL`)

## Команды бота

| Команда | Действие |
|---|---|
| `/who` | Что бот помнит о тебе |
| `/index_memory` | Форсировать индексацию переписки |
| `/reset` | Стереть всю память |
| `/pause` | Поставить бота на паузу |
| `/resume` | Снять с паузы |
| `/voice <имя>` | Сменить голос |
| `/voices` | Просмотреть все голоса |
| `/gcal` | Подключить Google Calendar |

## Разработка

```bash
npm run dev           # tsx watch
npm run build         # esbuild bundle
npm test              # unit-тесты
npm run test:e2e      # e2e-тесты
npm run test:all      # все тесты
npm run test:watch    # watch-режим
npm run test:coverage # покрытие
npx vitest run src/agent/tools/schedule.test.ts  # один тест
```

База данных:

```bash
npm run db:push       # применить схему напрямую (dev)
npm run db:generate   # сгенерировать миграцию (production)
npm run db:studio     # Drizzle Studio
```

## Конвенции

- **Импорты с `.js`**: `moduleResolution: NodeNext` требует расширения `.js` в путях импорта (Vitest разрешает `.js` → `.ts`).
- **Доступ к БД через репозитории**: никогда не пиши raw-запросы в обход `src/db/repos/`.
- **Логирование через `createChildLogger`**: не используй `console.log`.
- **Добавление инструментов**: создай в `src/agent/tools/`, экспортируй из `allTools()` в `src/agent/tools/index.ts`.
- **Middleware порядок**: auth → rate limit → context. Не переставляй.

## Статус

Активная разработка. 146 тестов, CI отсутствует (тесты и typecheck запускаются вручную).
