import { setupGlobalErrorHandlers } from './lib/errors.js';
import { createChildLogger } from './lib/logger.js';
import { bot } from './bot/bot.js';
import { authMiddleware } from './bot/middleware/auth.js';
import { rateLimitMiddleware } from './bot/middleware/ratelimit.js';
import { contextMiddleware } from './bot/middleware/context.js';
import { registerCommands } from './bot/handlers/commands.js';
import { registerMessageHandler } from './bot/handlers/message.js';
import { registerVoiceHandler } from './bot/handlers/voice.js';
import { registerVoiceBrowser } from './bot/handlers/voice-browser.js';
import { startWorker } from './scheduler/worker.js';
import { restoreSchedules, syncSchedules } from './scheduler/proactive.js';
import { runDailyPatternDetection } from './scheduler/patterns.js';
import { jobExecutionsRepo } from './db/repos/job_executions.js';
import { redisConnection, workerRedisConnection, opekuQueue } from './scheduler/queue.js';
import { graphRag } from './graphrag/index.js';
import { startCallServer } from './call/server.js';
import { isTwilioConfigured } from './call/initiate.js';

const log = createChildLogger('main');

log.info({ buildTime: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }), pid: process.pid }, '🚀 Opekun starting');

setupGlobalErrorHandlers();

// Middleware chain
bot.use(authMiddleware);
bot.use(rateLimitMiddleware);
bot.use(contextMiddleware);

// Handlers
registerCommands(bot);
registerMessageHandler(bot);
registerVoiceHandler(bot);
registerVoiceBrowser(bot);

// Restore repeating schedules lost from Redis (e.g. after restart)
restoreSchedules().catch(err => log.error({ err }, 'Failed to restore schedules'));

// Periodic sync to keep Redis and DB in sync (catches orphans, drift, etc.)
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
setInterval(() => {
  syncSchedules().catch(err => log.error({ err }, 'Periodic schedule sync failed'));
}, SYNC_INTERVAL_MS);

// Daily pattern detection (adaptive behavior)
const PATTERN_DETECTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
setTimeout(() => {
  runDailyPatternDetection().catch(err => log.error({ err }, 'Pattern detection failed'));
  setInterval(() => {
    runDailyPatternDetection().catch(err => log.error({ err }, 'Pattern detection failed'));
  }, PATTERN_DETECTION_INTERVAL_MS);
}, 60 * 60 * 1000); // First run 1 hour after start

// GraphRAG batch indexing every 6 hours
const GRAPHRAG_INDEX_INTERVAL_MS = 6 * 60 * 60 * 1000;
setTimeout(() => {
  graphRag.indexAll().catch(err => log.error({ err }, 'GraphRAG indexing failed'));
  setInterval(() => {
    graphRag.indexAll().catch(err => log.error({ err }, 'GraphRAG indexing failed'));
  }, GRAPHRAG_INDEX_INTERVAL_MS);
}, 30_000); // First run 30s after start

// Cleanup old job execution logs (keep 90 days)
setInterval(() => {
  jobExecutionsRepo.deleteOlderThan(90).catch(err => log.error({ err }, 'Job executions cleanup failed'));
}, 24 * 60 * 60 * 1000);

// Log BullMQ queue-level errors (connection issues, etc.)
opekuQueue.on('error', (err) => log.error({ err }, 'BullMQ queue error'));

// Start call webhook server only when Twilio is configured
if (isTwilioConfigured()) startCallServer();

// Start BullMQ worker
const worker = startWorker();

// Start bot (void: bot.start() resolves only when the bot stops — that's expected)
void bot.start({
  onStart: () => log.info('Opekun bot + worker started (long polling)'),
}).catch(err => {
  log.error({ err }, 'Bot start failed');
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  log.info('Shutting down...');
  await bot.stop();
  await worker.close();
  await redisConnection.quit();
  await workerRedisConnection.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
