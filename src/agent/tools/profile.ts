import { tool } from 'ai';
import { z } from 'zod';
import { usersRepo } from '../../db/repos/users.js';

export function profileTools(userId: number) {
  return {
    profile_get: tool({
      description: 'Получить текущий профиль пользователя (имя, часовой пояс, расписание, предпочтения)',
      inputSchema: z.object({}),
      execute: async () => {
        const user = await usersRepo.findById(userId);
        if (!user) return { error: 'User not found' };
        return {
          name: user.name,
          timezone: user.timezone,
          wakeTime: user.wakeTime,
          sleepTime: user.sleepTime,
          preferences: user.preferences,
        };
      },
    }),

    profile_update: tool({
      description: 'Обновить профиль пользователя. Используй когда пользователь меняет имя, часовой пояс, расписание.',
      inputSchema: z.object({
        name: z.string().optional().describe('Новое имя'),
        timezone: z.string().optional().describe('Новый часовой пояс (например Asia/Almaty)'),
        wakeTime: z.string().optional().describe('Время подъёма в формате HH:mm'),
        sleepTime: z.string().optional().describe('Время сна в формате HH:mm'),
      }),
      execute: async (updates) => {
        const data: Record<string, unknown> = {};
        if (updates.name) data.name = updates.name;
        if (updates.timezone) data.timezone = updates.timezone;
        if (updates.wakeTime) data.wakeTime = updates.wakeTime;
        if (updates.sleepTime) data.sleepTime = updates.sleepTime;
        await usersRepo.update(userId, data);
        return { updated: true, fields: Object.keys(data) };
      },
    }),
  };
}
