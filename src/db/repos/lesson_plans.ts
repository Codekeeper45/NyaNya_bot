import { eq, and, desc, gte, count } from 'drizzle-orm';
import { getDb } from '../client.js';
import { lessonPlans, type LessonPlan } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const lessonPlansRepo = {
  async create(data: {
    userId: number;
    subject: string;
    topic: string;
    materials?: Record<string, unknown>[];
    plan?: string;
    status?: string;
  }): Promise<LessonPlan> {
    const result = await db().insert(lessonPlans).values({
      userId: data.userId,
      subject: data.subject,
      topic: data.topic,
      materials: data.materials ?? [],
      plan: data.plan ?? null,
      status: data.status ?? 'draft',
    }).returning();
    const row = result[0];
    if (!row) throw new Error('DB insert returned no rows');
    return row;
  },

  async findByUser(userId: number): Promise<LessonPlan[]> {
    return db()
      .select()
      .from(lessonPlans)
      .where(eq(lessonPlans.userId, userId))
      .orderBy(desc(lessonPlans.createdAt));
  },

  async findById(id: number): Promise<LessonPlan | undefined> {
    const result = await db()
      .select()
      .from(lessonPlans)
      .where(eq(lessonPlans.id, id))
      .limit(1);
    return result[0];
  },

  async findByIdForUser(id: number, userId: number): Promise<LessonPlan | undefined> {
    const result = await db()
      .select()
      .from(lessonPlans)
      .where(and(eq(lessonPlans.id, id), eq(lessonPlans.userId, userId)))
      .limit(1);
    return result[0];
  },

  async updateSchedule(id: number, userId: number, data: {
    scheduledDays: number[];
    scheduledTime: string;
    durationMinutes: number;
  }): Promise<void> {
    await db()
      .update(lessonPlans)
      .set(data)
      .where(and(eq(lessonPlans.id, id), eq(lessonPlans.userId, userId)));
  },

  async update(id: number, data: Partial<Omit<LessonPlan, 'id' | 'userId' | 'createdAt'>>): Promise<void> {
    await db().update(lessonPlans).set(data).where(eq(lessonPlans.id, id));
  },

  async updateStatusForUser(id: number, userId: number, status: LessonPlan['status']): Promise<boolean> {
    const updated = await db()
      .update(lessonPlans)
      .set({ status })
      .where(and(eq(lessonPlans.id, id), eq(lessonPlans.userId, userId)))
      .returning({ id: lessonPlans.id });
    return updated.length > 0;
  },

  async delete(id: number): Promise<void> {
    await db().delete(lessonPlans).where(eq(lessonPlans.id, id));
  },

  async getWeeklyStats(userId: number): Promise<{ totalPlans: number; completedPlans: number }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const totalResult = await db()
      .select({ value: count() })
      .from(lessonPlans)
      .where(
        and(
          eq(lessonPlans.userId, userId),
          gte(lessonPlans.createdAt, sevenDaysAgo)
        )
      );

    const completedResult = await db()
      .select({ value: count() })
      .from(lessonPlans)
      .where(
        and(
          eq(lessonPlans.userId, userId),
          eq(lessonPlans.status, 'completed'),
          gte(lessonPlans.createdAt, sevenDaysAgo)
        )
      );

    return {
      totalPlans: Number(totalResult[0]?.value ?? 0),
      completedPlans: Number(completedResult[0]?.value ?? 0),
    };
  },
};
