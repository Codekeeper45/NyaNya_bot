# Deep Memory Model Design

## Goal

Improve long-term memory quality by preventing duplicate graph entities, preserving canonical names, storing aliases, and keeping sourced atomic facts that can be retrieved without relying only on noisy graph traversal.

## Problem

The current GraphRAG indexer asks a free OpenRouter model to extract triplets from each chunk. The model sees only the chunk text, so it can name the same real entity differently across chunks: `Эмир`, `Emir`, `пользователь`, `я`, `он`. The current dedupe step only compares entity description embeddings with a strict `distance < 0.1` threshold after extraction. That catches obvious semantic duplicates but misses aliases and slightly different descriptions.

## Architecture

Memory indexing becomes a canonicalization pipeline:

```text
messages -> chunks -> context-aware triplet extraction -> entity resolver -> canonical entities + aliases -> facts + sources -> retrieval
```

The extractor proposes candidate entities and facts. The resolver decides whether each candidate maps to an existing canonical entity or creates a new one. The resolver uses normalized aliases, special self-user aliases, vector similarity, and a conservative confidence threshold. This keeps the free model useful without trusting it to make identity decisions.

## Data Model

Add `graph_entity_aliases`:
- `user_id`: owner.
- `entity_id`: canonical `graph_entities.id`.
- `alias`: original visible alias.
- `normalized_alias`: lowercase normalized key used for exact matching.
- `source`: `extracted`, `resolver`, `manual`, or `backfill`.
- `confidence`: integer 0-100.

Add `graph_facts`:
- `user_id`: owner.
- `subject_id`: canonical subject entity.
- `predicate`: normalized relation label.
- `object_id`: canonical object entity when object is entity-like.
- `object_text`: original object text for display.
- `statement`: compact natural-language fact.
- `fact_key`: deterministic dedupe key.
- `embedding`: vector for semantic retrieval.
- `confidence`: integer 0-100.

Add `graph_fact_sources`:
- `fact_id`: fact row.
- `chunk_id`: source chunk.

## Indexing Flow

1. Store chunks as today.
2. Fetch up to 20 known entities similar to the chunk embedding and their aliases.
3. Pass those known entities to `extractTriplets()` so the model prefers canonical names.
4. Resolve every extracted subject/object through `resolveEntityCandidate()`.
5. Upsert aliases for the original names the model used.
6. Upsert relationships using canonical entity IDs.
7. Upsert atomic facts using canonical subject/object IDs and deterministic `fact_key`.
8. Link each fact to the source chunk.

## Retrieval Flow

GraphRAG remains the automatic memory layer, but formatted context should prefer canonical entity names and compact facts. Archive search remains the exact-source fallback over saved facts and chunks.

## Backfill Strategy

The first implementation does not destructively merge old rows. It prevents new duplicates and records aliases/facts going forward. A later safe backfill can cluster old entities by normalized names, aliases, and vector similarity, then merge relationships/mentions after review.

## Testing

Tests cover:
- alias normalization and self-user alias handling;
- exact alias resolution;
- vector duplicate resolution;
- context-aware extraction prompt includes known entities;
- indexer creates aliases and facts using canonical IDs;
- existing GraphRAG tests continue passing.

## Rollout

This requires a DB schema update before restarting production. Runtime must tolerate duplicate fact/source insert conflicts. If migration is not applied, indexing will fail when it touches the new tables.
