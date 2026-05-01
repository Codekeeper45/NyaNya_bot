# Наставник: Rename, Reminder Fix, Onboarding Removal

**Goal:** Three targeted changes to make the bot immediately usable and better at reminders.

**Architecture:** 
1. Rename "Опекун" → "Наставник" in all user-facing strings (system prompt, help text, call dialogue, TTS context). Internal identifiers (queue names, bot username) stay unchanged.
2. Remove the `onboardingComplete` gate from `/start` and `/reschedule`. The onboarding block in the system prompt is removed — the bot greets naturally instead of forcing a questionnaire.
3. Add explicit multi-reminder rules and examples to the system prompt so the model calls `schedule_reminder` N times for N events.

**Tech Stack:** TypeScript, grammY, Drizzle, existing tooling.

---

## Change 1: Rename Опекун → Наставник

### Files to modify
- `src/agent/prompts/system.ts` — 2 occurrences: "Ты — «Опекун»" and "Telegram-бота «Опекун»"
- `src/bot/handlers/commands.ts` — HELP_TEXT: "Я Опекун"
- `src/call/server.ts` — "Это Опекун" and "твой Опекун"
- `src/call/dialogue.ts` — "Ты — «Опекун»"
- `src/voice/tts.ts` — "Опекун заботится"
- `src/graphrag/extraction.test.ts` — alias: 'Опекун' stays (it's a valid alias for the bot name)
- `chat-viewer.mjs` — page title

### Files NOT to modify
- `src/scheduler/queue.ts` — `opekun-jobs` is internal
- `src/scheduler/worker.ts` — `opekun-jobs` is internal
- `src/index.ts` — `Opekun starting` is a log line (cosmetic, can change)
- `src/test/bot-harness.ts` — `OpekunBot` / `opekunbot` are bot API identifiers
- `src/agent/tools/maps.ts` — `OpekunBot/1.0` is a User-Agent
- `src/mcp/client.ts` — `opekun` is an MCP client name
- `src/graphrag/embeddings.ts` — `Opekun Bot` is an API header
- `package.json` — project name is internal

## Change 2: Remove onboarding gate

### What changes
- `src/bot/handlers/commands.ts` — `/start`: remove the `if (ctx.dbUser.onboardingComplete)` branch that launches orchestrator with `proactiveKind: 'onboarding'`. Always show HELP_TEXT.
- `src/bot/handlers/commands.ts` — `/reschedule`: remove the `if (!ctx.dbUser.onboardingComplete)` guard. Command is always available.
- `src/agent/prompts/system.ts` — remove `onboardingComplete` from `SystemPromptParams`. Remove the entire `onboardingBlock` conditional. Remove the `+ onboardingBlock` at the end.
- `src/agent/orchestrator.ts` — remove `onboardingComplete` from `OrchestratorInput` and where it's passed to `buildSystemPrompt`.
- `src/agent/tools/schedule.ts` — remove `onboardingComplete: true` from `setup_daily_schedule` result.
- `src/agent/tools/index.ts` — remove `onboardingCompleted` / `setOnboardingDone` / `getOnboardingCompleted`.
- `src/scheduler/worker.ts` — remove the `onboarding_incomplete` skip logic for followup_check. Remove `onboardingComplete` from the proactive input.
- `src/bot/handlers/message.ts` — remove `onboardingComplete` from orchestrator calls.
- `src/bot/handlers/voice.ts` — remove `onboardingComplete` from orchestrator call.
- `src/db/schema.ts` — keep the column (backward compat) but it's no longer read for logic.
- All test files — remove `onboardingComplete: true` from fixtures and test data where it was required.

### What stays
- `setup_daily_schedule` tool remains available — the bot can offer to set up schedules conversationally.
- The `onboarding_complete` DB column stays for backward compat but is no longer read by any logic.

## Change 3: Improve reminder instructions

### What changes in system prompt
Add a new section after the reminder tool table:

```
## Напоминания — КОГДА СТАВИТЬ НЕСКОЛЬКО

Если пользователь просит напомнить про несколько событий в разное время — вызови schedule_reminder ОТДЕЛЬНО для каждого события.

ПРАВИЛЬНО:
Пользователь: «напомни в 9 про английский и в 11 про статистику»
→ schedule_reminder(atTime: "09:00", atDate: "2026-05-01", message: "Английский — пора начинать!")
→ schedule_reminder(atTime: "11:00", atDate: "2026-05-01", message: "Статистика — время начинать!")

НЕПРАВИЛЬНО:
→ Один schedule_reminder с общим текстом
→ followup_ask вместо schedule_reminder

Правило: N событий в N разных времён = N вызовов schedule_reminder.
```

Also strengthen the existing rule about `followup_ask`:
```
followup_ask — ТОЛЬКО для эскалации после проактивных сообщений (morning_greeting, meal_reminder). НИКОГДА не используй когда пользователь просит напомнить — для этого есть schedule_reminder.
```
(This line already exists but needs emphasis — make it bold or add a second mention.)