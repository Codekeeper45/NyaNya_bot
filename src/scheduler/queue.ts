import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('redis');

export const redisConnection = new IORedis(config.upstashRedisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...(config.upstashRedisUrl.startsWith('rediss://') ? { tls: {} } : {}),
});

redisConnection.on('error', (err: unknown) => {
  log.error({ err }, 'Redis connection error');
});

export const opekuQueue = new Queue('opekun-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});
