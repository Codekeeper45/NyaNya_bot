import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { jobSkipOnce } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const jobSkipOnceRepo = {
  async set(schedulerId: string): Promise<void> {
    await db()
      .insert(jobSkipOnce)
      .values({ schedulerId })
      .onConflictDoNothing();
  },

  async shouldSkip(schedulerId: string): Promise<boolean> {
    const rows = await db()
      .select()
      .from(jobSkipOnce)
      .where(eq(jobSkipOnce.schedulerId, schedulerId))
      .limit(1);
    return rows.length > 0;
  },

  async clear(schedulerId: string): Promise<void> {
    await db().delete(jobSkipOnce).where(eq(jobSkipOnce.schedulerId, schedulerId));
  },
};
