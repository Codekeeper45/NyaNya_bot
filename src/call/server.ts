import express, { type Request, type Response, type NextFunction } from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import { createSession, getSession, addTurn, deleteSession } from './session.js';
import { generateCallReply } from './dialogue.js';
import { createChildLogger } from '../lib/logger.js';
import { bot } from '../bot/bot.js';
import { exchangeCode } from '../oauth/google.js';
import { usersRepo } from '../db/repos/users.js';

const log = createChildLogger('call:server');

function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function say(text: string, voice = 'Polly.Tatyana'): string {
  return `<Say voice="${voice}" language="ru-RU">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Say>`;
}

function gather(action: string, hint = ''): string {
  const hintAttr = hint ? ` hints="${hint}"` : '';
  return `<Gather input="speech" action="${action}" method="POST" language="ru-RU" speechTimeout="auto"${hintAttr}>`;
}

function twilioAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.twilioAuthToken || !config.twilioWebhookUrl) { next(); return; }
  const signature = req.headers['x-twilio-signature'] as string ?? '';
  const url = `${config.twilioWebhookUrl}${req.originalUrl}`;
  const valid = twilio.validateRequest(config.twilioAuthToken, signature, url, req.body as Record<string, string>);
  if (!valid) {
    log.warn({ url }, 'Invalid Twilio signature — rejecting');
    res.sendStatus(403);
    return;
  }
  next();
}

export function startCallServer(): void {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(twilioAuthMiddleware);

  const webhookBase = config.twilioWebhookUrl || `http://localhost:${config.callServerPort}`;

  // Called when user answers the call
  app.post('/call/answer', (req, res) => {
    const callSid: string = req.body.CallSid;
    const session = getSession(callSid);

    if (!session) {
      log.warn({ callSid }, 'No session for answered call');
      res.type('text/xml').send(twiml(say('Привет! Это Опекун.') + gather(`${webhookBase}/call/input`) + '</Gather>'));
      return;
    }

    const greeting = session.callType === 'third_party'
      ? `Здравствуйте! Я звоню от имени ${session.userName}. ${session.agenda ?? session.reason}`
      : `Привет, ${session.userName}! Это твой Опекун. ${session.reason} Как ты?`;
    addTurn(callSid, 'assistant', greeting);

    log.info({ callSid, userId: session.userId }, 'Call answered');
    res.type('text/xml').send(twiml(
      say(greeting) +
      gather(`${webhookBase}/call/input`) +
      say('Я слушаю.') +
      '</Gather>'
    ));
  });

  // Called each time user finishes speaking
  app.post('/call/input', async (req, res) => {
    const callSid: string = req.body.CallSid;
    const speechResult: string = req.body.SpeechResult ?? '';
    const session = getSession(callSid);

    if (!session || !speechResult.trim()) {
      res.type('text/xml').send(twiml(
        gather(`${webhookBase}/call/input`) +
        say('Не расслышала, повтори пожалуйста.') +
        '</Gather>'
      ));
      return;
    }

    log.info({ callSid, speech: speechResult.slice(0, 80) }, 'User spoke');
    addTurn(callSid, 'user', speechResult);

    const reply = await generateCallReply(session, speechResult);
    const isEnd = reply.includes('КОНЕЦ_РАЗГОВОРА');
    const cleanReply = reply.replace('КОНЕЦ_РАЗГОВОРА', '').trim();

    addTurn(callSid, 'assistant', cleanReply);

    if (isEnd) {
      if (session.callType === 'third_party' && session.history.length > 1) {
        const summary = session.history
          .map(t => `${t.role === 'assistant' ? 'Бот' : session.targetName ?? 'Собеседник'}: ${t.content}`)
          .join('\n');
        await bot.api.sendMessage(session.telegramChatId,
          `Звонок ${session.targetName ?? ''} завершён. Краткий итог:\n\n${cleanReply}\n\n📋 Лог разговора:\n${summary.slice(0, 3000)}`
        ).catch(() => {});
      }
      deleteSession(callSid);
      res.type('text/xml').send(twiml(say(cleanReply) + '<Hangup/>'));
      return;
    }

    res.type('text/xml').send(twiml(
      say(cleanReply) +
      gather(`${webhookBase}/call/input`) +
      say('Слушаю.') +
      '</Gather>'
    ));
  });

  // Called when call ends (hangup event)
  app.post('/call/status', async (req, res) => {
    const callSid: string = req.body.CallSid;
    const callStatus: string = req.body.CallStatus;
    const session = getSession(callSid);

    log.info({ callSid, callStatus }, 'Call status update');

    if (session && (callStatus === 'completed' || callStatus === 'no-answer' || callStatus === 'busy' || callStatus === 'failed' || callStatus === 'canceled')) {
      if (callStatus === 'no-answer' || callStatus === 'busy') {
        const msg = session.callType === 'third_party'
          ? `${session.targetName ?? 'Абонент'} не взял(а) трубку (${callStatus}). Попробовать позвонить позже?`
          : `Я пыталась дозвониться, но ты не взял(а) трубку. Напиши когда будешь готов(а) поговорить! 📞`;
        await bot.api.sendMessage(session.telegramChatId, msg).catch(() => {});
      }
      deleteSession(callSid);
    }

    res.sendStatus(204);
  });

  app.get('/auth/google/callback', async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code || !state) {
      res.status(400).send('<h1>Ошибка</h1><p>Отсутствует code или state.</p>');
      return;
    }

    const telegramChatId = parseInt(state, 10);
    if (isNaN(telegramChatId)) {
      res.status(400).send('<h1>Ошибка</h1><p>Некорректный state.</p>');
      return;
    }

    try {
      const refreshToken = await exchangeCode(code);
      const user = await usersRepo.findByTelegramId(telegramChatId);
      if (!user) {
        res.status(404).send('<h1>Ошибка</h1><p>Пользователь не найден. Сначала напиши боту /start.</p>');
        return;
      }
      await usersRepo.update(user.id, { googleRefreshToken: refreshToken });
      log.info({ userId: user.id }, 'Google Calendar connected via callback');
      await bot.api.sendMessage(telegramChatId, '✅ Google Calendar подключён! Попробуй: "что у меня сегодня в календаре?"').catch(() => {});
      res.send('<h1>✅ Готово!</h1><p>Google Calendar подключён. Можешь закрыть эту страницу и вернуться в Telegram.</p>');
    } catch (err) {
      log.error({ err }, 'Google OAuth callback failed');
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      res.status(500).send(`<h1>Ошибка</h1><p>${message}</p><p>Вернись в Telegram и попробуй /gcal снова.</p>`);
    }
  });

  app.listen(config.callServerPort, () => {
    log.info({ port: config.callServerPort, webhookBase }, 'Call webhook server started');
  });
}
