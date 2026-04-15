import type { NextFunction } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';

export async function contextMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) return;

  let user = await usersRepo.findByTelegramId(ctx.from.id);
  if (!user) {
    user = await usersRepo.upsert({
      telegramUserId: ctx.from.id,
      name: ctx.from.first_name ?? 'User',
    });
  }
  ctx.dbUser = user;
  await next();
}
