import { setupGlobalErrorHandlers } from './lib/errors.js';
import { createChildLogger } from './lib/logger.js';
import { bot } from './bot/bot.js';
import { authMiddleware } from './bot/middleware/auth.js';
import { rateLimitMiddleware } from './bot/middleware/ratelimit.js';
import { contextMiddleware } from './bot/middleware/context.js';
import { registerCommands } from './bot/handlers/commands.js';
import { registerMessageHandler } from './bot/handlers/message.js';
import { registerVoiceHandler } from './bot/handlers/voice.js';
import { startWorker } from './scheduler/worker.js';
import { restoreSchedules } from './scheduler/proactive.js';
import { redisConnection, opekuQueue } from './scheduler/queue.js';
import { startCallServer } from './call/server.js';
import { isTwilioConfigured } from './call/initiate.js';

const log = createChildLogger('main');

setupGlobalErrorHandlers();

// Middleware chain
bot.use(authMiddleware);
bot.use(rateLimitMiddleware);
bot.use(contextMiddleware);

// Handlers
registerCommands(bot);
registerMessageHandler(bot);
registerVoiceHandler(bot);

// Restore repeating schedules lost from Redis (e.g. after restart)
restoreSchedules().catch(err => log.error({ err }, 'Failed to restore schedules'));

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
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
