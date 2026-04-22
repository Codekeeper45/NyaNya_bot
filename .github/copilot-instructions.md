# Copilot instructions for Opekun (Опекун)

## Build, test, and run commands

| Task | Command |
|---|---|
| Dev (hot reload) | `npm run dev` |
| Build | `npm run build` |
| Start built app | `npm start` |
| Unit tests | `npm test` |
| E2E tests | `npm run test:e2e` |
| All tests | `npm run test:all` |
| Test watch mode | `npm run test:watch` |
| Coverage | `npm run test:coverage` |
| Run one test file | `npx vitest run src/agent/tools/schedule.test.ts` |
| Run one e2e test file | `npx vitest run --config vitest.e2e.config.ts src/e2e/<file>.test.ts` |
| Push DB schema | `npm run db:push` |
| Generate DB migration | `npm run db:generate` |
| Drizzle Studio | `npm run db:studio` |

There is currently no dedicated lint script in `package.json`.

## High-level architecture

- `src/index.ts` is the runtime entry point: it installs grammY middleware (`auth` → `ratelimit` → `context`), registers command/message/voice handlers, restores proactive schedules, starts BullMQ worker, optionally starts Twilio call server, and finally starts bot polling.
- The conversational engine is `src/agent/orchestrator.ts`: it gathers Mem0 context + recent DB message history, builds the system prompt, runs the OpenRouter model with tool-calling (`allTools`), logs tool calls/results, stores conversation back to DB/memory, and has fallback behavior when model text is returned without `message_send_*` tool calls.
- Tool composition lives in `src/agent/tools/index.ts`; new agent capabilities are wired by adding a tool module and exporting/merging it there.
- Background/proactive behavior is BullMQ-driven (`src/scheduler/*`): job worker loads user state, applies guardrails (paused users, follow-up skip/attempt limits), enriches job context (todos/habits/weekly stats), calls orchestrator in proactive mode, and reschedules follow-ups when needed.
- Persistence is PostgreSQL via Drizzle with repository modules in `src/db/repos/*`; runtime code is expected to go through repos instead of ad-hoc queries.
- MCP integration is configured in `src/mcp/servers.json` (currently Google Calendar MCP).

## Key conventions

- Use explicit `.js` extensions in TS imports (NodeNext module resolution).
- Keep DB access in repository modules under `src/db/repos/`; follow existing `*Repo` pattern.
- Use `createChildLogger('module-name')` from `src/lib/logger.ts` for module logging.
- New agent tools must be registered in `src/agent/tools/index.ts`; adding a file alone is not enough.
- Environment is validated centrally in `src/config.ts` (Zod). Required core vars include `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `OPENROUTER_API_KEY`, `DATABASE_URL`, `UPSTASH_REDIS_URL`.
- Vitest setup relies on `src/test/env.ts` to preload required env vars before module imports.
- E2E tests are isolated via `vitest.e2e.config.ts` (`src/e2e/**`, 15s timeout), while main unit config excludes `src/e2e/**`.
