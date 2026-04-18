import type { NextFunction } from 'grammy';
import type { BotContext } from '../bot.js';

const userMessages = new Map<number, number[]>();
const MAX_MESSAGES = 20;
const WINDOW_MS = 60_000;

// Purge stale entries every 10 minutes to prevent unbounded growth
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [uid, timestamps] of userMessages) {
    if (timestamps[timestamps.length - 1] < cutoff) userMessages.delete(uid);
  }
}, 10 * 60_000).unref();

export async function rateLimitMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const now = Date.now();
  const timestamps = (userMessages.get(userId) ?? []).filter(t => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_MESSAGES) {
    await ctx.reply('Слишком много сообщений, подожди минутку.');
    return;
  }

  timestamps.push(now);
  userMessages.set(userId, timestamps);
  await next();
}
