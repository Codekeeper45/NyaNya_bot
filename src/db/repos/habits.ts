import { eq, and, desc, inArray } from 'drizzle-orm';
import { getDb } from '../client.js';
import { habits, habitLogs, type Habit, type HabitLog } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const habitsRepo = {
  async create(userId: number, name: string, targetDays: number[] = [0, 1, 2, 3, 4, 5, 6]): Promise<Habit> {
    const result = await db().insert(habits).values({ userId, name, targetDays }).returning();
    const row = result[0];
    if (!row) throw new Error('DB insert returned no rows');
    return row;
  },

  async findByUser(userId: number): Promise<Habit[]> {
    return db().select().from(habits).where(eq(habits.userId, userId)).orderBy(desc(habits.createdAt));
  },

  async findById(id: number, userId: number): Promise<Habit | undefined> {
    const result = await db()
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, userId)))
      .limit(1);
    return result[0];
  },

  async log(habitId: number, date: string, done: boolean): Promise<HabitLog> {
    const result = await db()
      .insert(habitLogs)
      .values({ habitId, date, done })
      .onConflictDoUpdate({
        target: [habitLogs.habitId, habitLogs.date],
        set: { done },
      })
      .returning();
    const row = result[0];
    if (!row) throw new Error('DB upsert returned no rows');
    return row;
  },

  async updateStreak(habitId: number, streak: number, lastLoggedDate: string): Promise<void> {
    await db().update(habits).set({ streak, lastLoggedDate }).where(eq(habits.id, habitId));
  },

  async delete(habitId: number): Promise<void> {
    await db().delete(habits).where(eq(habits.id, habitId));
  },

  async getTodayLogs(userId: number, date: string): Promise<Array<{ habit: Habit; log: HabitLog | null }>> {
    const userHabits = await this.findByUser(userId);
    const results: Array<{ habit: Habit; log: HabitLog | null }> = [];
    for (const habit of userHabits) {
      const logs = await db()
        .select()
        .from(habitLogs)
        .where(and(eq(habitLogs.habitId, habit.id), eq(habitLogs.date, date)))
        .limit(1);
      results.push({ habit, log: logs[0] ?? null });
    }
    return results;
  },

  async getWeekLogs(habitId: number, dates: string[]): Promise<HabitLog[]> {
    if (dates.length === 0) return [];
    return db()
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, habitId), inArray(habitLogs.date, dates)))
      .orderBy(desc(habitLogs.date));
  },

  async deleteAllForUser(userId: number): Promise<void> {
    const userHabits = await this.findByUser(userId);
    if (userHabits.length > 0) {
      const habitIds = userHabits.map(h => h.id);
      await db().delete(habitLogs).where(inArray(habitLogs.habitId, habitIds));
    }
    await db().delete(habits).where(eq(habits.userId, userId));
  },
};
