import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../db/repos/lesson_plans.js', () => ({
  lessonPlansRepo: {
    create: vi.fn(),
    findByUser: vi.fn(),
    updateStatusForUser: vi.fn(),
  },
}));

import { lessonPlansRepo } from '../../db/repos/lesson_plans.js';
import { educationTools } from './education.js';

const mockCreate = lessonPlansRepo.create as ReturnType<typeof vi.fn>;
const mockFindByUser = lessonPlansRepo.findByUser as ReturnType<typeof vi.fn>;
const mockUpdateStatusForUser = lessonPlansRepo.updateStatusForUser as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('education_update_status', () => {
  it('updates status for own plan', async () => {
    mockUpdateStatusForUser.mockResolvedValue(true);

    const tools = educationTools(10);
    const result = await tools.education_update_status.execute({ planId: 5, status: 'completed' }, {} as never);

    expect(mockUpdateStatusForUser).toHaveBeenCalledWith(5, 10, 'completed');
    expect(result).toEqual({ success: true, message: 'Статус плана изменен на completed.' });
  });

  it('returns error if plan does not belong to user', async () => {
    mockUpdateStatusForUser.mockResolvedValue(false);

    const tools = educationTools(10);
    const result = await tools.education_update_status.execute({ planId: 77, status: 'archived' }, {} as never);

    expect(mockUpdateStatusForUser).toHaveBeenCalledWith(77, 10, 'archived');
    expect(result).toEqual({ success: false, error: 'План не найден или не принадлежит пользователю.' });
  });
});

describe('education_create_plan', () => {
  it('creates plan for current user', async () => {
    mockCreate.mockResolvedValue({ id: 1 });

    const tools = educationTools(10);
    const result = await tools.education_create_plan.execute(
      { subject: 'Math', topic: 'Algebra basics' },
      {} as never,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, subject: 'Math', topic: 'Algebra basics', status: 'active' }),
    );
    expect(result).toEqual({ success: true, planId: 1, message: 'Учебный план по теме «Algebra basics» создан.' });
  });
});

describe('education_list_plans', () => {
  it('lists plans for user', async () => {
    mockFindByUser.mockResolvedValue([{ id: 1, topic: 'A' }]);

    const tools = educationTools(10);
    const result = await tools.education_list_plans.execute({}, {} as never);

    expect(mockFindByUser).toHaveBeenCalledWith(10);
    expect(result).toEqual({ plans: [{ id: 1, topic: 'A' }] });
  });
});
