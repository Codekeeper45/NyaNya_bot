import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';
import { messagesRepo } from '../../db/repos/messages.js';
import { graphIndexStateRepo } from '../../db/repos/graph_index_state.js';
import { graphRag } from '../../graphrag/index.js';
import { VOICE_PROFILES, validateVoiceName, type VoiceGender } from '../../voice/tts.js';
import { createChildLogger } from '../../lib/logger.js';
import { generateAuthUrl, isGoogleOAuthConfigured, isOAuthCallbackUrl, extractCodeFromInput, exchangeCode } from '../../oauth/google.js';

const log = createChildLogger('commands');

const pendingActions = new Set<number>();
const lastInlineMessages = new Map<number, number>();

function isPending(userId: number): boolean {
  return pendingActions.has(userId);
}
function markPending(userId: number): void {
  pendingActions.add(userId);
  setTimeout(() => pendingActions.delete(userId), 30_000).unref();
}
function clearPending(userId: number): void {
  pendingActions.delete(userId);
}

async function sendMenu(ctx: BotContext, text: string, kb: InlineKeyboard): Promise<void> {
  const userId = ctx.dbUser?.id;
  if (userId) {
    const oldMsgId = lastInlineMessages.get(userId);
    if (oldMsgId) {
      try {
        await ctx.api.editMessageReplyMarkup(ctx.chat!.id, oldMsgId, { reply_markup: undefined });
      } catch {
        // ignore if message is too old or already cleared
      }
    }
  }
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  if (userId && msg.message_id) {
    lastInlineMessages.set(userId, msg.message_id);
  }
}

