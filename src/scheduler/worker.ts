import { Worker } from 'bullmq';
import { redisConnection } from './queue.js';
import { runOrchestrator } from '../agent/orchestrator.js';
import { usersRepo } from '../db/repos/users.js';
import type { JobPayload } from './jobs.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('worker');

export function startWorker(): Worker<JobPayload> {
  const worker = new Worker<JobPayload>(
    'opekun-jobs',
    async (job) => {
      const { userId, telegramUserId, telegramChatId, kind, context, attemptNumber } = job.data;
      log.info({ jobId: job.id, kind, userId }, 'Processing job');

      const user = await usersRepo.findById(userId);
      if (!user) {
        log.warn({ userId }, 'User not found, skipping job');
        return;
      }
      if (user.paused) {
        log.info({ userId, kind }, 'User paused, skipping job');
        return;
      }

      await runOrchestrator({
        userId,
        telegramUserId,
        telegramChatId,
        userName: user.name,
        userTimezone: user.timezone,
        wakeTime: user.wakeTime ?? undefined,
        sleepTime: user.sleepTime ?? undefined,
        preferences: (user.preferences as Record<string, unknown>) ?? {},
        mode: 'proactive',
        proactiveKind: kind,
        proactiveContext: context,
        proactiveAttempt: attemptNumber ?? 1,
      });
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id, kind: job.data.kind }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Job failed');
  });

  return worker;
}
