# Memory Archive Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved memories visible immediately, stop injected memory context from being treated as user text, and add an explicit archive search tool that prioritizes `memory_save` facts before raw conversation chunks.

**Architecture:** Keep GraphRAG as the fast associative memory. Add a lightweight targeted archive layer on top of existing `messages` and `graph_chunks` tables rather than creating timeline/wiki tables now. Pass retrieved memory to the LLM as system context, not as user-authored text.

**Tech Stack:** Node.js, TypeScript, Vercel AI SDK tools, Drizzle ORM, PostgreSQL/pgvector, Vitest.

---

### Task 1: Separate Injected Memory From User Text

**Files:**
- Modify: `src/agent/orchestrator.ts`
- Test: `src/agent/orchestrator.test.ts`

- [ ] Add/adjust a test that captures `generateText` input and verifies GraphRAG context is passed as a `system` message while the final user message contains only the actual Telegram text.
- [ ] Modify `runOrchestrator()` so `buildFloatingSubgraph()` appends a separate `ModelMessage` with `role: 'system'` and memory context instead of prefixing `userMessageText`.
- [ ] Modify proactive trigger packaging so it is also a `system` message rather than a fake user message.
- [ ] Run `npx vitest run src/agent/orchestrator.test.ts` and verify it passes.

### Task 2: Show Raw Saved Facts In `/who`

**Files:**
- Modify: `src/db/repos/messages.ts`
- Modify: `src/bot/handlers/who-format.ts`
- Modify: `src/bot/handlers/commands.ts`
- Test: `src/bot/handlers/commands.test.ts`

- [ ] Add `messagesRepo.getSavedFacts(userId, limit?)` returning `memory_save` messages in ascending order for stable display.
- [ ] Add formatting helpers that strip `Факт о пользователе:` and HTML-escape saved facts.
- [ ] Update `/who` to include saved facts before graph entities/relationships.
- [ ] Preserve the existing empty-state behavior only when both saved facts and graph data are absent.
- [ ] Run `npx vitest run src/bot/handlers/commands.test.ts` and verify it passes.

### Task 3: Add Targeted Archive Search

**Files:**
- Create: `src/memory/archive-search.ts`
- Create: `src/memory/archive-search.test.ts`
- Modify: `src/db/repos/messages.ts`
- Modify: `src/db/repos/graph_chunks.ts`

- [ ] Add repository methods for text search over saved facts and bounded semantic chunk lookup.
- [ ] Implement `searchMemoryArchive(userId, query)` that returns saved facts first, then graph chunks, with source labels and dates.
- [ ] Deduplicate repeated snippets and keep returned context compact.
- [ ] Run `npx vitest run src/memory/archive-search.test.ts` and verify it passes.

### Task 4: Expose Archive Search As An Agent Tool

**Files:**
- Create: `src/agent/tools/memory_archive.ts`
- Create: `src/agent/tools/memory_archive.test.ts`
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/prompts/system.ts`

- [ ] Add `memory_search_archive(query)` tool that calls `searchMemoryArchive()`.
- [ ] Return `{ found: false }` with a clear message when no archive context is found.
- [ ] Register the tool in `allTools()`.
- [ ] Update the system prompt: use GraphRAG for associative recall, archive search for exact details, old context, and verification.
- [ ] Run `npx vitest run src/agent/tools/memory_archive.test.ts` and verify it passes.

### Task 5: Verification

**Files:**
- No new files.

- [ ] Run focused tests:
  `npx vitest run src/agent/orchestrator.test.ts src/bot/handlers/commands.test.ts src/memory/archive-search.test.ts src/agent/tools/memory_archive.test.ts`
- [ ] Run full unit suite: `npm test`.
- [ ] Run build: `npm run build`.
- [ ] Review `git diff` for accidental unrelated changes and summarize results.