export function registerCommands(botInstance: Bot<BotContext>): void {
  const HELP_TEXT = `Привет! Я Опекун — твой AI-наставник и помощник 💛

Вот что я умею:

/start — начать общение или перезапустить онбординг
/help — показать это сообщение

🧠 Память
/who — что я помню о тебе
/index_memory — обновить мою память (индексация переписки)
/reset — стереть мою память о тебе (переписка и факты)

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

  // ── /reset — show inline confirmation ──
  botInstance.command('reset', async (ctx) => {
    if (!ctx.dbUser) return;
    const kb = new InlineKeyboard()
      .text('🗑 Да, стереть всё', 'cmd:reset_confirm')
      .row()
      .text('❌ Отмена', 'cmd:reset_cancel');
    await sendMenu(
      ctx,
      '⚠️ *Это необратимо*\n\nБудет удалена вся переписка и факты, которые я запомнила. Привычки, задачи и расписание останутся.\n\nТы уверен?',
      kb,
    );
  });

  // ── /reschedule — show inline confirmation ──
  botInstance.command('reschedule', async (ctx) => {
    if (!ctx.dbUser) return;
    if (!ctx.dbUser.onboardingComplete) {
      await ctx.reply('Сначала пройди онбординг — я ещё не знаю твоё расписание. Напиши /start');
      return;
    }

    const kb = new InlineKeyboard()
      .text('✅ Да, пересоздать', 'cmd:reschedule_confirm')
      .row()
      .text('❌ Отмена', 'cmd:reschedule_cancel');
    await sendMenu(
      ctx,
      '⏰ *Пересоздание расписания*\n\nВсе текущие напоминания будут удалены и созданы заново с актуальными настройками.\n\nПродолжить?',
      kb,
    );
  });

  // ── /gcal — connect Google Calendar ──
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

  // ── /gcal_reset — show inline confirmation ──
  botInstance.command('gcal_reset', async (ctx) => {
    if (!ctx.dbUser) return;

    if (!ctx.dbUser.googleRefreshToken) {
      await ctx.reply('Google Calendar и так не подключён. Используй /gcal чтобы подключить.');
      return;
    }

    const kb = new InlineKeyboard()
      .text('🗑 Да, отключить', 'cmd:gcal_reset_confirm')
      .row()
      .text('❌ Отмена', 'cmd:gcal_reset_cancel');
    await sendMenu(
      ctx,
      '📅 *Отключение Google Calendar*\n\nЯ перестану видеть твои события и напоминания из календаря.\n\nОтключить?',
      kb,
    );
  });

  // ── OAuth callback handler ──
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

    return next();
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
    log.info({ userId: ctx.dbUser.id }, '/who command');

    try {
      const context = await graphRag.retrieveAll(ctx.dbUser.id);
      log.info({ userId: ctx.dbUser.id, hasContext: !!context, contextLength: context?.length ?? 0, entityCount: context?.split('\n').filter(l => l.startsWith('—')).length ?? 0 }, '/who retrieveAll result');
      if (!context || context.trim().length === 0) {
        await ctx.reply('Пока ещё мало знаю о тебе. Поговори со мной побольше или запусти /index_memory! 🤗');
        return;
      }
      await ctx.reply(`Вот что я помню о тебе:\n\n${context}`);
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, '/who retrieveAll failed');
      await ctx.reply('Не удалось загрузить память. Попробуй позже.');
    }
  });

  botInstance.command('voice', async (ctx) => {
    if (!ctx.dbUser) return;
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      const prefs = (ctx.dbUser.preferences ?? {}) as Record<string, unknown>;
      const current = typeof prefs.voice_name === 'string' ? prefs.voice_name : 'Leda (по умолчанию)';
      await ctx.reply(`🎙 Мой текущий голос: ${current}\n\nЧтобы сменить: /voice <имя>\nСписок всех голосов: /voices`);
      return;
    }

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

  // ── /voices — inline voice browser ──
  const VB_PREFIX = 'vb';
  function vb(action: string, ...params: string[]): string {
    return [VB_PREFIX, action, ...params].join(':');
  }
  const MALE_VOICES = VOICE_PROFILES.filter(v => v.gender === 'male');
  const FEMALE_VOICES = VOICE_PROFILES.filter(v => v.gender === 'female');

  function vbCategoryKb(): InlineKeyboard {
    return new InlineKeyboard()
      .text('👩 Женские голоса', vb('cat', 'female'))
      .text('👨 Мужские голоса', vb('cat', 'male'));
  }

  function vbListKb(gender: VoiceGender): InlineKeyboard {
    const voices = gender === 'female' ? FEMALE_VOICES : MALE_VOICES;
    const rows: InlineKeyboard[][] = [];
    for (let i = 0; i < voices.length; i += 2) {
      const row: InlineKeyboard[] = [InlineKeyboard.text(`${voices[i].emoji} ${voices[i].name}`, vb('v', voices[i].name))];
      if (i + 1 < voices.length) row.push(InlineKeyboard.text(`${voices[i + 1].emoji} ${voices[i + 1].name}`, vb('v', voices[i + 1].name)));
      rows.push(row);
    }
    rows.push([InlineKeyboard.text('🔙 Назад', vb('back'))]);
    return InlineKeyboard.from(rows);
  }

  function vbCardKb(voiceName: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('✅ Применить', vb('apply', voiceName))
      .row()
      .text('🔙 Назад', vb('back'));
  }

  botInstance.command('voices', async (ctx) => {
    log.info({ userId: ctx.dbUser?.id, hasDbUser: !!ctx.dbUser }, '/voices command received');
    if (!ctx.dbUser) return;
    const prefs = (ctx.dbUser.preferences ?? {}) as Record<string, unknown>;
    const current = typeof prefs.voice_name === 'string' ? prefs.voice_name : 'Leda';
    try {
      await sendMenu(
        ctx,
        `🎙 Выбор голоса\n\nТекущий голос: *${current}*\n\nВыбери категорию:`,
        vbCategoryKb(),
      );
      log.info({ userId: ctx.dbUser.id }, '/voices reply sent');
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, 'Failed to send /voices reply');
      await ctx.reply('Не удалось показать каталог голосов. Попробуй позже.');
    }
  });

  botInstance.callbackQuery(new RegExp(`^${VB_PREFIX}:`), async (ctx) => {
    if (!ctx.dbUser) return;
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    if (parts.length < 2) { await ctx.answerCallbackQuery(); return; }
    const action = parts[1]!;
    const params = parts.slice(2);

    try {
      switch (action) {
        case 'cat': {
          const gender = params[0] as VoiceGender;
          const label = gender === 'female' ? '👩 Женские голоса' : '👨 Мужские голоса';
          await ctx.editMessageText(`🎙 ${label}\n\nНажми на голос чтобы узнать подробнее:`, { reply_markup: vbListKb(gender) });
          break;
        }
        case 'v': {
          const voiceName = params[0];
          const profile = VOICE_PROFILES.find(v => v.name === voiceName);
          if (!profile) { await ctx.answerCallbackQuery({ text: 'Голос не найден' }); return; }
          const genderLabel = profile.gender === 'female' ? '👩 Женский' : '👨 Мужской';
          const card = [`${profile.emoji} *${profile.name}*`, genderLabel, `🎵 Тон: ${profile.tone}`, `🔊 Высота: ${profile.pitch}`, `💬 ${profile.personality}`].join('\n');
          await ctx.editMessageText(card, { parse_mode: 'Markdown', reply_markup: vbCardKb(profile.name) });
          break;
        }
        case 'apply': {
          const voiceName = params[0];
          const valid = validateVoiceName(voiceName);
          if (valid.toLowerCase() !== voiceName.toLowerCase()) { await ctx.answerCallbackQuery({ text: 'Голос не найден' }); return; }
          await usersRepo.update(ctx.dbUser.id, { preferences: { ...((ctx.dbUser.preferences as Record<string, unknown>) ?? {}), voice_name: valid } });
          const profile = VOICE_PROFILES.find(v => v.name === valid);
          await ctx.editMessageText(`✅ Голос установлен: ${profile?.emoji ?? ''} *${valid}*\n\n${profile?.personality ?? ''}`, { parse_mode: 'Markdown' });
          log.info({ userId: ctx.dbUser.id, voice: valid }, 'Voice changed via inline keyboard');
          break;
        }
        case 'back': {
          const user = await usersRepo.findById(ctx.dbUser.id);
          const prefs = (user?.preferences ?? {}) as Record<string, unknown>;
          const current = typeof prefs.voice_name === 'string' ? prefs.voice_name : 'Leda';
          try {
            await ctx.editMessageText(`🎙 Выбор голоса\n\nТекущий голос: *${current}*\n\nВыбери категорию:`, { parse_mode: 'Markdown', reply_markup: vbCategoryKb() });
          } catch { await ctx.reply(`🎙 Выбор голоса\n\nТекущий голос: *${current}*\n\nВыбери категорию:`, { parse_mode: 'Markdown', reply_markup: vbCategoryKb() }); }
          break;
        }
      }
    } catch (err) { log.error({ err, action, params }, 'Voice browser callback error'); }
    await ctx.answerCallbackQuery();
  });

  // ── Inline confirmation callbacks ──

  botInstance.callbackQuery('cmd:reset_confirm', async (ctx) => {
    if (!ctx.dbUser) return;
    if (isPending(ctx.dbUser.id)) {
      await ctx.answerCallbackQuery({ text: 'Уже обрабатываю...' });
      return;
    }
    markPending(ctx.dbUser.id);

    await ctx.editMessageText('🗑 Стираю память...');
    try {
      await Promise.all([
        messagesRepo.deleteAllForUser(ctx.dbUser.id),
        graphRag.deleteAllForUser(ctx.dbUser.id),
        graphIndexStateRepo.deleteForUser(ctx.dbUser.id),
      ]);

      await usersRepo.update(ctx.dbUser.id, { preferences: {} });

      await ctx.editMessageText('✅ Готово — я забыла всё что знала о тебе. Можем начать с чистого листа!');
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, 'Reset failed');
      await ctx.editMessageText('❌ Не удалось стереть память. Попробуй позже.');
    } finally {
      clearPending(ctx.dbUser.id);
    }
    await ctx.answerCallbackQuery();
  });

  botInstance.callbackQuery('cmd:reset_cancel', async (ctx) => {
    await ctx.editMessageText('👌 Отмена. Ничего не удалено.');
    await ctx.answerCallbackQuery();
  });

  botInstance.callbackQuery('cmd:reschedule_confirm', async (ctx) => {
    if (!ctx.dbUser) return;
    await ctx.editMessageText('⏳ Пересоздаю расписание...');
    log.info({ userId: ctx.dbUser.id }, '/reschedule confirmed via inline');

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
        ctx.callbackQuery.message!.chat.id,
        {
          breakfastTime: ctx.dbUser.breakfastTime ?? '09:00',
          lunchTime: ctx.dbUser.lunchTime ?? '13:00',
          dinnerTime: ctx.dbUser.dinnerTime ?? '19:00',
        },
      );
      await ctx.editMessageText('✅ Расписание обновлено! Все напоминания пересозданы с актуальными настройками.');
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, 'Reschedule failed');
      await ctx.editMessageText('❌ Не удалось обновить расписание. Попробуй позже.');
    }
    await ctx.answerCallbackQuery();
  });

  botInstance.callbackQuery('cmd:reschedule_cancel', async (ctx) => {
    await ctx.editMessageText('👌 Отмена. Расписание не изменено.');
    await ctx.answerCallbackQuery();
  });

  botInstance.callbackQuery('cmd:gcal_reset_confirm', async (ctx) => {
    if (!ctx.dbUser) return;
    try {
      await usersRepo.update(ctx.dbUser.id, { googleRefreshToken: null });
      await ctx.editMessageText('✅ Google Calendar отключён. Используй /gcal чтобы подключить снова.');
    } catch (err) {
      log.error({ err, userId: ctx.dbUser.id }, 'gcal_reset failed');
      await ctx.editMessageText('❌ Не удалось отключить Calendar. Попробуй позже.');
    }
    await ctx.answerCallbackQuery();
  });

  botInstance.callbackQuery('cmd:gcal_reset_cancel', async (ctx) => {
    await ctx.editMessageText('👌 Отмена. Calendar остаётся подключён.');
    await ctx.answerCallbackQuery();
  });
}