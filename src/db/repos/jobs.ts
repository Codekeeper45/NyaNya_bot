import { eq, and } from 'drizzle-orm';
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

  async updateStatus(id: number, status: string): Promise<void> {
    await db().update(jobs).set({
      status,
      ...(status === 'completed' ? { processedAt: new Date() } : {}),
    }).where(eq(jobs.id, id));
  },

  async findByUserAndKind(userId: number, kind: string): Promise<Job[]> {
    return db()
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.kind, kind)));
  },

  async findByBullJobId(bullJobId: string): Promise<Job | undefined> {
    const result = await db()
      .select()
      .from(jobs)
      .where(eq(jobs.bullJobId, bullJobId))
      .limit(1);
    return result[0];
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
