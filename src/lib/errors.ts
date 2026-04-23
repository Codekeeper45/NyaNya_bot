import { createChildLogger } from './logger.js';

const log = createChildLogger('errors');

export function handleError(error: unknown, context?: string): void {
  log.error({ err: error, context }, 'Unexpected error');
}

export function setupGlobalErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'Unhandled rejection — exiting');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}
