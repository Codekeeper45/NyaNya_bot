import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config.js';
import type { CallSession } from './session.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('call:dialogue');
const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export async function generateCallReply(session: CallSession, userSpeech: string): Promise<string> {
  const now = new Date().toLocaleString('ru-RU', { timeZone: session.timezone });

  const systemPrompt = session.callType === 'third_party'
    ? buildThirdPartyPrompt(session, now)
    : buildSelfPrompt(session, now);

  const messages = [
    ...session.history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userSpeech },
  ];

  try {
    const result = await generateText({
      model: openrouter(config.fastModel),
      system: systemPrompt,
      messages,
      maxOutputTokens: 200,
    });
    log.debug({ userId: session.userId, callType: session.callType, reply: result.text.slice(0, 80) }, 'Call reply generated');
    return result.text.trim();
  } catch (err) {
    log.error({ err }, 'Failed to generate call reply');
    return 'Прошу прощения, у меня небольшие технические трудности. Перезвоним позже.';
  }
}

function buildSelfPrompt(session: CallSession, now: string): string {
  return `Ты — «Опекун», AI-наставник ${session.userName}. Сейчас идёт телефонный звонок.
Причина звонка: ${session.reason}
Время: ${now}

Правила телефонного разговора:
- Говори коротко и естественно — это живой звонок, не переписка.
- Предложения короткие. Без списков, заголовков, markdown.
- Задавай не больше одного вопроса за раз.
- Если пользователь прощается или говорит «пока», «всё», «спасибо» — попрощайся тепло и закончи словом: КОНЕЦ_РАЗГОВОРА
- Без звёздочек, без эмодзи.`;
}

function buildThirdPartyPrompt(session: CallSession, now: string): string {
  return `Ты — AI-ассистент, звонишь от имени ${session.userName}.
Время: ${now}
Собеседник: ${session.targetName ?? 'неизвестный человек'}
Цель звонка: ${session.agenda ?? session.reason}

Правила:
- Представься вежливо: «Здравствуйте, я звоню от имени ${session.userName}...»
- Говори чётко, кратко и по делу — это деловой звонок.
- Без списков, заголовков, markdown.
- Задавай не больше одного вопроса за раз.
- Уточняй детали по мере разговора, не торопись.
- Когда цель достигнута или собеседник попрощался — подведи итог одной фразой и добавь: КОНЕЦ_РАЗГОВОРА
- Без звёздочек, без эмодзи.`;
}
