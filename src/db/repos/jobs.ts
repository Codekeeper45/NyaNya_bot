import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '../client.js';
import { jobs, type Job } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const jobsRepo = {
  async create(data: {
    userId: number;
    bullJobId?: string;
    kind: string;
    payload: Record<string, unknown>;
    status?: string;
    scheduledAt?: Date;
  }): Promise<Job> {
    const result = await db().insert(jobs).values({
      userId: data.userId,
      bullJobId: data.bullJobId ?? null,
      kind: data.kind,
      payload: data.payload,
      status: data.status ?? 'scheduled',
      scheduledAt: data.scheduledAt ?? null,
    }).returning();
    const row = result[0];
    if (!row) throw new Error('DB insert returned no rows');
    return row;
  },

  async updateStatus(bullJobId: string, status: string): Promise<void> {
    await db()
      .update(jobs)
      .set({ status, processedAt: status === 'processed' || status === 'cancelled' ? new Date() : undefined })
      .where(eq(jobs.bullJobId, bullJobId));
  },

  async updateBullJobId(dbId: number, bullJobId: string): Promise<void> {
    await db().update(jobs).set({ bullJobId }).where(eq(jobs.id, dbId));
  },

  async findPendingByUser(userId: number): Promise<Job[]> {
    return db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.status, 'scheduled'), gt(jobs.scheduledAt, new Date())))
      .orderBy(jobs.scheduledAt);
  },

  async belongsToUser(bullJobId: string, userId: number): Promise<boolean> {
    const result = await db()
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.bullJobId, bullJobId), eq(jobs.userId, userId)))
      .limit(1);
    return result.length > 0;
  },
};
