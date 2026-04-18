import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db/repos/users.js', () => ({
  usersRepo: { findById: vi.fn() },
}));

import { usersRepo } from '../db/repos/users.js';
import {
  getRefreshToken,
  listCalendars,
  listEvents,
  listAllEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from './client.js';

const mockFindById = usersRepo.findById as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// Helper to create a mock fetch response
function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('getRefreshToken', () => {
  it('returns refresh token from DB when user has one', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'my-refresh-token' });
    const token = await getRefreshToken(1);
    expect(token).toBe('my-refresh-token');
  });

  it('returns null when user has no refresh token', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: null });
    const token = await getRefreshToken(1);
    expect(token).toBeNull();
  });

  it('returns null when user is not found', async () => {
    mockFindById.mockResolvedValue(null);
    const token = await getRefreshToken(99);
    expect(token).toBeNull();
  });
});

describe('listCalendars', () => {
  it('parses and returns calendar list from Google API', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });
    const fetchMock = mockFetch({ access_token: 'at' }); // token exchange
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'at' }) })
      .mockResolvedValueOnce({
        ok: true, status: 200, json: vi.fn().mockResolvedValue({
          items: [
            { id: 'primary', summary: 'Main', primary: true, accessRole: 'owner' },
            { id: 'work@gmail.com', summary: 'Work', accessRole: 'reader' },
          ],
        }),
      });

    const cals = await listCalendars(1);
    expect(cals).toHaveLength(2);
    expect(cals[0]).toEqual({ id: 'primary', summary: 'Main', primary: true, accessRole: 'owner' });
    expect(cals[1]).toEqual({ id: 'work@gmail.com', summary: 'Work', primary: undefined, accessRole: 'reader' });
  });

  it('throws error when user has no refresh token', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: null });
    await expect(listCalendars(1)).rejects.toThrow('Google Calendar не подключён');
  });
});

describe('listEvents', () => {
  it('filters events by timeMin/timeMax and returns parsed events', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'at' }) })
      .mockResolvedValueOnce({
        ok: true, status: 200, json: vi.fn().mockResolvedValue({
          items: [{
            id: 'e1',
            summary: 'Встреча',
            start: { dateTime: '2025-04-17T10:00:00Z' },
            end: { dateTime: '2025-04-17T11:00:00Z' },
          }],
        }),
      });

    const events = await listEvents(1, '2025-04-17T00:00:00Z', '2025-04-17T23:59:59Z', 10, 'primary');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'e1', summary: 'Встреча', start: '2025-04-17T10:00:00Z' });
  });
});

describe('listAllEvents', () => {
  it('merges events from multiple calendars and deduplicates by id', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });

    const event1 = { id: 'e1', summary: 'Evt1', start: { dateTime: '2025-04-17T09:00:00Z' }, end: { dateTime: '2025-04-17T10:00:00Z' } };
    const event2 = { id: 'e2', summary: 'Evt2', start: { dateTime: '2025-04-17T11:00:00Z' }, end: { dateTime: '2025-04-17T12:00:00Z' } };

    // URL-based mock: inspect URL to return the right response
    const fetchMock = vi.fn((url: string) => {
      const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

      if (url.includes('oauth2.googleapis.com')) return Promise.resolve(ok({ access_token: 'at' }));
      if (url.includes('calendarList')) return Promise.resolve(ok({ items: [
        { id: 'primary', summary: 'Main', accessRole: 'owner' },
        { id: 'work', summary: 'Work', accessRole: 'reader' },
      ]}));
      if (url.includes('primary')) return Promise.resolve(ok({ items: [event1, event2] }));
      if (url.includes('work')) return Promise.resolve(ok({ items: [event1] })); // e1 is duplicate
      return Promise.resolve(ok({ items: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const events = await listAllEvents(1, '2025-04-17T00:00:00Z', '2025-04-17T23:59:59Z', 10);
    expect(events).toHaveLength(2); // deduped
    expect(events.map(e => e.id)).toEqual(['e1', 'e2']); // sorted by start

    const oauthCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('oauth2.googleapis.com'));
    expect(oauthCalls).toHaveLength(1);
  });
});

describe('createEvent', () => {
  it('sends POST and returns created event', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const createdRaw = {
      id: 'new-evt',
      summary: 'Митинг',
      start: { dateTime: '2025-04-17T14:00:00Z' },
      end: { dateTime: '2025-04-17T15:00:00Z' },
    };
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'at' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue(createdRaw) });

    const event = await createEvent(1, { summary: 'Митинг', start: '2025-04-17T14:00:00Z', end: '2025-04-17T15:00:00Z' });
    expect(event.id).toBe('new-evt');
    expect(event.summary).toBe('Митинг');

    // Verify POST was used
    const [, options] = fetchMock.mock.calls[1];
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.summary).toBe('Митинг');
  });
});

describe('updateEvent', () => {
  it('sends PATCH with only changed fields', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'at' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({
        id: 'evt1', summary: 'Обновлено', start: { dateTime: '2025-04-17T10:00:00Z' }, end: { dateTime: '2025-04-17T11:00:00Z' },
      }) });

    await updateEvent(1, 'evt1', { summary: 'Обновлено' });

    const [, options] = fetchMock.mock.calls[1];
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body);
    expect(body).toEqual({ summary: 'Обновлено' }); // only changed fields
    expect(body.start).toBeUndefined();
  });
});

describe('deleteEvent', () => {
  it('sends DELETE and resolves without error on 204', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'at' }) })
      .mockResolvedValueOnce({ ok: true, status: 204, json: vi.fn().mockResolvedValue({}) });

    await expect(deleteEvent(1, 'evt1')).resolves.toBeUndefined();

    const [, options] = fetchMock.mock.calls[1];
    expect(options.method).toBe('DELETE');
  });

  it('throws error on 403 from Google', async () => {
    mockFindById.mockResolvedValue({ googleRefreshToken: 'rt' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ access_token: 'at' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: vi.fn().mockResolvedValue({ error: { message: 'Forbidden' } }) });

    await expect(deleteEvent(1, 'evt1')).rejects.toThrow('Calendar API');
  });
});
