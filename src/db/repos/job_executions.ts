import { eq, and, gte, sql, lt, ne } from 'drizzle-orm';
import { getDb } from '../client.js';
import { jobExecutions } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const jobExecutionsRepo = {
  async create(data: {
    userId: number;
    schedulerId?: string;
    kind: string;
    attemptNumber?: number;
    wasSkipped?: boolean;
    skipReason?: string;
    userRepliedWithin30Min?: boolean;
  }): Promise<void> {
    await db().insert(jobExecutions).values({
      ...data,
      wasSkipped: data.wasSkipped ?? false,
    });
  },

  // Note: findRecentByUser and findBySchedulerId removed as dead code.

  async getSkipRateByDayOfWeek(userId: number, kind: string): Promise<Record<number, { total: number; skipped: number }>> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db()
      .select({
        dayOfWeek: sql<number>`EXTRACT(DOW FROM ${jobExecutions.executedAt})`,
        total: sql<number>`COUNT(*)`,
        skipped: sql<number>`SUM(CASE WHEN ${jobExecutions.wasSkipped} THEN 1 ELSE 0 END)`,
      })
      .from(jobExecutions)
      .where(and(
        eq(jobExecutions.userId, userId),
        eq(jobExecutions.kind, kind),
        gte(jobExecutions.executedAt, since)
      ))
      .groupBy(sql`EXTRACT(DOW FROM ${jobExecutions.executedAt})`);

    const result: Record<number, { total: number; skipped: number }> = {};
    for (const row of rows) {
      result[row.dayOfWeek] = { total: Number(row.total), skipped: Number(row.skipped) };
    }
    return result;
  },

  async getFollowupResponseStats(userId: number): Promise<{ attempt: number; total: number; replied: number }[]> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db()
      .select({
        attempt: jobExecutions.attemptNumber,
        total: sql<number>`COUNT(*)`,
        replied: sql<number>`SUM(CASE WHEN ${jobExecutions.userRepliedWithin30Min} THEN 1 ELSE 0 END)`,
      })
      .from(jobExecutions)
      .where(and(
        eq(jobExecutions.userId, userId),
        eq(jobExecutions.kind, 'followup_check'),
        gte(jobExecutions.executedAt, since)
      ))
      .groupBy(jobExecutions.attemptNumber);

    return rows.map(r => ({
      attempt: r.attempt ?? 0,
      total: Number(r.total),
      replied: Number(r.replied),
    }));
  },

  async deleteOlderThan(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await db().delete(jobExecutions).where(lt(jobExecutions.executedAt, cutoff));
  },

  async countFollowupsSinceLastProactive(userId: number, schedulerId?: string): Promise<number> {
    if (!schedulerId) {
      // Without schedulerId we cannot track per-event follow-ups.
      // Return a high number to block follow-ups in this edge case.
      return 999;
    }
    const last = await db()
      .select({ executedAt: jobExecutions.executedAt })
      .from(jobExecutions)
      .where(and(
        eq(jobExecutions.userId, userId),
        eq(jobExecutions.schedulerId, schedulerId),
        eq(jobExecutions.wasSkipped, false),
      ))
      .orderBy(sql`${jobExecutions.executedAt} DESC`)
      .limit(1);
    if (!last.length) return 0;
    const since = last[0].executedAt;
    const rows = await db()
      .select({ count: sql<number>`COUNT(*)` })
      .from(jobExecutions)
      .where(and(
        eq(jobExecutions.userId, userId),
        eq(jobExecutions.kind, 'followup_check'),
        gte(jobExecutions.executedAt, since),
      ));
    return Number(rows[0]?.count ?? 0);
  },
};
