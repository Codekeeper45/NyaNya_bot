// T-33..T-37: profile_get, profile_update tool execution
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeUser, TEST_DB_USER_ID } from '../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: { findById: mocks.findById, update: mocks.update },
}));

vi.mock('../db/client.js', () => ({ db: {} }));

import { profileTools } from '../agent/tools/profile.js';

describe('T-33: profile_get returns current profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser({}));
    mocks.findById.mockResolvedValue(makeUser({}));
  });

  it('returns user fields', async () => {
    const tools = profileTools(TEST_DB_USER_ID);
    const result = await tools.profile_get.execute({}, {} as any);
    expect(result).toMatchObject({
      name: 'Тест',
      timezone: 'Asia/Almaty',
    });
  });

  it('returns error when user not found', async () => {
    mocks.findById.mockResolvedValue(null);
    const tools = profileTools(TEST_DB_USER_ID);
    const result = await tools.profile_get.execute({}, {} as any);
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

describe('T-34: profile_update saves changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser({}));
    mocks.findById.mockResolvedValue(makeUser({}));
  });

  it('updates name', async () => {
    const tools = profileTools(TEST_DB_USER_ID);
    const result = await tools.profile_update.execute({ name: 'Новое Имя' }, {} as any);
    expect(mocks.update).toHaveBeenCalledWith(TEST_DB_USER_ID, expect.objectContaining({ name: 'Новое Имя' }));
    expect(result).toMatchObject({ updated: true });
  });

  it('merges preferences with existing', async () => {
    mocks.findById.mockResolvedValue(makeUser({ preferences: { dietary: ['vegan'] } as any }));
    const tools = profileTools(TEST_DB_USER_ID);
    await tools.profile_update.execute({ preferences: { voice_default: true } }, {} as any);

    expect(mocks.update).toHaveBeenCalledWith(
      TEST_DB_USER_ID,
      expect.objectContaining({
        preferences: expect.objectContaining({ dietary: ['vegan'], voice_default: true }),
      }),
    );
  });

  it('updates timezone', async () => {
    const tools = profileTools(TEST_DB_USER_ID);
    await tools.profile_update.execute({ timezone: 'Europe/Moscow' }, {} as any);
    expect(mocks.update).toHaveBeenCalledWith(TEST_DB_USER_ID, expect.objectContaining({ timezone: 'Europe/Moscow' }));
  });
});
