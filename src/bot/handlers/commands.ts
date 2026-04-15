import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';
import { mem0 } from '../../memory/mem0.js';
import { setupUserSchedules } from '../../scheduler/proactive.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('commands');

export function registerCommands(botInstance: Bot<BotContext>): void {
  botInstance.command('start', async (ctx) => {
    if (!ctx.dbUser) return;
    log.info({ userId: ctx.dbUser.id }, '/start command');

    // Set up proactive schedules
    try {
      await setupUserSchedules(
        {
          id: ctx.dbUser.id,
          telegramUserId: ctx.from!.id,
          timezone: ctx.dbUser.timezone,
          wakeTime: ctx.dbUser.wakeTime ?? '08:00',
          sleepTime: ctx.dbUser.sleepTime ?? '23:00',
        },
        ctx.chat.id,
      );
    } catch (err) {
      log.error({ err }, 'Failed to setup schedules on /start');
    }

    await ctx.reply(
      'Привет! Я Опекун — буду заботиться о тебе как заботливая мама и помогать учиться. 💛\n\n' +
      'Давай познакомимся! Расскажи о себе — как тебя зовут, чем занимаешься, что хочешь улучшить?\n\n' +
      'Команды:\n' +
      '/pause — поставить на паузу проактивные сообщения\n' +
      '/resume — возобновить\n' +
      '/who — что я о тебе помню\n' +
      '/reset — забыть всё',
    );
  });

  botInstance.command('pause', async (ctx) => {
    if (!ctx.dbUser) return;
    await usersRepo.update(ctx.dbUser.id, { paused: true });
    await ctx.reply('Окей, не буду писать первой. Скажи /resume когда захочешь вернуть. 🤫');
  });

  botInstance.command('resume', async (ctx) => {
    if (!ctx.dbUser) return;
    await usersRepo.update(ctx.dbUser.id, { paused: false });
    await ctx.reply('Отлично, я снова на связи! 💛');
  });

  botInstance.command('reset', async (ctx) => {
    if (!ctx.dbUser) return;
    await ctx.reply('⚠️ Это удалит всю мою память о тебе. Уверен(а)?\n\nОтправь "да, сброс" для подтверждения.');
  });

  botInstance.command('who', async (ctx) => {
    if (!ctx.dbUser) return;
    const uid = String(ctx.from!.id);

    const memories = await mem0.getAll(uid);
    if (memories.length === 0) {
      await ctx.reply('Пока ещё мало знаю о тебе. Поговори со мной побольше! 🤗');
      return;
    }

    const top = memories.slice(0, 20);
    const lines = top.map((m: { memory?: string }, i: number) => `${i + 1}. ${m.memory ?? '?'}`);
    await ctx.reply(`Вот что я помню о тебе:\n\n${lines.join('\n')}`);
  });
}
