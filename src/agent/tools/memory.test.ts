import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../memory/mem0.js', () => ({
  mem0: {
    search: vi.fn(),
    add: vi.fn(),
  },
}));

import { mem0 } from '../../memory/mem0.js';
import { memoryTools } from './memory.js';

const mockSearch = mem0.search as ReturnType<typeof vi.fn>;
const mockAdd = mem0.add as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('memory_search', () => {
  it('returns array of memory strings', async () => {
    mockSearch.mockResolvedValue([
      { memory: 'Любит чай' },
      { memory: 'Встаёт в 7:00' },
    ]);

    const tools = memoryTools(42);
    const result = await tools.memory_search.execute({ query: 'утренние привычки' }, {} as never);

    expect(mockSearch).toHaveBeenCalledWith('утренние привычки', '42');
    expect(result).toEqual({ memories: ['Любит чай', 'Встаёт в 7:00'] });
  });

  it('returns empty array when mem0 returns empty', async () => {
    mockSearch.mockResolvedValue([]);

    const tools = memoryTools(42);
    const result = await tools.memory_search.execute({ query: 'что-то неизвестное' }, {} as never);

    expect(result).toEqual({ memories: [] });
  });
});

describe('memory_save', () => {
  it('calls mem0.add with formatted fact string', async () => {
    mockAdd.mockResolvedValue(null);

    const tools = memoryTools(42);
    await tools.memory_save.execute({ fact: 'Не любит кофе' }, {} as never);

    expect(mockAdd).toHaveBeenCalledWith(
      [{ role: 'assistant', content: 'Важный факт: Не любит кофе' }],
      '42',
      undefined,
    );
  });

  it('passes category when provided', async () => {
    mockAdd.mockResolvedValue(null);

    const tools = memoryTools(42);
    await tools.memory_save.execute({ fact: 'Любит спорт', category: 'preference' }, {} as never);

    expect(mockAdd).toHaveBeenCalledWith(
      [{ role: 'assistant', content: 'Важный факт: Любит спорт' }],
      '42',
      { category: 'preference' },
    );
  });
});
