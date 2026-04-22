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
| Generate migration | `npm run db:generate` |
| Drizzle Studio | `npm run db:studio` |

Run a single test: `npx vitest run src/agent/tools/schedule.test.ts`

## Architecture

```
src/
  index.ts           — entry: wires bot, middleware, worker, call server
  config.ts          — Zod-validated env (fails on missing required vars)
  agent/
    orchestrator.ts   — AI loop (Vercel AI SDK generateText, max 15 steps)
    tools/            — agent-callable tools; register new ones in index.ts
    subagents/       — research.ts, technical.ts
    prompts/          — system.ts, proactive.ts, subagents.ts
  bot/
    bot.ts            — Bot<BotContext> singleton (extends Context with dbUser)
    handlers/         — commands, messages, voice
    middleware/        — auth → rate limit → context (order matters)
  db/
    schema.ts         — Drizzle tables: users, messages, jobs, lesson_plans,
                          repeating_jobs, habits, habit_logs, expenses, todos, job_skip_once
    repos/            — repository pattern for all DB access (never query raw)
  scheduler/
    queue.ts          — BullMQ (queue name: "opekun")
    worker.ts          — job processor
    proactive.ts       — scheduled notifications (morning greeting, etc.)
    jobs.ts            — repeating job CRUD
  mcp/               — Model Context Protocol client + servers.json
  voice/              — STT/TTS (OpenAI Whisper + TTS)
  call/               — Twilio voice calls (optional, gated by isTwilioConfigured())
  research/           — web search + fetch (Brave Search API)
  memory/             — Mem0 long-term semantic memory
  calendar/           — Google Calendar via OAuth
  documents/          — file parsing (PDF, DOCX, XLSX)
  lib/                — logger (Pino), errors
  test/               — shared test utilities + harnesses
  e2e/                — integration tests (separate vitest config, 15s timeout)
```

## Critical conventions

- **Imports must end in `.js`** — `moduleResolution: "NodeNext"` requires `.js` extensions in import paths (e.g. `import { foo } from './bar.js'` even though the file is `bar.ts`). Vitest resolves `.js` → `.ts` via `extensionAlias`.
- **DB access via repos** — always use repository modules in `src/db/repos/`, never write raw queries.
- **Logging** — use `createChildLogger('module-name')` from `src/lib/logger.ts`. Never `console.log`.
- **Adding tools** — create in `src/agent/tools/`, export from `src/agent/tools/index.ts` inside `allTools()`.
- **Config** — all env validated by Zod in `src/config.ts`. Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` (comma-separated Telegram user IDs), `OPENROUTER_API_KEY`, `DATABASE_URL`, `UPSTASH_REDIS_URL`. Everything else has defaults.
- **Default models** — primary: `anthropic/claude-sonnet-4-5`, fast: `google/gemini-2.5-flash`. Override via `OPENROUTER_PRIMARY_MODEL` / `OPENROUTER_FAST_MODEL`.
- **Default timezone** — `Asia/Almaty`. Override via `DEFAULT_TIMEZONE`.
- **Bot middleware order** — auth → rate limit → context. Do not reorder.
- **BullMQ queue name** — `opekun` (not `opekuQueue`).
- **Orchestrator max steps** — 15 (`stepCountIs(15)`).
- **No CI** — no `.github/workflows`. Tests and typechecks are manual.

## Testing

- Setup: `src/test/env.ts` sets required env vars before any module loads.
- Vitest globals are enabled (`globals: true`) — no need to import `describe`/`it`/`expect`.
- Bot harness: `createBotHarness()` in `src/test/bot-harness.ts` — real grammY Bot with mocked `bot.api`.
- Mock repos: `createMockRepos()` in `src/test/mock-repos.ts`.
- Mock LLM: `makeLlmResult()` / `makeFallbackResult()` in `src/test/mock-llm.ts`.
- Fixtures: `makeUser()`, `makeTextUpdate()`, `makeCommandUpdate()`, etc. in `src/test/fixtures.ts`.
- Unit tests live alongside source files (`*.test.ts`). E2E tests in `src/e2e/`.
- E2E config: `vitest.e2e.config.ts` (15s timeout, `src/test/env.ts` setup).
- `tsconfig.json` excludes `*.test.ts` / `*.spec.ts` from build.

## DB schema changes

Edit `src/db/schema.ts`, then:
- Iterating: `npm run db:push` (applies schema directly, no migration files)
- For production: `npm run db:generate` (creates migration files in `./drizzle/`)
- After adding a table, add a corresponding repo module in `src/db/repos/`.

## External services

| Service | Purpose | Key env vars |
|---|---|---|
| OpenRouter | Primary + fast LLM | `OPENROUTER_API_KEY`, `OPENROUTER_PRIMARY_MODEL`, `OPENROUTER_FAST_MODEL` |
| Neon | PostgreSQL | `DATABASE_URL` |
| Upstash | Redis for BullMQ | `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` |
| Mem0 | Long-term semantic memory | `MEM0_API_KEY` |
| OpenAI | Voice STT/TTS | `OPENAI_API_KEY` |
| Brave Search | Web research | `BRAVE_SEARCH_API_KEY` |
| Twilio | Phone calls (optional) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Google OAuth | Calendar integration | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` |