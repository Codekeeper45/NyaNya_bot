import { MemoryClient } from 'mem0ai';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('mem0');

let client: MemoryClient | null = null;

function getClient(): MemoryClient | null {
  if (!config.mem0ApiKey) return null;
  if (!client) client = new MemoryClient({ apiKey: config.mem0ApiKey });
  return client;
}

export function isMem0Available(): boolean {
  return !!config.mem0ApiKey;
}

export const mem0 = {
  async add(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    userId: string,
    metadata?: Record<string, unknown>,
  ) {
    const c = getClient();
    if (!c) { log.debug('Mem0 not configured, skipping add'); return null; }
    try {
      const result = await c.add(messages, {
        user_id: userId,
        metadata: metadata ?? {},
      });
      log.debug({ userId, count: Array.isArray(result) ? result.length : 0 }, 'Memories extracted');
      return result;
    } catch (err) {
      log.error({ err, userId }, 'Failed to add memories');
      return null;
    }
  },

  async search(query: string, userId: string, limit = 10) {
    const c = getClient();
    if (!c) { log.debug('Mem0 not configured, skipping search'); return []; }
    try {
      const results = await c.search(query, {
        user_id: userId,
        limit,
      });
      log.debug({ userId, count: Array.isArray(results) ? results.length : 0 }, 'Memory search');
      return Array.isArray(results) ? results : [];
    } catch (err) {
      log.error({ err, userId }, 'Failed to search memories');
      return [];
    }
  },

  async getAll(userId: string) {
    const c = getClient();
    if (!c) { log.debug('Mem0 not configured, skipping getAll'); return []; }
    try {
      const result = await c.getAll({ user_id: userId });
      return Array.isArray(result) ? result : [];
    } catch (err) {
      log.error({ err, userId }, 'Failed to get all memories');
      return [];
    }
  },

  async deleteAll(userId: string) {
    const c = getClient();
    if (!c) { log.debug('Mem0 not configured, skipping deleteAll'); return; }
    try {
      await c.deleteAll({ user_id: userId });
      log.info({ userId }, 'All memories deleted');
    } catch (err) {
      log.error({ err, userId }, 'Failed to delete memories');
    }
  },
};
