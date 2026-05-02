import { tool } from 'ai';
import { z } from 'zod';
import { callUser, isTwilioConfigured } from '../../call/initiate.js';
import { usersRepo } from '../../db/repos/users.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:call');

export function callTools(userId: number, telegramChatId: number, userName: string, timezone: string) {
  return {
    call_user: tool({
      description: 'Позвонить пользователю. WHEN: ТОЛЬКО эскалация — пользователь долго не отвечает на важные сообщения. CHAIN: message_send_text (предупреждение) → этот инструмент. RETURNS: { success: true, callSid, message } или { success: false, error }. NEVER: не используй, если пользователь назвал чужой номер.',
      inputSchema: z.object({
        reason: z.string().describe('Причина звонка — что скажешь в начале разговора.'),
      }),
      execute: async ({ reason }) => {
        if (!isTwilioConfigured()) return { success: false, error: 'Звонки не настроены.' };
        const user = await usersRepo.findById(userId);
        if (!user?.phoneNumber) return { success: false, error: 'Номер телефона не сохранён. Попроси пользователя указать номер через profile_update.' };

        log.info({ userId, reason: reason.slice(0, 60) }, 'Calling user');
        const result = await callUser({ toNumber: user.phoneNumber, userId, telegramChatId, userName, timezone, reason, callType: 'self' });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, callSid: result.callSid, message: 'Звоню...' };
      },
    }),

    call_third_party: tool({
      description: 'Позвонить третьему лицу от имени пользователя. WHEN: пользователь просит "запишись ко врачу", "договорись о встрече", "узнай режим работы". CHAIN: profile_get (проверь phoneNumber) → [profile_update если нет] → этот инструмент → message_send_text. RETURNS: { success: true, callSid, message } или { success: false, error }.',
      inputSchema: z.object({
        toNumber: z.string().describe('Номер телефона в международном формате, например +77001234567'),
        targetName: z.string().describe('Имя или название организации, куда звоним'),
        agenda: z.string().describe('Подробная цель звонка — что именно нужно выяснить, договориться или сделать. Чем подробнее, тем лучше.'),
      }),
      execute: async ({ toNumber, targetName, agenda }) => {
        if (!isTwilioConfigured()) return { success: false, error: 'Звонки не настроены.' };
        if (!toNumber.match(/^\+\d{7,15}$/)) return { success: false, error: 'Номер должен быть в формате +7XXXXXXXXXX' };

        log.info({ userId, toNumber, targetName }, 'Calling third party');
        const result = await callUser({
          toNumber,
          userId,
          telegramChatId,
          userName,
          timezone,
          reason: agenda,
          callType: 'third_party',
          targetName,
          agenda,
        });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, callSid: result.callSid, message: `Звоню ${targetName}...` };
      },
    }),
  };
}
