import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { runOrchestrator } from '../../agent/orchestrator.js';
import { createChildLogger } from '../../lib/logger.js';
import { handleError } from '../../lib/errors.js';
import { config } from '../../config.js';

const log = createChildLogger('handler:message');

export function registerMessageHandler(botInstance: Bot<BotContext>): void {
  // Handle text messages
  botInstance.on('message:text', async (ctx) => {
    if (!ctx.dbUser) return;
    if (ctx.message.text.startsWith('/')) return;

    log.debug({ userId: ctx.dbUser.id, text: ctx.message.text.slice(0, 50) }, 'Incoming text message');
    await ctx.replyWithChatAction('typing');

    try {
      await runOrchestrator({
        userId: ctx.dbUser.id,
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser.name,
        userTimezone: ctx.dbUser.timezone,
        wakeTime: ctx.dbUser.wakeTime ?? undefined,
        sleepTime: ctx.dbUser.sleepTime ?? undefined,
        preferences: (ctx.dbUser.preferences as Record<string, unknown>) ?? {},
        onboardingComplete: ctx.dbUser.onboardingComplete,
        mode: 'reactive',
        userMessage: ctx.message.text,
      });
    } catch (err) {
      handleError(err, 'text message handler');
      await ctx.reply('Ой, у меня сейчас мысли путаются 🥲 Попробуй через минуту.');
    }
  });

  // Handle photo messages
  botInstance.on('message:photo', async (ctx) => {
    if (!ctx.dbUser) return;

    log.debug({ userId: ctx.dbUser.id }, 'Incoming photo message');
    await ctx.replyWithChatAction('typing');

    try {
      // Get the highest resolution photo
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      if (!file.file_path) throw new Error('Telegram did not return file_path for photo');
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Failed to download photo: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      await runOrchestrator({
        userId: ctx.dbUser.id,
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser.name,
        userTimezone: ctx.dbUser.timezone,
        wakeTime: ctx.dbUser.wakeTime ?? undefined,
        sleepTime: ctx.dbUser.sleepTime ?? undefined,
        preferences: (ctx.dbUser.preferences as Record<string, unknown>) ?? {},
        onboardingComplete: ctx.dbUser.onboardingComplete,
        mode: 'reactive',
        userMessage: ctx.message.caption || 'Что на этом фото?',
        images: [{ data: base64, mimeType: 'image/jpeg' }],
      });
    } catch (err) {
      handleError(err, 'photo message handler');
      await ctx.reply('Не смогла рассмотреть фото 🙈 Попробуй еще раз или пришли текстом.');
    }
  });
}
