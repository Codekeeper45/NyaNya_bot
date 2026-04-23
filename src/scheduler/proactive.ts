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

  if (hasWeekendWake) {
    const [wwH, wwM] = parseTime(user.weekendWakeTime, [wakeH, wakeM]);
    await scheduleRepeatingJob(
      `user-${user.id}-morning-weekday`,
      { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
      `${wakeM} ${wakeH} * * 1,2,3,4,5`,
      user.timezone,
    );
    await scheduleRepeatingJob(
      `user-${user.id}-morning-weekend`,
      { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
      `${wwM} ${wwH} * * 0,6`,
      user.timezone,
    );
  } else {
    await scheduleRepeatingJob(
      `user-${user.id}-morning`,
      { ...base, kind: 'morning_greeting', context: 'Утреннее приветствие' },
      `${wakeM} ${wakeH} * * *`,
      user.timezone,
    );
  }

  // Breakfast reminder
  await scheduleRepeatingJob(
    `user-${user.id}-breakfast`,
    { ...base, kind: 'meal_reminder', context: 'завтрак' },
    `${bfM} ${bfH} * * *`,
    user.timezone,
  );

  // Lunch reminder
  await scheduleRepeatingJob(
    `user-${user.id}-lunch`,
    { ...base, kind: 'meal_reminder', context: 'обед' },
    `${lunchM} ${lunchH} * * *`,
    user.timezone,
  );

  // Dinner reminder
  await scheduleRepeatingJob(
    `user-${user.id}-dinner`,
    { ...base, kind: 'meal_reminder', context: 'ужин' },
    `${dinnerM} ${dinnerH} * * *`,
    user.timezone,
  );

  // Evening reflection: 1 hour before sleep
  let reflectH = sleepH - 1;
  if (reflectH < 0) reflectH += 24;

  if (hasWeekendSleep) {
    const [wsH, wsM] = parseTime(user.weekendSleepTime, [sleepH, sleepM]);
    let weekendReflectH = wsH - 1;
    if (weekendReflectH < 0) weekendReflectH += 24;
    await scheduleRepeatingJob(
      `user-${user.id}-reflection-weekday`,
      { ...base, kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
      `${sleepM} ${reflectH} * * 1,2,3,4,5`,
      user.timezone,
    );
    await scheduleRepeatingJob(
      `user-${user.id}-reflection-weekend`,
      { ...base, kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
      `${wsM} ${weekendReflectH} * * 0,6`,
      user.timezone,
    );
  } else {
    await scheduleRepeatingJob(
      `user-${user.id}-reflection`,
      { ...base, kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
      `${sleepM} ${reflectH} * * *`,
      user.timezone,
    );
  }

  // Weekly educational suggestion: Sunday at 16:00
  await scheduleRepeatingJob(
    `user-${user.id}-edu-suggestion`,
    { ...base, kind: 'suggest_new_topic', context: 'Предложение новой темы для обучения на основе интересов' },
    `0 16 * * 0`,
    user.timezone,
  );

  // Weekly progress digest: Sunday at 21:00
  await scheduleRepeatingJob(
    `user-${user.id}-weekly-digest`,
    { ...base, kind: 'weekly_digest', context: 'Итоги твоей продуктивной недели' },
    `0 21 * * 0`,
    user.timezone,
  );

  log.info({ userId: user.id, wakeTime: user.wakeTime }, 'User schedules created');
}

export async function restoreSchedules(): Promise<void> {
  const stored = await repeatingJobsRepo.findAll();
  const storedIds = new Set(stored.map(j => j.schedulerId));

  const existing = await opekuQueue.getJobSchedulers();
  const existingIds = new Set(existing.map(s => s.key));

  // Remove from Redis anything not in DB (orphaned entries)
  let removed = 0;
  for (const s of existing) {
    if (s.key && s.key.startsWith('user-') && !storedIds.has(s.key)) {
      await opekuQueue.removeJobScheduler(s.key);
      removed++;
    }
  }

  // Add to Redis anything in DB but missing from Redis
  let restored = 0;
  for (const job of stored) {
    if (existingIds.has(job.schedulerId)) continue;
    await opekuQueue.upsertJobScheduler(
      job.schedulerId,
      { pattern: job.cronPattern, tz: job.timezone },
      { name: job.kind, data: job.payload },
    );
    restored++;
  }

  log.info({ total: stored.length, restored, removed }, 'Schedules synced with DB');
}

export async function syncSchedules(): Promise<void> {
  const stored = await repeatingJobsRepo.findAll();
  const storedMap = new Map(stored.map(j => [j.schedulerId, j]));

  const existing = await opekuQueue.getJobSchedulers();
  const existingMap = new Map(existing.map(s => [s.key, s]));

  let removed = 0;
  let restored = 0;
  let updated = 0;

  // Remove from Redis anything not in DB (orphaned entries)
  for (const [key, s] of existingMap) {
    if (key && key.startsWith('user-') && !storedMap.has(key)) {
      await opekuQueue.removeJobScheduler(key);
      removed++;
    }
  }

  // Add to Redis anything in DB but missing from Redis, or with different pattern/tz
  for (const [schedulerId, job] of storedMap) {
    const existingScheduler = existingMap.get(schedulerId);
    if (!existingScheduler) {
      await opekuQueue.upsertJobScheduler(
        schedulerId,
        { pattern: job.cronPattern, tz: job.timezone },
        { name: job.kind, data: job.payload },
      );
      restored++;
      continue;
    }

    // Check if pattern or timezone changed
    const existingPattern = (existingScheduler as unknown as Record<string, unknown>)?.pattern;
    const existingTz = (existingScheduler as unknown as Record<string, unknown>)?.tz;
    if (existingPattern !== job.cronPattern || existingTz !== job.timezone) {
      await opekuQueue.upsertJobScheduler(
        schedulerId,
        { pattern: job.cronPattern, tz: job.timezone },
        { name: job.kind, data: job.payload },
      );
      updated++;
    }
  }

  if (removed > 0 || restored > 0 || updated > 0) {
    log.info({ total: stored.length, restored, removed, updated }, 'Periodic schedule sync completed');
  }
}

// Follow-up chain is driven ONLY by the model via followup_ask tool.
// Do NOT auto-schedule here — that creates duplicate jobs.
