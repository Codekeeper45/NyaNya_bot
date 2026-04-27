import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../memory/archive-search.js', () => ({
  searchMemoryArchive: vi.fn(),
}));

import { searchMemoryArchive } from '../../memory/archive-search.js';
import { memoryArchiveTools } from './memory_archive.js';

const mockSearchMemoryArchive = searchMemoryArchive as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('memoryArchiveTools', () => {
  it('returns archive context when targeted memory search finds results', async () => {
    mockSearchMemoryArchive.mockResolvedValueOnce({
      found: true,
      context: 'Сохранённые факты:\n- Эмир занимается в Big Nation',
    });

    const tools = memoryArchiveTools(1);
    const result = await tools.memory_search_archive.execute({ query: 'спортзал' }, {} as never);

    expect(mockSearchMemoryArchive).toHaveBeenCalledWith(1, 'спортзал');
    expect(result).toEqual({
      found: true,
      context: 'Сохранённые факты:\n- Эмир занимается в Big Nation',
    });
  });

  it('returns a clear not-found message when archive has no matches', async () => {
    mockSearchMemoryArchive.mockResolvedValueOnce({ found: false, context: '' });

    const tools = memoryArchiveTools(1);
    const result = await tools.memory_search_archive.execute({ query: 'неизвестно' }, {} as never);

    expect(result).toEqual({
      found: false,
      context: 'Ничего не найдено в архивной памяти по этому запросу.',
    });
  });
});
