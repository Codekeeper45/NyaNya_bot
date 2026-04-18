import { tool } from 'ai';
import { z } from 'zod';
import { usersRepo } from '../../db/repos/users.js';
import type { User } from '../../db/schema.js';

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
      description: 'Обновить профиль пользователя. Используй когда пользователь меняет имя, часовой пояс, расписание или предпочтения.',
      inputSchema: z.object({
        name: z.string().optional().describe('Новое имя'),
        phoneNumber: z.string().optional().describe('Номер телефона для звонков в формате +7XXXXXXXXXX'),
        timezone: z.string().optional().describe('Новый часовой пояс (например Asia/Almaty)'),
        wakeTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Время подъёма в формате HH:mm (например 08:00)'),
        sleepTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Время сна в формате HH:mm (например 23:00)'),
        preferences: z.object({
          voice_default: z.boolean().optional().describe('Отвечать голосом по умолчанию'),
          dietary: z.array(z.string()).optional().describe('Диетические ограничения/предпочтения'),
          interests: z.array(z.string()).optional().describe('Интересы и хобби'),
          study_subjects: z.array(z.string()).optional().describe('Темы для обучения'),
        }).optional().describe('Предпочтения пользователя'),
      }),
      execute: async (updates) => {
        const data: Record<string, unknown> = {};
        if (updates.name) data.name = updates.name;
        if (updates.phoneNumber) data.phoneNumber = updates.phoneNumber;
        if (updates.timezone) data.timezone = updates.timezone;
        if (updates.wakeTime) data.wakeTime = updates.wakeTime;
        if (updates.sleepTime) data.sleepTime = updates.sleepTime;
        if (updates.preferences) {
          const current = await usersRepo.findById(userId);
          const existing = (current?.preferences ?? {}) as Record<string, unknown>;
          data.preferences = { ...existing, ...updates.preferences };
        }
        await usersRepo.update(userId, data as Partial<Omit<User, 'id' | 'createdAt'>>);
        return { updated: true, fields: Object.keys(data) };
      },
    }),
  };
}
