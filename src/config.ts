import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  telegramBotToken: z.string().min(1),
  allowedUserIds: z.string().transform(s => s.split(',').map(id => Number(id.trim()))),
  openrouterApiKey: z.string().min(1),
  primaryModel: z.string().default('anthropic/claude-sonnet-4-5'),
  fastModel: z.string().default('google/gemini-2.5-flash'),
  mem0ApiKey: z.string().optional().default(''),
  databaseUrl: z.string().min(1),
  upstashRedisUrl: z.string().min(1),
  openaiApiKey: z.string().optional().default(''),
  braveSearchApiKey: z.string().optional().default(''),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production']).default('development'),
  defaultTimezone: z.string().default('Asia/Almaty'),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse({
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  primaryModel: process.env.OPENROUTER_PRIMARY_MODEL,
  fastModel: process.env.OPENROUTER_FAST_MODEL,
  mem0ApiKey: process.env.MEM0_API_KEY,
  databaseUrl: process.env.DATABASE_URL,
  upstashRedisUrl: process.env.UPSTASH_REDIS_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
  logLevel: process.env.LOG_LEVEL,
  nodeEnv: process.env.NODE_ENV,
  defaultTimezone: process.env.DEFAULT_TIMEZONE,
});
