import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

// Try multiple .env locations (Pterodactyl runs from /home/container, files are at /)
dotenvConfig(); // default: process.cwd()
dotenvConfig({ path: resolve(process.cwd(), '..', '.env') }); // parent dir

const configSchema = z.object({
  telegramBotToken: z.string().min(1),
  allowedUserIds: z.string().transform(s =>
    s.split(',').map(id => Number(id.trim())).filter(n => !isNaN(n) && n > 0)
  ),
  openrouterApiKey: z.string().min(1),
  primaryModel: z.string().default('anthropic/claude-sonnet-4-5'),
  fastModel: z.string().default('google/gemini-2.5-flash'),
  databaseUrl: z.string().min(1),
  upstashRedisUrl: z.string().min(1),
  openaiApiKey: z.string().optional().default(''),
  googleGenaiApiKey: z.string().optional().default(''),
  googleGenaiApiKeys: z.string().transform(s => s.split(',').map(k => k.trim()).filter(k => k.length > 0)).optional().default(''),
  braveSearchApiKey: z.string().optional().default(''),
  tavilyApiKey: z.string().optional().default(''),
  googleClientId: z.string().optional().default(''),
  googleClientSecret: z.string().optional().default(''),
  googleOAuthRedirectUri: z.string().optional().default('http://localhost:4242'),
  twilioAccountSid: z.string().optional().default(''),
  twilioAuthToken: z.string().optional().default(''),
  twilioFromNumber: z.string().optional().default(''),
  twilioWebhookUrl: z.string().optional().default(''),
  callServerPort: z.coerce.number().default(4343),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  defaultTimezone: z.string().default('Asia/Almaty'),
});

type Config = z.infer<typeof configSchema>;

const parsed = configSchema.parse({
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  primaryModel: process.env.OPENROUTER_PRIMARY_MODEL,
  fastModel: process.env.OPENROUTER_FAST_MODEL,
  databaseUrl: process.env.DATABASE_URL,
  upstashRedisUrl: process.env.UPSTASH_REDIS_URL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleGenaiApiKey: process.env.GOOGLE_GENAI_API_KEY,
  googleGenaiApiKeys: process.env.GOOGLE_GENAI_API_KEYS,
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleOAuthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER,
  twilioWebhookUrl: process.env.TWILIO_WEBHOOK_URL,
  callServerPort: process.env.CALL_SERVER_PORT,
  logLevel: process.env.LOG_LEVEL,
  nodeEnv: process.env.NODE_ENV,
  defaultTimezone: process.env.DEFAULT_TIMEZONE,
});

if (parsed.allowedUserIds.length === 0) {
  throw new Error('TELEGRAM_ALLOWED_USER_IDS is empty or missing — set it to comma-separated Telegram user IDs');
}

export const config = parsed;
