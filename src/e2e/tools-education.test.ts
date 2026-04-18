// T-45..T-48: education tools — create, list, update status
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_DB_USER_ID } from '../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: 42, subject: 'Python', topic: 'Циклы' }),
  findByUser: vi.fn().mockResolvedValue([]),
  updateStatusForUser: vi.fn().mockResolvedValue(true),
}));

vi.mock('../db/repos/lesson_plans.js', () => ({
  lessonPlansRepo: {
    create: mocks.create,
    findByUser: mocks.findByUser,
    updateStatusForUser: mocks.updateStatusForUser,
    getWeeklyStats: vi.fn().mockResolvedValue({ totalPlans: 0, completedPlans: 0 }),
  },
}));

vi.mock('../db/client.js', () => ({ db: {} }));

import { educationTools } from '../agent/tools/education.js';

describe('T-45: education_create_plan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates lesson plan and returns planId', async () => {
    mocks.create.mockResolvedValue({ id: 42, subject: 'Python', topic: 'Циклы' });
    const tools = educationTools(TEST_DB_USER_ID);
    const result = await tools.education_create_plan.execute(
      { subject: 'Python', topic: 'Циклы', plan: 'Шаг 1: for, Шаг 2: while' },
      {} as any,
    );

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TEST_DB_USER_ID, subject: 'Python', topic: 'Циклы' }),
    );
    expect(result).toMatchObject({ success: true, planId: 42 });
  });

  it('returns error on DB failure', async () => {
    mocks.create.mockRejectedValue(new Error('DB error'));
    const tools = educationTools(TEST_DB_USER_ID);
    const result = await tools.education_create_plan.execute(
      { subject: 'Python', topic: 'Ошибка' },
      {} as any,
    );
    expect(result).toMatchObject({ success: false, error: expect.any(String) });
  });
});

describe('T-46: education_list_plans', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty message when no plans', async () => {
    mocks.findByUser.mockResolvedValue([]);
    const tools = educationTools(TEST_DB_USER_ID);
    const result = await tools.education_list_plans.execute({}, {} as any);
    expect(result).toMatchObject({ message: expect.any(String) });
  });

  it('returns plans when present', async () => {
    mocks.findByUser.mockResolvedValue([
      { id: 1, subject: 'Python', topic: 'Циклы', status: 'active' },
    ]);
    const tools = educationTools(TEST_DB_USER_ID);
    const result = await tools.education_list_plans.execute({}, {} as any);
    expect((result as any).plans).toHaveLength(1);
  });
});

describe('T-47: education_update_status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks plan as completed', async () => {
    mocks.updateStatusForUser.mockResolvedValue(true);
    const tools = educationTools(TEST_DB_USER_ID);
    const result = await tools.education_update_status.execute(
      { planId: 42, status: 'completed' },
      {} as any,
    );

    expect(mocks.updateStatusForUser).toHaveBeenCalledWith(42, TEST_DB_USER_ID, 'completed');
    expect(result).toMatchObject({ success: true });
  });

  it('returns error when plan not found', async () => {
    mocks.updateStatusForUser.mockResolvedValue(false);
    const tools = educationTools(TEST_DB_USER_ID);
    const result = await tools.education_update_status.execute(
      { planId: 999, status: 'completed' },
      {} as any,
    );
    expect(result).toMatchObject({ success: false });
  });
});

describe('T-48: education plan ownership enforced', () => {
  it('updateStatusForUser is called with userId for ownership check', async () => {
    mocks.updateStatusForUser.mockResolvedValue(true);
    const tools = educationTools(TEST_DB_USER_ID);
    await tools.education_update_status.execute({ planId: 1, status: 'archived' }, {} as any);

    expect(mocks.updateStatusForUser).toHaveBeenCalledWith(1, TEST_DB_USER_ID, 'archived');
  });
});
