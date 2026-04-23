import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';
import { messagesRepo } from '../../db/repos/messages.js';
import { graphRag } from '../../graphrag/index.js';
import { validateVoiceName } from '../../voice/tts.js';
import { createChildLogger } from '../../lib/logger.js';
import { generateAuthUrl, isGoogleOAuthConfigured, isOAuthCallbackUrl, extractCodeFromInput, exchangeCode } from '../../oauth/google.js';

// Track users who have issued /reset and are awaiting confirmation
const pendingReset = new Set<number>();

const log = createChildLogger('commands');

export function registerCommands(botInstance: Bot<BotContext>): void {
  const HELP_TEXT = `Привет! Я Опекун — твой AI-наставник и помощник 💛

Вот что я умею:

/start — начать общение или перезапустить онбординг
/help — показать это сообщение

🧠 Память
/who — что я помню о тебе
/index_memory — обновить мою память (индексация переписки)
/reset — стереть всю память и начать с чистого листа

🎙 Голос
/voices — выбрать голос (интерактивный каталог)
/voice — мой текущий голос
/voice <имя> — сменить голос (например /voice Fenrir)

⏰ Расписание и напоминания
/pause — не писать первой (только отвечать)
/resume — снова писать первой
/reschedule — пересоздать все напоминания

📅 Google Calendar
/gcal — подключить Google Calendar
/gcal_reset — отключить Google Calendar

Просто пиши мне как другу — я запоминаю факты, напоминаю о делах, помогаю учиться и слежу за твоим прогрессом!`;

  botInstance.command('start', async (ctx) => {
    if (!ctx.dbUser) return;
    log.info({ userId: ctx.dbUser.id }, '/start command');

    if (ctx.dbUser.onboardingComplete) {
      await ctx.reply(HELP_TEXT);
      return;
    }

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
      await ctx.reply(HELP_TEXT);
    }
  });

  botInstance.command('help', async (ctx) => {
    if (!ctx.dbUser) return;
    await ctx.reply(HELP_TEXT);
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
    pendingReset.add(ctx.dbUser.id);
    setTimeout(() => pendingReset.delete(ctx.dbUser!.id), 60_000).unref();
    await ctx.reply('⚠️ Это удалит всю мою память о тебе. Уверен(а)?\n\nОтправь "да, сброс" для подтверждения. Запрос истекает через 60 секунд.');
  });

  botInstance.command('gcal', async (ctx) => {
    if (!ctx.dbUser) return;

    if (!isGoogleOAuthConfigured()) {
      await ctx.reply('❌ Google OAuth не настроен на сервере.');
      return;
    }

    if (ctx.dbUser.googleRefreshToken) {
      await ctx.reply('✅ Google Calendar уже подключён!\n\nОтправь /gcal_reset чтобы отключить.');
      return;
    }

    const authUrl = generateAuthUrl(ctx.chat.id);
    await ctx.reply(
      '📅 Подключение Google Calendar\n\n' +
      '1. Перейди по ссылке ниже и войди в Google\n' +
      '2. Разреши доступ к Calendar\n' +
      '3. Страница сама подтвердит подключение\n\n' +
      `🔗 ${authUrl}`,
    );
  });

  botInstance.command('gcal_reset', async (ctx) => {
    if (!ctx.dbUser) return;
    await usersRepo.update(ctx.dbUser.id, { googleRefreshToken: null });
    await ctx.reply('🗑 Google Calendar отключён. Используй /gcal чтобы подключить снова.');
  });

  // OAuth callback URL and reset confirmation (single handler to guarantee order)
  botInstance.on('message:text', async (ctx, next) => {
    if (!ctx.dbUser) return next();

    if (isOAuthCallbackUrl(ctx.message.text)) {
      try {
        const code = extractCodeFromInput(ctx.message.text);
        const refreshToken = await exchangeCode(code);
        await usersRepo.update(ctx.dbUser.id, { googleRefreshToken: refreshToken });
        log.info({ userId: ctx.dbUser.id }, 'Google Calendar connected');
        await ctx.reply('✅ Google Calendar подключён! Попробуй спросить: "что у меня сегодня в календаре?"');
      } catch (err) {
        log.error({ err }, 'OAuth exchange failed');
        const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
        await ctx.reply(`❌ Не удалось подключить Calendar: ${message}\n\nПопробуй /gcal снова.`);
      }
      return;
    }

    if (ctx.message.text.toLowerCase().trim() === 'да, сброс' && pendingReset.has(ctx.dbUser.id)) {
      pendingReset.delete(ctx.dbUser.id);
      await Promise.all([
        messagesRepo.deleteAllForUser(ctx.dbUser.id),
        graphRag.deleteAllForUser(ctx.dbUser.id),
      ]);
      await ctx.reply('🗑 Готово — я забыла всё что знала о тебе. Можем начать с чистого листа!');
      return;
    }

    return next();
  });

  botInstance.command('reschedule', async (ctx) => {
    if (!ctx.dbUser) return;
    if (!ctx.dbUser.onboardingComplete) {
      await ctx.reply('Сначала пройди онбординг — я ещё не знаю твоё расписание. Напиши /start');
      return;
    }

    log.info({ userId: ctx.dbUser.id }, '/reschedule command');

    // Re-run setup to recreate all repeating jobs (including new ones like edu-suggestion, weekly-digest)
    const { setupUserSchedules } = await import('../../scheduler/proactive.js');
    try {
      await setupUserSchedules(
        {
          id: ctx.dbUser.id,
          telegramUserId: ctx.from!.id,
          timezone: ctx.dbUser.timezone,
          wakeTime: ctx.dbUser.wakeTime ?? '08:00',
          sleepTime: ctx.dbUser.sleepTime ?? '23:00',
          weekendWakeTime: ctx.dbUser.weekendWakeTime,
          weekendSleepTime: ctx.dbUser.weekendSleepTime,
        },
        ctx.chat.id,
        {
          breakfastTime: ctx.dbUser.breakfastTime ?? '09:00',
          lunchTime: ctx.dbUser.lunchTime ?? '13:00',
          dinnerTime: ctx.dbUser.dinnerTime ?? '19:00',
        },
      );
      await ctx.reply('✅ Расписание обновлено! Все напоминания пересозданы с актуальными настройками.');
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, 'Failed to reschedule');
      await ctx.reply('❌ Не удалось обновить расписание. Попробуй позже или напиши разработчику.');
    }
  });

  botInstance.command('index_memory', async (ctx) => {
    if (!ctx.dbUser) return;
    await ctx.reply('🔍 Индексирую нашу переписку... Это может занять минуту.');
    try {
      await graphRag.indexUser(ctx.dbUser.id);
      await ctx.reply('✅ Готово! Память обновлена.');
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, 'Manual indexing failed');
      await ctx.reply('❌ Не удалось проиндексировать. Попробуй позже.');
    }
  });

  botInstance.command('who', async (ctx) => {
    if (!ctx.dbUser) return;

    const context = await graphRag.retrieve(ctx.dbUser.id, 'что я знаю о пользователе');
    if (!context || context.trim().length === 0) {
      await ctx.reply('Пока ещё мало знаю о тебе. Поговори со мной побольше или запусти /index_memory! 🤗');
      return;
    }

    await ctx.reply(`Вот что я помню о тебе:\n\n${context}`);
  });

  botInstance.command('voice', async (ctx) => {
    if (!ctx.dbUser) return;
    const args = ctx.message.text.split(' ').slice(1);

    // No args — show current voice
    if (args.length === 0) {
      const prefs = (ctx.dbUser.preferences ?? {}) as Record<string, unknown>;
      const current = typeof prefs.voice_name === 'string' ? prefs.voice_name : 'Leda (по умолчанию)';
      await ctx.reply(`🎙 Мой текущий голос: ${current}\n\nЧтобы сменить: /voice <имя>\nСписок всех голосов: /voices`);
      return;
    }

    // Set new voice
    const requested = args[0];
    const valid = validateVoiceName(requested);
    if (valid.toLowerCase() !== requested.toLowerCase()) {
      await ctx.reply(`❌ Голос "${requested}" не найден. Посмотри список: /voices`);
      return;
    }

    await usersRepo.update(ctx.dbUser.id, {
      preferences: { ...(ctx.dbUser.preferences as Record<string, unknown> ?? {}), voice_name: valid },
    });
    await ctx.reply(`✅ Голос изменён на ${valid}!`);
  });
}
