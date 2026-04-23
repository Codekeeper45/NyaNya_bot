import { embedTexts } from './embeddings.js';
import { extractTriplets } from './extraction.js';
import { chunkText } from './chunking.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphEntityMentionsRepo } from '../db/repos/graph_entity_mentions.js';
import { graphIndexStateRepo } from '../db/repos/graph_index_state.js';
import { messagesRepo } from '../db/repos/messages.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:indexer');

const ENTITY_DEDUP_DISTANCE = 0.1; // cosine distance; 0.1 ≈ similarity 0.9

export async function indexUserMessages(userId: number): Promise<void> {
  const state = await graphIndexStateRepo.get(userId);
  const lastId = state?.lastIndexedMessageId ?? 0;

  // Fetch recent messages not yet indexed
  const messages = await messagesRepo.getRecent(userId, 1000);
  const newMessages = messages.filter(m => m.id > lastId);
  if (newMessages.length === 0) {
    log.debug({ userId }, 'No new messages to index');
    return;
  }

  log.info({ userId, count: newMessages.length }, 'Indexing messages');

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
    const triplets = await extractTriplets(chunks[i]);
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

    // Deduplicate and store entities
    const entityIdMap = new Map<string, string>(); // name -> entityId

    for (let j = 0; j < entityNames.length; j++) {
      const name = entityNames[j];
      const desc = descriptions[j];
      const emb = entityEmbeddings[j];

      // Check for duplicates via vector similarity
      const similar = await graphEntitiesRepo.searchSimilar(userId, emb, 1);
      const duplicate = similar[0]?.distance != null && similar[0].distance < ENTITY_DEDUP_DISTANCE;

      let entityId: string;
      if (duplicate) {
        entityId = similar[0].id;
        // Merge description
        const existing = await graphEntitiesRepo.findById(entityId);
        if (existing) {
          const merged = `${existing.description}; ${desc}`;
          const mergedEmb = await embedTexts([merged]);
          await graphEntitiesRepo.updateDescription(entityId, merged, mergedEmb[0]);
          log.debug({ entityId, name }, 'Merged duplicate entity');
        }
      } else {
        entityId = await graphEntitiesRepo.create({
          userId,
          name,
          description: desc,
          embedding: emb,
        });
      }

      entityIdMap.set(name, entityId);

      // Link entity to chunk
      await graphEntityMentionsRepo.create({ entityId, chunkId: chunkIds[i] });
    }

    // Store relationships
    for (const triplet of triplets) {
      const sourceId = entityIdMap.get(triplet.subject);
      const targetId = entityIdMap.get(triplet.object);
      if (!sourceId || !targetId) continue;

      // Skip self-loops
      if (sourceId === targetId) continue;

      try {
        await graphRelationshipsRepo.create({
          userId,
          sourceId,
          targetId,
          description: `${triplet.subject} ${triplet.predicate} ${triplet.object}`,
          weight: 1,
        });
      } catch {
        // Ignore duplicate relationship errors
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
