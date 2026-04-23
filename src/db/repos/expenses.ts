import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { expenses, type Expense } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const expensesRepo = {
  async add(data: {
    userId: number;
    amount: string;
    currency: string;
    category?: string;
    note?: string;
    date: string;
  }): Promise<Expense> {
    const [row] = await db().insert(expenses).values(data).returning();
    return row;
  },

  async getByPeriod(userId: number, from: string, to: string): Promise<Expense[]> {
    return db()
      .select()
      .from(expenses)
      .where(and(
        eq(expenses.userId, userId),
        gte(expenses.date, from),
        lte(expenses.date, to),
      ))
      .orderBy(expenses.date);
  },

  async getStatsByCategory(userId: number, from: string, to: string): Promise<{ category: string | null; total: number }[]> {
    const rows = await db()
      .select({
        category: expenses.category,
        total: sql<number>`sum(cast(${expenses.amount} as numeric))`,
      })
      .from(expenses)
      .where(and(
        eq(expenses.userId, userId),
        gte(expenses.date, from),
        lte(expenses.date, to),
      ))
      .groupBy(expenses.category);
    return rows;
  },

};
