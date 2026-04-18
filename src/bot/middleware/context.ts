import type { NextFunction } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('middleware:context');

export async function contextMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) return;

  try {
    let user = await usersRepo.findByTelegramId(ctx.from.id);
    if (!user) {
      user = await usersRepo.upsert({
        telegramUserId: ctx.from.id,
        name: ctx.from.first_name ?? 'User',
      });
    }
    ctx.dbUser = user;
  } catch (err) {
    log.error({ err, telegramId: ctx.from.id }, 'Failed to load user from DB');
    try {
      if (ctx.message) {
        await ctx.reply('Сейчас не могу подключиться к базе данных. Попробуй еще раз через минуту.');
      } else if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery('Временная ошибка подключения к базе данных.');
      }
    } catch {
      // If Telegram API call also fails, just stop processing this update.
    }
    return;
  }

  await next();
}
