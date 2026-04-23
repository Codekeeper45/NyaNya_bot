import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('redis');

function createRedisConnection(label: string): IORedis {
  const conn = new IORedis(config.upstashRedisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(config.upstashRedisUrl.startsWith('rediss://') ? { tls: {} } : {}),
  });
  conn.on('error', (err: unknown) => log.error({ err, label }, 'Redis connection error'));
  return conn;
}

export const redisConnection = createRedisConnection('shared');
export const workerRedisConnection = createRedisConnection('worker');

export const opekuQueue = new Queue('opekun-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 20,
    removeOnFail: 10,
  },
});
