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
    return; // drop update silently rather than crash
  }

  await next();
}
