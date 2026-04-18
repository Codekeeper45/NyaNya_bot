import { createChildLogger } from './logger.js';

const log = createChildLogger('errors');

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public isOperational = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR');
    this.name = 'ExternalServiceError';
  }
}

export function handleError(error: unknown, context?: string): void {
  if (error instanceof AppError && error.isOperational) {
    log.warn({ err: error, context }, error.message);
  } else {
    log.error({ err: error, context }, 'Unexpected error');
  }
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
