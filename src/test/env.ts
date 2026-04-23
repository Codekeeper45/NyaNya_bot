// Must be loaded first via vitest setupFiles — sets env before any module is imported
process.env.TELEGRAM_BOT_TOKEN = '1234567890:AAEtest-token-for-vitest';
process.env.TELEGRAM_ALLOWED_USER_IDS = '100';
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
process.env.UPSTASH_REDIS_URL = 'redis://localhost:6379';
process.env.UPSTASH_REDIS_TOKEN = 'test-token';
process.env.NODE_ENV = 'test';
