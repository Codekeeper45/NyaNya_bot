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
          weekendWakeTime: user.weekendWakeTime,
          weekendSleepTime: user.weekendSleepTime,
          preferences: user.preferences,
          paused: user.paused,
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
          voice_name: z.string().optional().describe('Постоянный голос для озвучки (например Leda, Fenrir, Vindemiatrix)'),
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

    bot_settings_update: tool({
      description: `Обновить настройки поведения бота. Вызывай автоматически когда:
- Пользователь просит писать короче/подробнее → message_length
- Пользователь не отвечает на follow-up несколько раз → followup_max_attempts: 1 или 2
- Пользователь просит отвечать голосом → voice_default: true
- Пользователь просит поставить на паузу → paused: true
- Пользователь называет интересы, диету, темы → обновляй соответствующие поля`,
      inputSchema: z.object({
        voice_default: z.boolean().optional().describe('Отвечать голосом по умолчанию'),
        voice_name: z.string().optional().describe('Постоянный голос для озвучки (например Leda, Fenrir, Vindemiatrix)'),
        message_length: z.enum(['short', 'normal', 'detailed']).optional().describe('Длина ответов: short=кратко, normal=обычно, detailed=подробно'),
        followup_max_attempts: z.number().min(0).max(3).optional().describe('Глобальный лимит follow-up попыток (0–3)'),
        followup_by_kind: z.record(z.string(), z.number().min(0).max(3)).optional().describe('Лимиты follow-up по типу действия, например {"morning_greeting":1,"daily_planning":2}'),
        interests: z.array(z.string()).optional().describe('Интересы и хобби'),
        dietary: z.array(z.string()).optional().describe('Диетические ограничения'),
        study_subjects: z.array(z.string()).optional().describe('Темы для обучения'),
        paused: z.boolean().optional().describe('Поставить бота на паузу (не пишет первым)'),
      }),
      execute: async (settings) => {
        const user = await usersRepo.findById(userId);
        const existing = (user?.preferences ?? {}) as Record<string, unknown>;

        const { paused, ...prefFields } = settings;
        const newPrefs = { ...existing, ...Object.fromEntries(
          Object.entries(prefFields).filter(([, v]) => v !== undefined),
        ) };

        const data: Record<string, unknown> = { preferences: newPrefs };
        if (paused !== undefined) data.paused = paused;

        await usersRepo.update(userId, data as Partial<Omit<User, 'id' | 'createdAt'>>);
        return { updated: true, settings: { ...prefFields, ...(paused !== undefined ? { paused } : {}) } };
      },
    }),
  };
}
