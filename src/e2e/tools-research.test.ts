// T-38..T-44: weather, maps, web search tools
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  webSearch: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../research/search.js', () => ({
  webSearch: mocks.webSearch,
}));

vi.mock('../db/client.js', () => ({ db: {} }));

vi.stubGlobal('fetch', mocks.fetch);

import { weatherTools } from '../agent/tools/weather.js';
import { mapsTools } from '../agent/tools/maps.js';

describe('T-38: weather_get_forecast tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns city + sources from web search', async () => {
    mocks.webSearch.mockResolvedValue([
      { title: 'Погода в Алматы', url: 'https://example.com', snippet: 'Сегодня 20°C' },
    ]);

    const tools = weatherTools();
    const result = await tools.weather_get_forecast.execute({ city: 'Алматы', date: '2025-04-18' }, {} as any);

    expect(mocks.webSearch).toHaveBeenCalledWith(expect.stringContaining('Алматы'), expect.any(Number));
    expect(result).toMatchObject({ city: 'Алматы', sources: expect.any(Array) });
  });

  it('returns error when search returns nothing', async () => {
    mocks.webSearch.mockResolvedValue([]);
    const tools = weatherTools();
    const result = await tools.weather_get_forecast.execute({ city: 'Нигде', date: '2025-04-18' }, {} as any);
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

describe('T-39: maps_search_place tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns search results from Nominatim', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ([
        { display_name: 'Алматы, Казахстан', lat: '43.2', lon: '76.9', type: 'city', importance: 0.9 },
      ]),
    });

    const tools = mapsTools();
    const result = await tools.maps_search_place.execute({ query: 'Алматы', limit: 3 }, {} as any);

    expect(result).toMatchObject({
      results: [expect.objectContaining({ name: expect.stringContaining('Алматы') })],
    });
  });

  it('returns not found message when no results', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ([]) });
    const tools = mapsTools();
    const result = await tools.maps_search_place.execute({ query: 'xyzabc123', limit: 3 }, {} as any);
    expect(result).toMatchObject({ message: expect.any(String) });
  });

  it('returns error on fetch failure', async () => {
    mocks.fetch.mockRejectedValue(new Error('Network error'));
    const tools = mapsTools();
    const result = await tools.maps_search_place.execute({ query: 'Алматы', limit: 3 }, {} as any);
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

describe('T-40: maps_get_route tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns route distance and duration', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [{
          distance: 5000,
          duration: 600,
          legs: [{ steps: [{ maneuver: { instruction: 'Поверните налево' } }] }],
        }],
      }),
    });

    const tools = mapsTools();
    const result = await tools.maps_get_route.execute(
      { startLat: '43.2', startLon: '76.9', endLat: '43.3', endLon: '77.0', profile: 'foot' },
      {} as any,
    );

    expect(result).toMatchObject({ distance: expect.stringContaining('км'), duration: expect.stringContaining('мин') });
  });
});

describe('T-41: maps_get_static_url tool', () => {
  it('returns OSM and Google Maps URLs', async () => {
    const tools = mapsTools();
    const result = await tools.maps_get_static_url.execute({ lat: '43.2', lon: '76.9', zoom: 15 }, {} as any);

    expect(result).toMatchObject({
      osmUrl: expect.stringContaining('openstreetmap.org'),
      googleMapsUrl: expect.stringContaining('google.com/maps'),
    });
  });
});
