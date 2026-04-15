import { scheduleRepeatingJob, scheduleJob, type JobPayload } from './jobs.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('proactive');

export async function setupUserSchedules(user: {
  id: number;
  telegramUserId: number;
  timezone: string;
  wakeTime: string;
  sleepTime: string;
}, chatId: number): Promise<void> {
  const base: Omit<JobPayload, 'kind' | 'context'> = {
    userId: user.id,
    telegramUserId: user.telegramUserId,
    telegramChatId: chatId,
  };

  const [wakeH, wakeM] = user.wakeTime.split(':').map(Number);

  // Morning greeting at wake time
  await scheduleRepeatingJob(
    `morning-${user.id}`,
    { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
    `${wakeM} ${wakeH} * * *`,
    user.timezone,
  );

  // Lunch reminder: wake + 5h
  const lunchH = (wakeH + 5) % 24;
  await scheduleRepeatingJob(
    `lunch-${user.id}`,
    { ...base, kind: 'meal_reminder', context: 'обед' },
    `0 ${lunchH} * * *`,
    user.timezone,
  );

  // Dinner reminder: wake + 11h
  const dinnerH = (wakeH + 11) % 24;
  await scheduleRepeatingJob(
    `dinner-${user.id}`,
    { ...base, kind: 'meal_reminder', context: 'ужин' },
    `0 ${dinnerH} * * *`,
    user.timezone,
  );

  log.info({ userId: user.id, wakeTime: user.wakeTime }, 'User schedules created');
}

export async function scheduleFollowup(
  payload: Omit<JobPayload, 'kind'>,
  attemptNumber: number,
): Promise<void> {
  if (attemptNumber > 4) return; // Give up

  // Escalating delays: 10min, 20min, 1h, 3h
  const delaysMinutes = [10, 20, 60, 180];
  const delayMs = (delaysMinutes[attemptNumber - 1] ?? 180) * 60 * 1000;

  await scheduleJob(
    {
      ...payload,
      kind: 'followup_check',
      attemptNumber,
    },
    delayMs,
  );

  log.info({ userId: payload.userId, attempt: attemptNumber, delayMs }, 'Followup scheduled');
}
