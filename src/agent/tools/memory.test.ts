import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/repos/messages.js', () => ({
  messagesRepo: {
    create: vi.fn(),
    getSavedFacts: vi.fn(),
  },
}));

import { messagesRepo } from '../../db/repos/messages.js';
import { memoryTools } from './memory.js';

const mockCreate = messagesRepo.create as ReturnType<typeof vi.fn>;
const mockGetSavedFacts = messagesRepo.getSavedFacts as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('memory_save', () => {
  it('skips saving a near-duplicate fact', async () => {
    mockGetSavedFacts.mockResolvedValueOnce([
      { content: 'Факт о пользователе: Эмир ходит в спортзал Big Nation' },
    ]);

    const result = await memoryTools(1).memory_save.execute(
      { fact: 'посещает спортзал Big Nation', category: 'preference' },
      {} as never,
    );

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ saved: false, duplicate: true });
  });
});
