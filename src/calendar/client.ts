import { config } from '../config.js';
import { usersRepo } from '../db/repos/users.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('calendar');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

async function handleCalendarResponse(res: Response, userId: number): Promise<Record<string, unknown>> {
  const data = await res.json() as Record<string, unknown>;
  if (res.status === 401) {
    await usersRepo.update(userId, { googleRefreshToken: null });
    throw new Error('GOOGLE_AUTH_REVOKED');
  }
  if (!res.ok) throw new Error(`Calendar API: ${JSON.stringify(data.error)}`);
  return data;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Не удалось получить access token: ${data.error_description ?? data.error}`);
  return data.access_token as string;
}

export async function getRefreshToken(userId: number): Promise<string | null> {
  const user = await usersRepo.findById(userId);
  return user?.googleRefreshToken ?? null;
}

interface CalendarEvent {
  id: string;
  iCalUID?: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  calendarId?: string;
}

interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

async function listCalendarsWithAccessToken(userId: number, accessToken: string): Promise<CalendarInfo[]> {
  const res = await fetch(`${CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleCalendarResponse(res, userId);

  const items = (data.items as Array<Record<string, unknown>>) ?? [];
  return items.map(item => ({
    id: item.id as string,
    summary: (item.summary as string) ?? '(без названия)',
    primary: item.primary as boolean | undefined,
    accessRole: (item.accessRole as string) ?? 'reader',
  }));
}

// ─── Calendars ────────────────────────────────────────────────

export async function listCalendars(userId: number): Promise<CalendarInfo[]> {
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) throw new Error('Google Calendar не подключён. Используй /gcal');

  const accessToken = await getAccessToken(refreshToken);
  return listCalendarsWithAccessToken(userId, accessToken);
}

// ─── Events ───────────────────────────────────────────────────

function parseEvent(item: Record<string, unknown>, calendarId?: string): CalendarEvent {
  return {
    id: item.id as string,
    iCalUID: item.iCalUID as string | undefined,
    summary: (item.summary as string) ?? '(без названия)',
    start: ((item.start as Record<string, string>)?.dateTime ?? (item.start as Record<string, string>)?.date) ?? '',
    end: ((item.end as Record<string, string>)?.dateTime ?? (item.end as Record<string, string>)?.date) ?? '',
    description: item.description as string | undefined,
    location: item.location as string | undefined,
    calendarId,
  };
}

async function listEventsWithAccessToken(
  userId: number,
  accessToken: string,
  timeMin: string,
  timeMax: string,
  maxResults = 10,
  calendarId = 'primary',
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleCalendarResponse(res, userId);

  return ((data.items as Array<Record<string, unknown>>) ?? []).map(e => parseEvent(e, calendarId));
}

export async function createEvent(
  userId: number,
  event: { summary: string; start: string; end: string; description?: string; location?: string; timeZone?: string },
  calendarId = 'primary',
): Promise<CalendarEvent> {
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) throw new Error('Google Calendar не подключён. Используй /gcal');

  const accessToken = await getAccessToken(refreshToken);
  const normalizedStart = event.start.includes('T') ? event.start : `${event.start}T00:00:00`;
  const normalizedEnd = event.end.includes('T') ? event.end : `${event.end}T00:00:00`;
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: normalizedStart, timeZone: event.timeZone },
      end: { dateTime: normalizedEnd, timeZone: event.timeZone },
    }),
  });
  const data = await handleCalendarResponse(res, userId);
  log.info({ userId, summary: event.summary }, 'Calendar event created');
  return parseEvent(data, calendarId);
}

export async function updateEvent(
  userId: number,
  eventId: string,
  patch: { summary?: string; start?: string; end?: string; description?: string; location?: string; timeZone?: string },
  calendarId = 'primary',
): Promise<CalendarEvent> {
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) throw new Error('Google Calendar не подключён. Используй /gcal');

  const accessToken = await getAccessToken(refreshToken);
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.start !== undefined) {
    const s = patch.start.includes('T') ? patch.start : `${patch.start}T00:00:00`;
    body.start = { dateTime: s, timeZone: patch.timeZone };
  }
  if (patch.end !== undefined) {
    const e = patch.end.includes('T') ? patch.end : `${patch.end}T00:00:00`;
    body.end = { dateTime: e, timeZone: patch.timeZone };
  }

  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await handleCalendarResponse(res, userId);
  log.info({ userId, eventId }, 'Calendar event updated');
  return parseEvent(data, calendarId);
}

export async function listAllEvents(
  userId: number,
  timeMin: string,
  timeMax: string,
  maxResults = 20,
): Promise<CalendarEvent[]> {
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) throw new Error('Google Calendar не подключён. Используй /gcal');

  const accessToken = await getAccessToken(refreshToken);
  const calendars = await listCalendarsWithAccessToken(userId, accessToken);
  const results = await Promise.all(
    calendars.map(cal =>
      listEventsWithAccessToken(userId, accessToken, timeMin, timeMax, maxResults, cal.id).catch(() => [] as CalendarEvent[])
    )
  );
  const seen = new Set<string>();
  const merged: CalendarEvent[] = [];
  for (const events of results) {
    for (const ev of events) {
      // Prefer iCalUID for cross-calendar dedupe; fallback keeps same-id events with different time ranges.
      const uniqueEventKey = ev.iCalUID
        ? `ical:${ev.iCalUID}:${ev.start}`
        : `evt:${ev.id}:${ev.start}:${ev.end}`;
      if (!seen.has(uniqueEventKey)) {
        seen.add(uniqueEventKey);
        merged.push(ev);
      }
    }
  }
  return merged.sort((a, b) => a.start.localeCompare(b.start));
}

export async function deleteEvent(userId: number, eventId: string, calendarId = 'primary'): Promise<void> {
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) throw new Error('Google Calendar не подключён. Используй /gcal');

  const accessToken = await getAccessToken(refreshToken);
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    await usersRepo.update(userId, { googleRefreshToken: null });
    throw new Error('GOOGLE_AUTH_REVOKED');
  }
  if (!res.ok && res.status !== 204) {
    const data = await res.json() as Record<string, unknown>;
    throw new Error(`Calendar API: ${JSON.stringify(data.error)}`);
  }
  log.info({ userId, eventId }, 'Calendar event deleted');
}
