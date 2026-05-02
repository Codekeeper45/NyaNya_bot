import { tool } from 'ai';
import { z } from 'zod';
import { expensesRepo } from '../../db/repos/expenses.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:expenses');

const CATEGORIES = ['еда', 'кафе/рестораны', 'транспорт', 'здоровье', 'одежда', 'дом', 'развлечения', 'образование', 'связь', 'прочее'] as const;

export function expenseTools(userId: number, userTimezone: string) {
  function todayStr(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: userTimezone });
  }

  function periodBounds(period: 'today' | 'week' | 'month'): { from: string; to: string } {
    const now = new Date();
    const to = now.toLocaleDateString('sv-SE', { timeZone: userTimezone });
    if (period === 'today') return { from: to, to };
    if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { from: d.toLocaleDateString('sv-SE', { timeZone: userTimezone }), to };
    }
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: d.toLocaleDateString('sv-SE', { timeZone: userTimezone }), to };
  }

  return {
    expense_add: tool({
      description: 'Записать расход. WHEN: автоматически при сигналах траты (см. "Молчаливые действия"). CHAIN: вызывай молча внутри цикла → message_send_text(с подтверждением в конце). RETURNS: { added: true, id, amount, category, date }.',
      inputSchema: z.object({
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Формат: "1500" или "1500.50"').describe('Сумма (например "1500" или "1500.50")'),
        category: z.enum(CATEGORIES).describe('Категория расхода'),
        note: z.string().optional().describe('Примечание (что именно куплено)'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Дата YYYY-MM-DD (по умолчанию сегодня)'),
        currency: z.string().optional().default('KZT').describe('Валюта (KZT, RUB, USD и т.д.)'),
      }),
      execute: async ({ amount, category, note, date, currency }) => {
        const expense = await expensesRepo.add({
          userId,
          amount,
          currency,
          category,
          note,
          date: date ?? todayStr(),
        });
        log.info({ userId, amount, category }, 'Expense added');
        return { added: true, id: expense.id, amount, category, date: expense.date };
      },
    }),

    expense_list: tool({
      description: 'Показать расходы за период. WHEN: пользователь спрашивает "сколько потратил", "мои траты". CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { period, from, to, count, totals: [{ currency, total }], items }.',
      inputSchema: z.object({
        period: z.enum(['today', 'week', 'month']).default('today').describe('Период: today/week/month'),
      }),
      execute: async ({ period }) => {
        const { from, to } = periodBounds(period);
        const rows = await expensesRepo.getByPeriod(userId, from, to);
        const byCurrency = rows.reduce((acc, r) => {
          const cur = r.currency ?? 'KZT';
          acc[cur] = (acc[cur] ?? 0) + parseFloat(r.amount);
          return acc;
        }, {} as Record<string, number>);
        const totals = Object.entries(byCurrency).map(([currency, total]) => ({ currency, total: total.toFixed(2) }));
        return {
          period,
          from,
          to,
          count: rows.length,
          totals,
          items: rows.map(r => ({
            id: r.id,
            date: r.date,
            amount: r.amount,
            currency: r.currency,
            category: r.category,
            note: r.note,
          })),
        };
      },
    }),

    expense_stats: tool({
      description: 'Сводка расходов по категориям. WHEN: анализ бюджета, вечерняя рефлексия. CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { period, from, to, total, byCategory: [{ category, total, percent }] }.',
      inputSchema: z.object({
        period: z.enum(['today', 'week', 'month']).default('month').describe('Период: today/week/month'),
      }),
      execute: async ({ period }) => {
        const { from, to } = periodBounds(period);
        const stats = await expensesRepo.getStatsByCategory(userId, from, to);
        const total = stats.reduce((s, r) => s + r.total, 0);
        const sorted = stats.sort((a, b) => b.total - a.total);
        return {
          period,
          from,
          to,
          total: total.toFixed(2),
          byCategory: sorted.map(r => ({
            category: r.category ?? 'прочее',
            total: r.total.toFixed(2),
            percent: total > 0 ? Math.round((r.total / total) * 100) : 0,
          })),
        };
      },
    }),
  };
}
