# Opekun (Опекун) — AI-nanny Telegram Bot

## Commands

| What | Command |
|---|---|
| Dev (hot-reload) | `npm run dev` |
| Build | `npm run build` |
| Start (production) | `npm start` |
| Unit tests | `npm test` |
| E2E tests | `npm run test:e2e` |
| All tests | `npm run test:all` |
| Watch mode | `npm run test:watch` |
| Coverage | `npm run test:coverage` |
| Push DB schema | `npm run db:push` |
| Generate DB migration | `npm run db:generate` |
| Drizzle Studio | `npm run db:studio` |

Run a single test file: `npx vitest run src/agent/tools/schedule.test.ts`

## Architecture

```
src/
  index.ts          — entry: wires bot, middleware, worker, call server
  config.ts         — Zod-validated env config (fails on missing required vars)
  agent/
    orchestrator.ts  — AI loop, calls LLM, dispatches tools
    tools/           — agent-callable tools (schedule, memory, education, etc.)
    subagents/       — sub-agent definitions
    prompts/         — system prompts
  bot/
    bot.ts           — Bot<BotContext> singleton (extends Context with dbUser)
    handlers/        — commands, messages, voice
    middleware/       — auth, rate limit, context
  db/
    schema.ts        — Drizzle schema (users, messages, jobs, habits, lesson_plans, repeating_jobs)
    repos/           — repository pattern for all DB access
  scheduler/
    queue.ts         — BullMQ queue + Redis connection
    worker.ts         — job processor
    proactive.ts      — scheduled notifications (morning greeting, etc.)
  mcp/               — Model Context Protocol client (+ servers.json)
  voice/              — STT/TTS (OpenAI Whisper + TTS)
  call/               — Twilio voice calls (optional, gated by isTwilioConfigured())
  research/           — web search + fetch (Brave Search)
  memory/             — Mem0 long-term memory
  calendar/           — Google Calendar via OAuth
  documents/          — file parsing (PDF, DOCX, XLSX)
  lib/                — logger (Pino), errors
  test/               — shared test utilities (see below)
  e2e/                — integration tests (separate vitest config, 15s timeout)
```

## Critical conventions

- **Imports must end in `.js`** — `moduleResolution: "NodeNext"` requires explicit `.js` extensions in import paths (e.g. `import { foo } from './bar.js'` even though the file is `bar.ts`).
- **DB access via repos** — always use repository modules in `src/db/repos/`, never write raw queries.
- **Logging** — use `createChildLogger('module-name')` from `src/lib/logger.ts`.
- **Adding tools** — create in `src/agent/tools/`, then register in `src/agent/tools/index.ts`.
- **Config** — all env is validated by Zod in `src/config.ts`. Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `OPENROUTER_API_KEY`, `DATABASE_URL`, `UPSTASH_REDIS_URL`.

## Testing

- Test setup file: `src/test/env.ts` — sets required env vars before any module loads.
- Bot test harness: `createBotHarness()` in `src/test/bot-harness.ts` — creates a real grammY Bot with mocked `bot.api`.
- Mock repos: `createMockRepos()` in `src/test/mock-repos.ts`.
- Mock LLM: `makeLlmResult()` / `makeFallbackResult()` in `src/test/mock-llm.ts`.
- Fixtures: `makeUser()`, `makeTextUpdate()`, `makeCommandUpdate()`, etc. in `src/test/fixtures.ts`.
- E2E tests live in `src/e2e/` and run with `npm run test:e2e` (separate `vitest.e2e.config.ts`, 15s timeout).
- `tsconfig.json` excludes `*.test.ts` / `*.spec.ts` from the build.

## DB schema changes

Edit `src/db/schema.ts`, then:
- Iterating: `npm run db:push` (applies schema directly, no migration files)
- For production: `npm run db:generate` (creates migration files in `./drizzle/`)

## External services

| Service | Purpose | Env |
|---|---|---|
| OpenRouter | Primary + fast LLM | `OPENROUTER_API_KEY`, `OPENROUTER_PRIMARY_MODEL`, `OPENROUTER_FAST_MODEL` |
| Neon | PostgreSQL | `DATABASE_URL` |
| Upstash | Redis for BullMQ | `UPSTASH_REDIS_URL` |
| Mem0 | Long-term semantic memory | `MEM0_API_KEY` |
| OpenAI | Voice STT/TTS | `OPENAI_API_KEY` |
| Brave Search | Web research | `BRAVE_SEARCH_API_KEY` |
| Twilio | Phone calls (optional) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Google OAuth | Calendar integration | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |