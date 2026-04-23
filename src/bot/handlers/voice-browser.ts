import type { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { usersRepo } from '../../db/repos/users.js';
import { VOICE_PROFILES, validateVoiceName, type VoiceGender } from '../../voice/tts.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('voice-browser');

const CALLBACK_PREFIX = 'vb';

function cb(action: string, ...params: string[]): string {
  return [CALLBACK_PREFIX, action, ...params].join(':');
}

function parseCb(data: string): { action: string; params: string[] } | null {
  if (!data.startsWith(CALLBACK_PREFIX + ':')) return null;
  const parts = data.split(':');
  return { action: parts[1], params: parts.slice(2) };
}

const MALE_VOICES = VOICE_PROFILES.filter(v => v.gender === 'male');
const FEMALE_VOICES = VOICE_PROFILES.filter(v => v.gender === 'female');

function categoryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('👩 Женские голоса', cb('cat', 'female'))
    .text('👨 Мужские голоса', cb('cat', 'male'));
}

function voiceListKeyboard(gender: VoiceGender): InlineKeyboard {
  const voices = gender === 'female' ? FEMALE_VOICES : MALE_VOICES;
  const rows: InlineKeyboard[][] = [];

  for (let i = 0; i < voices.length; i += 2) {
    const row: InlineKeyboard[] = [
      InlineKeyboard.text(`${voices[i].emoji} ${voices[i].name}`, cb('v', voices[i].name)),
    ];
    if (i + 1 < voices.length) {
      row.push(InlineKeyboard.text(`${voices[i + 1].emoji} ${voices[i + 1].name}`, cb('v', voices[i + 1].name)));
    }
    rows.push(row);
  }

  rows.push([InlineKeyboard.text('🔙 Назад', cb('back'))]);
  return InlineKeyboard.from(rows);
}

function voiceCardKeyboard(voiceName: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Применить', cb('apply', voiceName))
    .row()
    .text('🔙 Назад', cb('back'));
}

export function registerVoiceBrowser(botInstance: Bot<BotContext>): void {
  botInstance.command('voices', async (ctx) => {
    if (!ctx.dbUser) return;
    const prefs = (ctx.dbUser.preferences ?? {}) as Record<string, unknown>;
    const current = typeof prefs.voice_name === 'string' ? prefs.voice_name : 'Leda';

    await ctx.reply(
      `🎙 Выбор голоса\n\nТекущий голос: *${current}*\n\nВыбери категорию:`,
      { parse_mode: 'Markdown', reply_markup: categoryKeyboard() },
    );
  });

  botInstance.callbackQuery(new RegExp(`^${CALLBACK_PREFIX}:`), async (ctx) => {
    if (!ctx.dbUser) return;

    const data = ctx.callbackQuery.data;
    const parsed = parseCb(data);
    if (!parsed) {
      await ctx.answerCallbackQuery();
      return;
    }

    const { action, params } = parsed;

    try {
      switch (action) {
        case 'cat': {
          const gender = params[0] as VoiceGender;
          const label = gender === 'female' ? '👩 Женские голоса' : '👨 Мужские голоса';
          await ctx.editMessageText(
            `🎙 ${label}\n\nНажми на голос чтобы узнать подробнее:`,
            { reply_markup: voiceListKeyboard(gender) },
          );
          break;
        }

        case 'v': {
          const voiceName = params[0];
          const profile = VOICE_PROFILES.find(v => v.name === voiceName);
          if (!profile) {
            await ctx.answerCallbackQuery({ text: 'Голос не найден' });
            return;
          }

          const genderLabel = profile.gender === 'female' ? '👩 Женский' : '👨 Мужской';
          const card = [
            `${profile.emoji} *${profile.name}*`,
            `${genderLabel}`,
            `🎵 Тон: ${profile.tone}`,
            `🔊 Высота: ${profile.pitch}`,
            `💬 ${profile.personality}`,
          ].join('\n');

          await ctx.editMessageText(card, {
            parse_mode: 'Markdown',
            reply_markup: voiceCardKeyboard(profile.name),
          });
          break;
        }

        case 'apply': {
          const voiceName = params[0];
          const valid = validateVoiceName(voiceName);
          if (valid.toLowerCase() !== voiceName.toLowerCase()) {
            await ctx.answerCallbackQuery({ text: 'Голос не найден' });
            return;
          }

          await usersRepo.update(ctx.dbUser.id, {
            preferences: { ...((ctx.dbUser.preferences as Record<string, unknown>) ?? {}), voice_name: valid },
          });

          const profile = VOICE_PROFILES.find(v => v.name === valid);
          await ctx.editMessageText(
            `✅ Голос установлен: ${profile?.emoji ?? ''} *${valid}*\n\n${profile?.personality ?? ''}`,
            { parse_mode: 'Markdown' },
          );

          log.info({ userId: ctx.dbUser.id, voice: valid }, 'Voice changed via inline keyboard');
          break;
        }

        case 'back': {
          const prefs = (ctx.dbUser.preferences ?? {}) as Record<string, unknown>;
          const current = typeof prefs.voice_name === 'string' ? prefs.voice_name : 'Leda';
          try {
            await ctx.editMessageText(
              `🎙 Выбор голоса\n\nТекущий голос: *${current}*\n\nВыбери категорию:`,
              { parse_mode: 'Markdown', reply_markup: categoryKeyboard() },
            );
          } catch {
            await ctx.reply(
              `🎙 Выбор голоса\n\nТекущий голос: *${current}*\n\nВыбери категорию:`,
              { parse_mode: 'Markdown', reply_markup: categoryKeyboard() },
            );
          }
          break;
        }
      }
    } catch (err) {
      log.error({ err, action, params }, 'Voice browser callback error');
    }

    await ctx.answerCallbackQuery();
  });
}