import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphEntityAliasesRepo } from '../db/repos/graph_entity_aliases.js';

const VECTOR_DUPLICATE_DISTANCE = 0.18;
const SELF_ALIASES = new Set(['я', 'мне', 'меня', 'мной', 'мой', 'моя', 'мое', 'моё', 'пользователь', 'user']);
const MAX_DESCRIPTION_LENGTH = 1000;

export interface EntityCandidateInput {
  userId: number;
  userName: string;
  name: string;
  description: string;
  embedding: number[];
}

export interface ResolvedEntity {
  entityId: string;
  name: string;
}

export function normalizeEntityAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["'«»“”„]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 255);
}

function compactDescription(...parts: string[]): string {
  const seen = new Set<string>();
  const segments: string[] = [];
  for (const part of parts) {
    for (const raw of part.split(';')) {
      const segment = raw.trim().replace(/\s+/g, ' ');
      if (!segment) continue;
      const key = segment.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const next = [...segments, segment].join('; ');
      if (next.length > MAX_DESCRIPTION_LENGTH) return segments.join('; ');
      segments.push(segment);
    }
  }
  return segments.join('; ');
}

async function upsertAlias(userId: number, entityId: string, alias: string, source: string, confidence: number): Promise<void> {
  const normalizedAlias = normalizeEntityAlias(alias);
  if (!normalizedAlias) return;
  await graphEntityAliasesRepo.upsert({
    userId,
    entityId,
    alias: alias.trim().slice(0, 255),
    normalizedAlias,
    source,
    confidence,
  });
}

export async function resolveEntityCandidate(input: EntityCandidateInput): Promise<ResolvedEntity> {
  const extractedName = input.name.trim().replace(/\s+/g, ' ');
  const normalizedOriginal = normalizeEntityAlias(extractedName);
  const userCanonicalName = input.userName.trim() || 'Пользователь';
  const canonicalName = SELF_ALIASES.has(normalizedOriginal) ? userCanonicalName : extractedName;
  const normalizedCanonical = normalizeEntityAlias(canonicalName);

  const [exactAlias, canonicalAlias] = await Promise.all([
    graphEntityAliasesRepo.findByNormalizedAlias(input.userId, normalizedOriginal),
    normalizedCanonical !== normalizedOriginal
      ? graphEntityAliasesRepo.findByNormalizedAlias(input.userId, normalizedCanonical)
      : Promise.resolve(undefined),
  ]);

  if (exactAlias) {
    const entity = await graphEntitiesRepo.findByIdForUser(input.userId, exactAlias.entityId);
    if (entity) {
      await upsertAlias(input.userId, entity.id, extractedName, 'resolver', 100);
      return { entityId: entity.id, name: entity.name };
    }
  }

  if (canonicalAlias) {
    const entity = await graphEntitiesRepo.findByIdForUser(input.userId, canonicalAlias.entityId);
    if (entity) {
      await upsertAlias(input.userId, entity.id, extractedName, 'resolver', 100);
      return { entityId: entity.id, name: entity.name };
    }
  }

  const similar = await graphEntitiesRepo.searchSimilar(input.userId, input.embedding, 1);
  const duplicate = similar[0]?.distance != null && similar[0].distance < VECTOR_DUPLICATE_DISTANCE;
  if (duplicate) {
    const existing = await graphEntitiesRepo.findByIdForUser(input.userId, similar[0].id);
    if (existing) {
      const mergedDescription = compactDescription(existing.description, input.description);
      await graphEntitiesRepo.updateDescription(existing.id, mergedDescription, input.embedding);
      await graphEntitiesRepo.updateUsage(existing.id, 1);
      await upsertAlias(input.userId, existing.id, extractedName, 'resolver', 90);
      await upsertAlias(input.userId, existing.id, existing.name, 'resolver', 100);
      return { entityId: existing.id, name: existing.name };
    }
  }

  const entityId = await graphEntitiesRepo.create({
    userId: input.userId,
    name: canonicalName.slice(0, 255),
    description: input.description,
    embedding: input.embedding,
    importanceScore: SELF_ALIASES.has(normalizedOriginal) ? 30 : 10,
  });
  await upsertAlias(input.userId, entityId, canonicalName, 'resolver', 100);
  if (normalizeEntityAlias(extractedName) !== normalizeEntityAlias(canonicalName)) {
    await upsertAlias(input.userId, entityId, extractedName, 'resolver', 100);
  }
  return { entityId, name: canonicalName };
}
