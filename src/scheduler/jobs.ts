import { opekuQueue } from './queue.js';
import { jobsRepo } from '../db/repos/jobs.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('jobs');

export type JobKind =
  | 'morning_greeting'
  | 'meal_reminder'
  | 'lesson_session'
  | 'followup_check'
  | 'daily_planning'
  | 'custom_reminder';

export interface JobPayload {
  userId: number;
  telegramUserId: number;
  telegramChatId: number;
  kind: JobKind;
  context: string;
  attemptNumber?: number;
  metadata?: Record<string, unknown>;
}

export async function scheduleJob(payload: JobPayload, delayMs: number): Promise<string> {
  const job = await opekuQueue.add(payload.kind, payload, { delay: delayMs });
  const jobId = job.id ?? '';

  await jobsRepo.create({
    userId: payload.userId,
    bullJobId: jobId,
    kind: payload.kind,
    payload: payload as unknown as Record<string, unknown>,
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + delayMs),
  });

  log.info({ userId: payload.userId, kind: payload.kind, delayMs, jobId }, 'Job scheduled');
  return jobId;
}

export async function scheduleRepeatingJob(
  schedulerId: string,
  payload: JobPayload,
  cronPattern: string,
  timezone: string,
): Promise<void> {
  await opekuQueue.upsertJobScheduler(
    schedulerId,
    { pattern: cronPattern, tz: timezone },
    { name: payload.kind, data: payload },
  );
  log.info({ schedulerId, kind: payload.kind, cron: cronPattern, tz: timezone }, 'Repeating job set');
}

export async function cancelJob(bullJobId: string): Promise<void> {
  const job = await opekuQueue.getJob(bullJobId);
  if (job) {
    await job.remove();
    log.info({ bullJobId }, 'Job cancelled');
  }
}
