# Deep Memory Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate GraphRAG entities by adding canonical aliases, resolver-based entity identity, and sourced atomic facts.

**Architecture:** Keep the existing GraphRAG tables as the runtime path, then add alias and fact tables around them. Extraction becomes context-aware, and indexing resolves extracted names to canonical entities before writing relationships/facts.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL/pgvector, Vercel AI SDK, OpenRouter, Vitest.

---

### Task 1: Schema And Repositories

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/repos/graph_entity_aliases.ts`
- Create: `src/db/repos/graph_facts.ts`
- Create: `src/db/repos/graph_fact_sources.ts`
- Test: `src/db/repos/graph_entity_aliases.test.ts`

- [ ] Add `graph_entity_aliases`, `graph_facts`, and `graph_fact_sources` tables with indexes and unique constraints.
- [ ] Add repository methods for alias lookup/upsert and fact/source upsert.
- [ ] Test alias lookup by normalized alias and conflict-safe alias upsert.

### Task 2: Entity Resolver

**Files:**
- Create: `src/graphrag/entity-resolver.ts`
- Create: `src/graphrag/entity-resolver.test.ts`
- Modify: `src/db/repos/graph_entities.ts`

- [ ] Implement `normalizeEntityAlias()`.
- [ ] Implement self-user alias handling for `я`, `мне`, `меня`, `пользователь`, and the user's display name.
- [ ] Resolve by exact alias first, then conservative vector similarity, then create a canonical entity.
- [ ] Always upsert original extracted aliases to the canonical entity.

### Task 3: Context-Aware Extraction

**Files:**
- Modify: `src/graphrag/extraction.ts`
- Modify: `src/graphrag/extraction.test.ts`

- [ ] Let `extractTriplets()` accept known canonical entities and aliases.
- [ ] Include a compact known-entity block in the prompt.
- [ ] Keep the JSON triplet format backward-compatible.

### Task 4: Indexer Integration

**Files:**
- Modify: `src/graphrag/indexer.ts`
- Modify: `src/graphrag/indexer.test.ts`

- [ ] Fetch known entities from chunk similarity before extraction.
- [ ] Resolve subjects and objects through the resolver.
- [ ] Store relationships with canonical IDs.
- [ ] Store facts and source links for each triplet.

### Task 5: Verification And Deployment

**Files:**
- Generated migration under `drizzle/` if Drizzle generation is available.

- [ ] Run focused tests for resolver, extraction, indexer, and repos.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Generate or apply DB schema update.
- [ ] Deploy source, bundle, lockfile/migrations if changed.
- [ ] Verify local and remote bundle hashes match.
