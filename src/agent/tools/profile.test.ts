import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/repos/users.js', () => ({
  usersRepo: {
    findById: vi.fn(),
    update: vi.fn(),
  },
}));

import { usersRepo } from '../../db/repos/users.js';
import { profileTools } from './profile.js';

const mockFindById = usersRepo.findById as ReturnType<typeof vi.fn>;
const mockUpdate = usersRepo.update as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe('profile_get', () => {
  it('returns user profile from DB', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'Эмир',
      timezone: 'Asia/Almaty',
      wakeTime: '07:00',
      sleepTime: '23:00',
      preferences: { lang: 'ru' },
    });

    const tools = profileTools(1);
    const result = await tools.profile_get.execute({}, {} as never);

    expect(mockFindById).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      name: 'Эмир',
      timezone: 'Asia/Almaty',
      wakeTime: '07:00',
      sleepTime: '23:00',
      preferences: { lang: 'ru' },
    });
  });

  it('returns error when user not found', async () => {
    mockFindById.mockResolvedValue(null);

    const tools = profileTools(99);
    const result = await tools.profile_get.execute({}, {} as never);

    expect(result).toEqual({ error: 'User not found' });
  });
});

describe('profile_update', () => {
  it('calls usersRepo.update with provided fields and returns them', async () => {
    const tools = profileTools(1);
    const result = await tools.profile_update.execute({ name: 'Алия', timezone: 'Europe/Moscow' }, {} as never);

    expect(mockUpdate).toHaveBeenCalledWith(1, { name: 'Алия', timezone: 'Europe/Moscow' });
    expect(result).toEqual({ updated: true, fields: ['name', 'timezone'] });
  });

  it('only passes fields that are defined — skips undefined', async () => {
    const tools = profileTools(1);
    await tools.profile_update.execute({ wakeTime: '08:00' }, {} as never);

    expect(mockUpdate).toHaveBeenCalledWith(1, { wakeTime: '08:00' });
  });
});
