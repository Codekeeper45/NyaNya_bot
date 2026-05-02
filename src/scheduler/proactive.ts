import { scheduleRepeatingJob, scheduleJob, type JobPayload } from './jobs.js';
import { repeatingJobsRepo } from '../db/repos/repeating_jobs.js';
import { opekuQueue } from './queue.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('proactive');

export async function setupUserSchedules(
  user: {
    id: number;
    telegramUserId: number;
    timezone: string;
    wakeTime: string;
    sleepTime: string;
    weekendWakeTime?: string | null;
    weekendSleepTime?: string | null;
  },
  chatId: number,
  meals: {
    breakfastTime: string;
    lunchTime: string;
    dinnerTime: string;
  },
): Promise<void> {
  const base: Omit<JobPayload, 'kind' | 'context'> = {
    userId: user.id,
    telegramUserId: user.telegramUserId,
    telegramChatId: chatId,
  };

  function parseTime(t: string | null | undefined, fallback: [number, number]): [number, number] {
    if (!t) return fallback;
    const [h, m] = t.split(':').map(Number);
    return (isNaN(h) || isNaN(m)) ? fallback : [h, m];
  }

  const [wakeH, wakeM] = parseTime(user.wakeTime, [8, 0]);
  const [bfH, bfM] = parseTime(meals.breakfastTime, [9, 0]);
  const [lunchH, lunchM] = parseTime(meals.lunchTime, [13, 0]);
  const [dinnerH, dinnerM] = parseTime(meals.dinnerTime, [19, 0]);
  const [sleepH, sleepM] = parseTime(user.sleepTime, [23, 0]);

  const hasWeekendWake = user.weekendWakeTime && user.weekendWakeTime !== user.wakeTime;
  const hasWeekendSleep = user.weekendSleepTime && user.weekendSleepTime !== user.sleepTime;

  // Evening reflection: 1 hour before sleep
  let reflectH = sleepH - 1;
  if (reflectH < 0) reflectH += 24;

  const jobs: Promise<void>[] = [];

  // Morning greeting (conditional — weekday/weekend split or single)
  if (hasWeekendWake) {
    const [wwH, wwM] = parseTime(user.weekendWakeTime, [wakeH, wakeM]);
    jobs.push(scheduleRepeatingJob(
      `user-${user.id}-morning-weekday`,
      { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
      `${wakeM} ${wakeH} * * 1,2,3,4,5`,
      user.timezone,
    ));
    jobs.push(scheduleRepeatingJob(
      `user-${user.id}-morning-weekend`,
      { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
      `${wwM} ${wwH} * * 0,6`,
      user.timezone,
    ));
  } else {
    jobs.push(scheduleRepeatingJob(
      `user-${user.id}-morning`,
      { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
      `${wakeM} ${wakeH} * * *`,
      user.timezone,
    ));
  }

  // Meals
  jobs.push(scheduleRepeatingJob(
    `user-${user.id}-breakfast`,
    { ...base, kind: 'meal_reminder', context: 'завтрак' },
    `${bfM} ${bfH} * * *`,
    user.timezone,
  ));
  jobs.push(scheduleRepeatingJob(
    `user-${user.id}-lunch`,
    { ...base, kind: 'meal_reminder', context: 'обед' },
    `${lunchM} ${lunchH} * * *`,
    user.timezone,
  ));
  jobs.push(scheduleRepeatingJob(
    `user-${user.id}-dinner`,
    { ...base, kind: 'meal_reminder', context: 'ужин' },
    `${dinnerM} ${dinnerH} * * *`,
    user.timezone,
  ));

  // Evening reflection (conditional — weekday/weekend split or single)
  if (hasWeekendSleep) {
    const [wsH, wsM] = parseTime(user.weekendSleepTime, [sleepH, sleepM]);
    let weekendReflectH = wsH - 1;
    if (weekendReflectH < 0) weekendReflectH += 24;
    jobs.push(scheduleRepeatingJob(
      `user-${user.id}-reflection-weekday`,
      { ...base, kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
      `${sleepM} ${reflectH} * * 1,2,3,4,5`,
      user.timezone,
    ));
    jobs.push(scheduleRepeatingJob(
      `user-${user.id}-reflection-weekend`,
      { ...base, kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
      `${wsM} ${weekendReflectH} * * 0,6`,
      user.timezone,
    ));
  } else {
    jobs.push(scheduleRepeatingJob(
      `user-${user.id}-reflection`,
      { ...base, kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
      `${sleepM} ${reflectH} * * *`,
      user.timezone,
    ));
  }

  // Weekly
  jobs.push(scheduleRepeatingJob(
    `user-${user.id}-edu-suggestion`,
    { ...base, kind: 'suggest_new_topic', context: 'Предложение новой темы для обучения на основе интересов' },
    `0 16 * * 0`,
    user.timezone,
  ));
  jobs.push(scheduleRepeatingJob(
    `user-${user.id}-weekly-digest`,
    { ...base, kind: 'weekly_digest', context: 'Итоги твоей продуктивной недели' },
    `0 21 * * 0`,
    user.timezone,
  ));

  await Promise.all(jobs);

  log.info({ userId: user.id, wakeTime: user.wakeTime }, 'User schedules created');
}

export async function restoreSchedules(): Promise<void> {
  const stored = await repeatingJobsRepo.findAll();
  const storedIds = new Set(stored.map(j => j.schedulerId));

  const existing = await opekuQueue.getJobSchedulers();
  const existingIds = new Set(existing.map(s => s.key));

  const toRemove = existing.filter(s => s.key && !storedIds.has(s.key));
  const toRestore = stored.filter(job => !existingIds.has(job.schedulerId));

  await Promise.all(toRemove.map(s => opekuQueue.removeJobScheduler(s.key)));
  await Promise.all(toRestore.map(job => opekuQueue.upsertJobScheduler(
    job.schedulerId,
    { pattern: job.cronPattern, tz: job.timezone },
    { name: job.kind, data: job.payload },
  )));

  log.info({ total: stored.length, restored: toRestore.length, removed: toRemove.length }, 'Schedules synced with DB');
}

export async function syncSchedules(): Promise<void> {
  const stored = await repeatingJobsRepo.findAll();
  const storedMap = new Map(stored.map(j => [j.schedulerId, j]));

  const existing = await opekuQueue.getJobSchedulers();
  const existingMap = new Map(existing.map(s => [s.key, s]));

  const toRemove = [...existingMap.keys()].filter(key => key && !storedMap.has(key));
  const toUpsert = [...storedMap.entries()].filter(([schedulerId, job]) => {
    const existing = existingMap.get(schedulerId);
    if (!existing) return true;
    const existingPattern = (existing as unknown as Record<string, unknown>)?.pattern;
    const existingTz = (existing as unknown as Record<string, unknown>)?.tz;
    return existingPattern !== job.cronPattern || existingTz !== job.timezone;
  });

  await Promise.all(toRemove.map(key => opekuQueue.removeJobScheduler(key)));
  await Promise.all(toUpsert.map(([schedulerId, job]) => opekuQueue.upsertJobScheduler(
    schedulerId,
    { pattern: job.cronPattern, tz: job.timezone },
    { name: job.kind, data: job.payload },
  )));

  if (toRemove.length > 0 || toUpsert.length > 0) {
    log.info({ total: stored.length, upserted: toUpsert.length, removed: toRemove.length }, 'Periodic schedule sync completed');
  }
}

// Follow-up chain is driven ONLY by the model via followup_ask tool.
// Do NOT auto-schedule here — that creates duplicate jobs.
