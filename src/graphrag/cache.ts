import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:cache');

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  constructor(
    private maxSize: number,
    private ttlMs: number,
    private name: string,
  ) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.delete(key);
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/** Cosine similarity between two normalized embeddings (-1 to 1) */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** LRU cache for query embeddings: 100 entries, 15 min TTL */
export const embeddingCache = new LRUCache<number[]>(100, 15 * 60 * 1000, 'embedding');

/** Per-user context cache: 50 users, 2 min TTL */
export const contextCache = new LRUCache<{ context: string; entityIds: string[] }>(
  50,
  2 * 60 * 1000,
  'context',
);

/** Per-user last query embedding for dedup: 50 users, 3 min TTL */
export const lastQueryCache = new LRUCache<{ text: string; embedding: number[] }>(
  50,
  3 * 60 * 1000,
  'lastQuery',
);

/** Check if current query is similar to recent query for this user (>0.92 similarity) */
export function isSimilarToRecentQuery(userId: number, embedding: number[]): boolean {
  const last = lastQueryCache.get(String(userId));
  if (!last) return false;
  const sim = cosineSimilarity(embedding, last.embedding);
  log.debug({ userId, similarity: sim }, 'Query similarity check');
  return sim > 0.92;
}

/** Update last query for dedup tracking */
export function recordLastQuery(userId: number, text: string, embedding: number[]): void {
  lastQueryCache.set(String(userId), { text, embedding });
}

export { log };
