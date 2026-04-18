import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
});

const childLoggers = new Map<string, pino.Logger>();

export function createChildLogger(module: string): pino.Logger {
  let child = childLoggers.get(module);
  if (!child) {
    child = logger.child({ module });
    childLoggers.set(module, child);
  }
  return child;
}
