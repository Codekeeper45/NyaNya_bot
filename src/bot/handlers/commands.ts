import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';
import { mem0 } from '../../memory/mem0.js';
import { createChildLogger } from '../../lib/logger.js';
import { generateAuthUrl, isGoogleOAuthConfigured, isOAuthCallbackUrl, extractCodeFromInput, exchangeCode } from '../../oauth/google.js';
import { mcpManager } from '../../mcp/client.js';

const log = createChildLogger('commands');

export function registerCommands(botInstance: Bot<BotContext>): void {
  botInstance.command('start', async (ctx) => {
    if (!ctx.dbUser) return;
    log.info({ userId: ctx.dbUser.id }, '/start command');

    // Launch onboarding via orchestrator
    try {
      const { runOrchestrator } = await import('../../agent/orchestrator.js');
      await runOrchestrator({
        userId: ctx.dbUser.id,
        telegramUserId: ctx.from!.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser.name,
        userTimezone: ctx.dbUser.timezone,
        wakeTime: ctx.dbUser.wakeTime ?? undefined,
        sleepTime: ctx.dbUser.sleepTime ?? undefined,
        preferences: (ctx.dbUser.preferences as Record<string, unknown>) ?? {},
        onboardingComplete: ctx.dbUser.onboardingComplete,
        mode: 'proactive',
        proactiveKind: 'onboarding',
        proactiveContext: 'Первый запуск — познакомься с пользователем',
      });
    } catch (err) {
      log.error({ err }, 'Failed to launch onboarding');
      await ctx.reply('Привет! Я Опекун 💛 Похоже, у меня небольшие технические шоколадки, но мы всё равно можем пообщаться!');
    }
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

  botInstance.command('gcal', async (ctx) => {
    if (!ctx.dbUser) return;

    if (!isGoogleOAuthConfigured()) {
      await ctx.reply('❌ Google OAuth не настроен на сервере.');
      return;
    }

    if (ctx.dbUser.googleRefreshToken) {
      await ctx.reply('✅ Google Calendar уже подключён!\n\nОтправь /gcal\\_reset чтобы отключить.', { parse_mode: 'Markdown' });
      return;
    }

    const authUrl = generateAuthUrl();
    await ctx.reply(
      '📅 Подключение Google Calendar\n\n' +
      '1. Перейди по ссылке ниже и войди в Google\n' +
      '2. Разреши доступ к Calendar\n' +
      '3. Браузер покажет ошибку "сайт недоступен" — это нормально\n' +
      '4. Скопируй полную ссылку из адресной строки браузера\n' +
      '5. Вставь её сюда в чат\n\n' +
      `🔗 ${authUrl}`,
    );
  });

  botInstance.command('gcal_reset', async (ctx) => {
    if (!ctx.dbUser) return;
    await usersRepo.update(ctx.dbUser.id, { googleRefreshToken: null });
    await mcpManager.connect('google-calendar');
    await ctx.reply('🗑 Google Calendar отключён. Используй /gcal чтобы подключить снова.');
  });

  // OAuth callback URL handler (inline in text messages)
  botInstance.on('message:text', async (ctx, next) => {
    if (!ctx.dbUser) return next();
    if (!isOAuthCallbackUrl(ctx.message.text)) return next();

    try {
      const code = extractCodeFromInput(ctx.message.text);
      const refreshToken = await exchangeCode(code);
      await usersRepo.update(ctx.dbUser.id, { googleRefreshToken: refreshToken });
      await mcpManager.connect('google-calendar');
      log.info({ userId: ctx.dbUser.id }, 'Google Calendar connected');
      await ctx.reply('✅ Google Calendar подключён! Попробуй спросить: "что у меня сегодня в календаре?"');
    } catch (err) {
      log.error({ err }, 'OAuth exchange failed');
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      await ctx.reply(`❌ Не удалось подключить Calendar: ${message}\n\nПопробуй /gcal снова.`);
    }
  });

  // Reset confirmation handler
  botInstance.on('message:text', async (ctx, next) => {
    if (!ctx.dbUser) return next();
    if (ctx.message.text.toLowerCase().trim() !== 'да, сброс') return next();

    const uid = String(ctx.from!.id);
    await mem0.deleteAll(uid);
    await ctx.reply('🗑 Готово — я забыла всё что знала о тебе. Можем начать с чистого листа!');
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
