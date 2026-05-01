import { embedTexts } from './embeddings.js';
import { extractTriplets } from './extraction.js';
import { chunkText } from './chunking.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphEntityAliasesRepo } from '../db/repos/graph_entity_aliases.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphEntityMentionsRepo } from '../db/repos/graph_entity_mentions.js';
import { graphFactsRepo } from '../db/repos/graph_facts.js';
import { graphFactSourcesRepo } from '../db/repos/graph_fact_sources.js';
import { graphIndexStateRepo } from '../db/repos/graph_index_state.js';
import { messagesRepo } from '../db/repos/messages.js';
import { usersRepo } from '../db/repos/users.js';
import { normalizeEntityAlias, resolveEntityCandidate } from './entity-resolver.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:indexer');

const INDEX_BATCH_SIZE = 500;

function makeFactKey(subjectId: string, predicate: string, objectId: string): string {
  return [subjectId, normalizeEntityAlias(predicate), objectId].join('|').slice(0, 700);
}

async function knownEntitiesForChunk(userId: number, chunkEmbedding: number[]) {
  const similar = await graphEntitiesRepo.searchSimilar(userId, chunkEmbedding, 20) ?? [];
  const aliases = await graphEntityAliasesRepo.findByEntityIds(similar.map(e => e.id)) ?? [];
  const aliasMap = new Map<string, string[]>();
  for (const alias of aliases) {
    const list = aliasMap.get(alias.entityId) ?? [];
    list.push(alias.alias);
    aliasMap.set(alias.entityId, list);
  }
  return similar.map(entity => ({
    name: entity.name,
    aliases: [...new Set(aliasMap.get(entity.id) ?? [])].slice(0, 8),
  }));
}

export async function indexUserMessages(userId: number): Promise<void> {
  const state = await graphIndexStateRepo.get(userId);
  const lastId = state?.lastIndexedMessageId ?? 0;

  // Fetch the next contiguous batch so old unindexed messages are never skipped.
  const newMessages = await messagesRepo.getAfterId(userId, lastId, INDEX_BATCH_SIZE);
  if (newMessages.length === 0) {
    log.debug({ userId }, 'No new messages to index');
    return;
  }

  log.info({ userId, count: newMessages.length }, 'Indexing messages');
  const user = await usersRepo.findById(userId);
  const userName = user?.name ?? 'Пользователь';

  // Concatenate into raw text
  const rawText = newMessages
    .map(m => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`)
    .join('\n\n');

  // Chunk
  const chunks = chunkText(rawText, 2400, 400);
  if (chunks.length === 0) return;

  // Embed chunks
  const chunkEmbeddings = await embedTexts(chunks);

  // Store chunks
  const chunkIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const id = await graphChunksRepo.create({
      userId,
      content: chunks[i],
      embedding: chunkEmbeddings[i],
    });
    chunkIds.push(id);
  }

  // Extract triplets per chunk
  for (let i = 0; i < chunks.length; i++) {
    const knownEntities = await knownEntitiesForChunk(userId, chunkEmbeddings[i]);
    const triplets = await extractTriplets(chunks[i], { knownEntities });
    if (triplets.length === 0) continue;

    const entityNames = [...new Set([...triplets.map(t => t.subject), ...triplets.map(t => t.object)])];
    const entityDescMap = new Map<string, string>();

    // Build descriptions from triplets
    for (const name of entityNames) {
      const relevant = triplets.filter(t => t.subject === name || t.object === name);
      const desc = relevant.map(t => `${t.subject} ${t.predicate} ${t.object}`).join('; ');
      entityDescMap.set(name, desc);
    }

    // Embed entity descriptions
    const descriptions = entityNames.map(n => entityDescMap.get(n) ?? n);
    const entityEmbeddings = await embedTexts(descriptions);

    // Resolve and store canonical entities
    const entityMap = new Map<string, { id: string; name: string }>(); // extracted name -> canonical entity

    for (let j = 0; j < entityNames.length; j++) {
      const name = entityNames[j];
      const desc = descriptions[j];
      const emb = entityEmbeddings[j];

      const resolved = await resolveEntityCandidate({
        userId,
        userName,
        name,
        description: desc,
        embedding: emb,
      });

      entityMap.set(name, { id: resolved.entityId, name: resolved.name });

      // Link entity to chunk
      await graphEntityMentionsRepo.create({ entityId: resolved.entityId, chunkId: chunkIds[i] });
    }

    // Store relationships and facts
    const validTriplets = triplets.map(t => {
      const source = entityMap.get(t.subject);
      const target = entityMap.get(t.object);
      if (!source || !target || source.id === target.id) return null;
      const statement = `${source.name} ${t.predicate} ${target.name}`;
      const factKey = makeFactKey(source.id, t.predicate, target.id);
      return { source, target, predicate: t.predicate, statement, factKey };
    }).filter((t): t is NonNullable<typeof t> => t !== null);

    if (validTriplets.length === 0) continue;

    const factEmbeddings = await embedTexts(validTriplets.map(t => t.statement));

    for (let k = 0; k < validTriplets.length; k++) {
      const { source, target, predicate, statement, factKey } = validTriplets[k];

      try {
        await graphRelationshipsRepo.create({
          userId,
          sourceId: source.id,
          targetId: target.id,
          description: statement,
          weight: 1,
        });
      } catch {
        // Ignore duplicate relationship errors
      }

      const factId = await graphFactsRepo.upsert({
        userId,
        subjectId: source.id,
        predicate: predicate.slice(0, 255),
        objectId: target.id,
        objectText: target.name,
        statement,
        factKey,
        embedding: factEmbeddings[k],
        confidence: 80,
      }) ?? (await graphFactsRepo.findByFactKey(userId, factKey))?.id;
      if (factId) {
        await graphFactSourcesRepo.create({ factId, chunkId: chunkIds[i] });
      }
    }
  }

  // Update index state
  const maxId = Math.max(...newMessages.map(m => m.id));
  await graphIndexStateRepo.upsert(userId, maxId);
  log.info({ userId, chunks: chunks.length, messages: newMessages.length }, 'Indexing complete');
}

export async function indexAllUsers(): Promise<void> {
  const { usersRepo } = await import('../db/repos/users.js');
  const users = await usersRepo.findAllActive();
  for (const user of users) {
    try {
      await indexUserMessages(user.id);
    } catch (err) {
      log.error({ err, userId: user.id }, 'Failed to index user');
    }
  }
}
