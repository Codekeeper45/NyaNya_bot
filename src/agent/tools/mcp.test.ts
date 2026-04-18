import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../calendar/client.js', () => ({
  getRefreshToken: vi.fn(),
  listCalendars: vi.fn(),
  listAllEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

import {
  getRefreshToken,
  listCalendars,
  listAllEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from '../../calendar/client.js';
import { mcpCalendarTools } from './mcp.js';

const TZ = 'Asia/Almaty';

const mockGetToken = getRefreshToken as ReturnType<typeof vi.fn>;
const mockListCals = listCalendars as ReturnType<typeof vi.fn>;
const mockListAll = listAllEvents as ReturnType<typeof vi.fn>;
const mockCreate = createEvent as ReturnType<typeof vi.fn>;
const mockUpdate = updateEvent as ReturnType<typeof vi.fn>;
const mockDelete = deleteEvent as ReturnType<typeof vi.fn>;

const NOT_CONNECTED = { error: 'Google Calendar не подключён. Скажи пользователю использовать /gcal.' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('all calendar tools — NOT_CONNECTED when no refresh token', () => {
  beforeEach(() => {
    mockGetToken.mockResolvedValue(null);
  });

  it('gcal_list_calendars returns NOT_CONNECTED', async () => {
    const tools = mcpCalendarTools(1, TZ);
    expect(await tools.gcal_list_calendars.execute({}, {} as never)).toEqual(NOT_CONNECTED);
  });

  it('gcal_list_all_events returns NOT_CONNECTED', async () => {
    const tools = mcpCalendarTools(1, TZ);
    expect(await tools.gcal_list_all_events.execute({ timeMin: '2025-01-01T00:00:00Z', timeMax: '2025-01-02T00:00:00Z', maxResults: 10 }, {} as never)).toEqual(NOT_CONNECTED);
  });

  it('gcal_create_event returns NOT_CONNECTED', async () => {
    const tools = mcpCalendarTools(1, TZ);
    expect(await tools.gcal_create_event.execute({ summary: 'Test', start: '2025-01-01T10:00:00Z', end: '2025-01-01T11:00:00Z', calendarId: 'primary' }, {} as never)).toEqual(NOT_CONNECTED);
  });

  it('gcal_delete_event returns NOT_CONNECTED', async () => {
    const tools = mcpCalendarTools(1, TZ);
    expect(await tools.gcal_delete_event.execute({ eventId: 'abc', calendarId: 'primary' }, {} as never)).toEqual(NOT_CONNECTED);
  });
});

describe('gcal_list_calendars', () => {
  it('returns list of calendars when connected', async () => {
    mockGetToken.mockResolvedValue('refresh-token');
    mockListCals.mockResolvedValue([
      { id: 'primary', summary: 'Мой календарь', primary: true, accessRole: 'owner' },
    ]);

    const tools = mcpCalendarTools(1, TZ);
    const result = await tools.gcal_list_calendars.execute({}, {} as never);

    expect(result).toEqual({ calendars: [{ id: 'primary', summary: 'Мой календарь', primary: true, accessRole: 'owner' }] });
  });
});

describe('gcal_list_all_events', () => {
  it('returns events from all calendars', async () => {
    mockGetToken.mockResolvedValue('refresh-token');
    mockListAll.mockResolvedValue([
      { id: 'evt1', summary: 'Встреча', start: '2025-04-17T10:00:00Z', end: '2025-04-17T11:00:00Z' },
    ]);

    const tools = mcpCalendarTools(1, TZ);
    const result = await tools.gcal_list_all_events.execute(
      { timeMin: '2025-04-17T00:00:00Z', timeMax: '2025-04-17T23:59:59Z', maxResults: 20 },
      {} as never,
    );

    expect(mockListAll).toHaveBeenCalledWith(1, '2025-04-17T00:00:00Z', '2025-04-17T23:59:59Z', 20);
    expect(result).toEqual({ events: [{ id: 'evt1', summary: 'Встреча', start: '2025-04-17T10:00:00Z', end: '2025-04-17T11:00:00Z' }] });
  });

  it('returns empty message when no events', async () => {
    mockGetToken.mockResolvedValue('refresh-token');
    mockListAll.mockResolvedValue([]);

    const tools = mcpCalendarTools(1, TZ);
    const result = await tools.gcal_list_all_events.execute(
      { timeMin: '2025-04-17T00:00:00Z', timeMax: '2025-04-17T23:59:59Z', maxResults: 20 },
      {} as never,
    );

    expect(result).toEqual({ events: [], message: 'Событий в этот период нет.' });
  });
});

describe('gcal_create_event', () => {
  it('creates event and returns {created: true, event}', async () => {
    mockGetToken.mockResolvedValue('refresh-token');
    const createdEvent = { id: 'evt1', summary: 'Тренировка', start: '2025-04-17T09:00:00Z', end: '2025-04-17T10:00:00Z' };
    mockCreate.mockResolvedValue(createdEvent);

    const tools = mcpCalendarTools(1, TZ);
    const result = await tools.gcal_create_event.execute(
      { summary: 'Тренировка', start: '2025-04-17T09:00:00Z', end: '2025-04-17T10:00:00Z', calendarId: 'primary' },
      {} as never,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ summary: 'Тренировка' }),
      'primary',
    );
    expect(result).toEqual({ created: true, event: createdEvent });
  });
});

describe('gcal_update_event', () => {
  it('updates event with patch and returns {updated: true, event}', async () => {
    mockGetToken.mockResolvedValue('refresh-token');
    const updatedEvent = { id: 'evt1', summary: 'Новое название', start: '2025-04-17T09:00:00Z', end: '2025-04-17T10:00:00Z' };
    mockUpdate.mockResolvedValue(updatedEvent);

    const tools = mcpCalendarTools(1, TZ);
    const result = await tools.gcal_update_event.execute(
      { eventId: 'evt1', calendarId: 'primary', summary: 'Новое название' },
      {} as never,
    );

    expect(mockUpdate).toHaveBeenCalledWith(1, 'evt1', expect.objectContaining({ summary: 'Новое название' }), 'primary');
    expect(result).toEqual({ updated: true, event: updatedEvent });
  });
});

describe('gcal_delete_event', () => {
  it('deletes event and returns {deleted: true, eventId}', async () => {
    mockGetToken.mockResolvedValue('refresh-token');
    mockDelete.mockResolvedValue(undefined);

    const tools = mcpCalendarTools(1, TZ);
    const result = await tools.gcal_delete_event.execute({ eventId: 'evt1', calendarId: 'primary' }, {} as never);

    expect(mockDelete).toHaveBeenCalledWith(1, 'evt1', 'primary');
    expect(result).toEqual({ deleted: true, eventId: 'evt1' });
  });
});
