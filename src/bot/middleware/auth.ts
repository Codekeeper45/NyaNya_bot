import type { NextFunction } from 'grammy';
import type { BotContext } from '../bot.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('auth');

export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !config.allowedUserIds.includes(userId)) {
    log.warn({ userId }, 'Unauthorized access attempt');
    if (ctx.message) {
      await ctx.reply('Извини, я личный бот. Доступ закрыт.');
    } else if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery('Доступ закрыт.');
    }
    return;
  }
  await next();
}
