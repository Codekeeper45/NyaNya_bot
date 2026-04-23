import { opekuQueue } from './queue.js';
import { jobsRepo } from '../db/repos/jobs.js';
import { repeatingJobsRepo } from '../db/repos/repeating_jobs.js';
import { jobSkipOnceRepo } from '../db/repos/job_skip_once.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('jobs');

type JobKind =
  | 'morning_greeting'
  | 'meal_reminder'
  | 'lesson_session'
  | 'followup_check'
  | 'daily_planning'
  | 'evening_reflection'
  | 'suggest_new_topic'
  | 'weekly_digest'
  | 'custom_reminder';

export interface JobPayload {
  userId: number;
  telegramUserId: number;
  telegramChatId: number;
  kind: JobKind;
  context: string;
  schedulerId?: string;
  attemptNumber?: number;
  metadata?: Record<string, unknown>;
}

export async function scheduleJob(payload: JobPayload, delayMs: number): Promise<string> {
  // DB first to avoid orphaned BullMQ jobs if DB fails
  const scheduledAt = new Date(Date.now() + delayMs);
  await jobsRepo.create({
    userId: payload.userId,
    kind: payload.kind,
    payload: payload as unknown as Record<string, unknown>,
    status: 'scheduled',
    scheduledAt,
  });

  const job = await opekuQueue.add(payload.kind, payload, { delay: delayMs });
  const jobId = job.id ?? '';

  log.info({ userId: payload.userId, kind: payload.kind, delayMs, jobId }, 'Job scheduled');
  return jobId;
}

export async function scheduleRepeatingJob(
  schedulerId: string,
  payload: JobPayload,
  cronPattern: string,
  timezone: string,
): Promise<void> {
  const payloadWithId: JobPayload = { ...payload, schedulerId };
  // DB first to avoid race with syncSchedules (which reads DB as source of truth)
  await repeatingJobsRepo.upsert({
    userId: payload.userId,
    schedulerId,
    kind: payload.kind,
    payload: payloadWithId as unknown as Record<string, unknown>,
    cronPattern,
    timezone,
  });
  await opekuQueue.upsertJobScheduler(
    schedulerId,
    { pattern: cronPattern, tz: timezone },
    { name: payload.kind, data: payloadWithId },
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

export async function cancelRepeatingJob(schedulerId: string): Promise<void> {
  // Redis first: stop firing before cleaning DB
  await opekuQueue.removeJobScheduler(schedulerId);
  await jobSkipOnceRepo.clear(schedulerId);
  await repeatingJobsRepo.remove(schedulerId);
  log.info({ schedulerId }, 'Repeating job cancelled');
}

export async function listRepeatingJobs(userId: number): Promise<Array<{ schedulerId: string; cron: string; name: string }>> {
  const rows = await repeatingJobsRepo.findByUser(userId);
  return rows.map((r) => {
    const payload = r.payload as Partial<JobPayload> | undefined;
    return {
      schedulerId: r.schedulerId,
      cron: r.cronPattern,
      name: payload?.context ?? r.kind,
    };
  });
}
