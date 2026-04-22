import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { repeatingJobs, type RepeatingJob } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const repeatingJobsRepo = {
  async upsert(data: {
    userId: number;
    schedulerId: string;
    kind: string;
    payload: Record<string, unknown>;
    cronPattern: string;
    timezone: string;
  }): Promise<void> {
    await db()
      .insert(repeatingJobs)
      .values(data)
      .onConflictDoUpdate({
        target: repeatingJobs.schedulerId,
        set: {
          kind: data.kind,
          payload: data.payload,
          cronPattern: data.cronPattern,
          timezone: data.timezone,
        },
      });
  },

  async remove(schedulerId: string): Promise<void> {
    await db().delete(repeatingJobs).where(eq(repeatingJobs.schedulerId, schedulerId));
  },

  async findAll(): Promise<RepeatingJob[]> {
    return db().select().from(repeatingJobs);
  },

  async findByUser(userId: number): Promise<RepeatingJob[]> {
    return db().select().from(repeatingJobs).where(eq(repeatingJobs.userId, userId));
  },

  async findBySchedulerId(schedulerId: string): Promise<RepeatingJob | undefined> {
    const rows = await db().select().from(repeatingJobs).where(eq(repeatingJobs.schedulerId, schedulerId)).limit(1);
    return rows[0];
  },
};
