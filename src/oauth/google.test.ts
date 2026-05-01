describe('Google OAuth helpers', () => {
  it('recognizes pasted localhost callback URLs with a code', async () => {
    vi.resetModules();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:3046/auth/google/callback';

    const { isOAuthCallbackUrl } = await import('./google.js');

    expect(isOAuthCallbackUrl('http://localhost:3046/auth/google/callback?code=abc123&state=100')).toBe(true);
  });

  it('extracts OAuth code from a pasted callback URL', async () => {
    vi.resetModules();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:3046/auth/google/callback';

    const { extractCodeFromInput } = await import('./google.js');

    expect(extractCodeFromInput('http://localhost:3046/auth/google/callback?code=abc%2F123&state=100')).toBe('abc/123');
  });

  it('rejects arbitrary URLs that only contain a code parameter', async () => {
    vi.resetModules();
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:3046/auth/google/callback';

    const { isOAuthCallbackUrl } = await import('./google.js');

    expect(isOAuthCallbackUrl('https://example.com/anything?code=abc123')).toBe(false);
  });
});
