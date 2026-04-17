import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('oauth:google');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = 'http://localhost:4242';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

export function isGoogleOAuthConfigured(): boolean {
  return !!(config.googleClientId && config.googleClientSecret);
}

export function generateAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId ?? '',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Извлекает code из полного redirect URL или возвращает строку как есть */
export function extractCodeFromInput(input: string): string {
  if (input.includes('code=')) {
    const match = input.match(/[?&]code=([^&\s]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return input.trim();
}

/** Определяет, является ли сообщение Google OAuth callback URL */
export function isOAuthCallbackUrl(text: string): boolean {
  return text.includes('localhost') && text.includes('code=');
}

export async function exchangeCode(code: string): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId ?? '',
      client_secret: config.googleClientSecret ?? '',
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    log.error({ status: response.status, data }, 'Token exchange failed');
    throw new Error(`Google: ${data.error_description ?? data.error ?? response.status}`);
  }

  const refreshToken = data.refresh_token as string | undefined;
  if (!refreshToken) {
    throw new Error('Google не вернул refresh_token — попробуй /gcal снова.');
  }

  log.info('Google OAuth token exchange successful');
  return refreshToken;
}
