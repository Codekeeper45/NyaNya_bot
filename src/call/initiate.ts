import twilio from 'twilio';
import { config } from '../config.js';
import { createSession } from './session.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('call:initiate');

export function isTwilioConfigured(): boolean {
  return !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber);
}

export async function callUser(params: {
  toNumber: string;
  userId: number;
  telegramChatId: number;
  userName: string;
  timezone: string;
  reason: string;
  callType?: 'self' | 'third_party';
  targetName?: string;
  agenda?: string;
}): Promise<{ success: boolean; callSid?: string; error?: string }> {
  if (!isTwilioConfigured()) return { success: false, error: 'Twilio не настроен.' };
  if (!config.twilioWebhookUrl) return { success: false, error: 'TWILIO_WEBHOOK_URL не задан. Запусти ngrok и пропиши URL.' };

  const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

  try {
    const call = await client.calls.create({
      to: params.toNumber,
      from: config.twilioFromNumber,
      url: `${config.twilioWebhookUrl}/call/answer`,
      statusCallback: `${config.twilioWebhookUrl}/call/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed', 'no-answer', 'busy'],
    });

    createSession(call.sid, {
      userId: params.userId,
      telegramChatId: params.telegramChatId,
      userName: params.userName,
      timezone: params.timezone,
      reason: params.reason,
      callType: params.callType ?? 'self',
      targetName: params.targetName,
      agenda: params.agenda,
    });

    log.info({ callSid: call.sid, to: params.toNumber, callType: params.callType ?? 'self', userId: params.userId }, 'Call initiated');
    return { success: true, callSid: call.sid };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, to: params.toNumber }, 'Failed to initiate call');
    return { success: false, error: msg };
  }
}
