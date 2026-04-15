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
import { redisConnection } from './scheduler/queue.js';
import { mcpManager } from './mcp/client.js';

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

// Start BullMQ worker
const worker = startWorker();

// Start bot
bot.start({
  onStart: () => log.info('Opekun bot + worker started (long polling)'),
});

// Graceful shutdown
async function shutdown() {
  log.info('Shutting down...');
  await bot.stop();
  await worker.close();
  await mcpManager.shutdown();
  await redisConnection.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
