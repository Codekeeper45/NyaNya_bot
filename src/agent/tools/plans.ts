import { tool } from 'ai';
import { z } from 'zod';
import { scheduleRepeatingJob, cancelRepeatingJob } from '../../scheduler/jobs.js';
import { repeatingJobsRepo } from '../../db/repos/repeating_jobs.js';
import { createChildLogger } from '../../lib/logger.js';
import type { JobPayload } from '../../scheduler/jobs.js';

const log = createChildLogger('tool:plans');

const PLAN_PREFIX = (userId: number) => `user-${userId}-plan-`;

function slugify(name: string): string {
  const cyrillicMap: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
    к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
    х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  };
  return name.toLowerCase()
    .split('').map(c => cyrillicMap[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function buildCron(days: number[], time: string): string {
  const [h, m] = time.split(':').map(Number);
  const daysPart = days.length === 0 || days.length === 7 ? '*' : days.sort().join(',');
  return `${m} ${h} * * ${daysPart}`;
}

function cronToHuman(cron: string): string {
  const [m, h, , , daysPart] = cron.split(' ');
  const time = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (daysPart === '*') return `каждый день в ${time}`;
  const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const days = daysPart.split(',').map(d => dayNames[Number(d)] ?? d).join(', ');
  return `${days} в ${time}`;
}

function parseDaysFromCron(cron: string): number[] {
  const daysPart = cron.split(' ')[4];
  if (daysPart === '*') return [];
  return daysPart.split(',').map(Number);
}

function parseTimeFromCron(cron: string): string {
  const [m, h] = cron.split(' ');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

export function planTools(userId: number, telegramUserId: number, telegramChatId: number, userTimezone: string) {
  const prefix = PLAN_PREFIX(userId);

  return {
    plan_create: tool({
      description: 'Создать именованный повторяющийся план. WHEN: пользователь даёт имя активности ("тренировка", "чтение", "медитация"). CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { created: true, id, name, schedule, cron }. Дни: 0=вс..6=сб. Пустой массив = каждый день. NEVER: для безымянных напоминаний используй schedule_repeating.',
      inputSchema: z.object({
        name: z.string().max(60).describe('Название плана (например "Тренировка", "Чтение")'),
        message: z.string().describe('Что напомнить / о чём написать'),
        days: z.array(z.number().min(0).max(6)).describe('Дни недели (пустой = каждый день)'),
        time: z.string().regex(/^\d{2}:\d{2}$/).describe('Время HH:MM'),
      }),
      execute: async ({ name, message, days, time }) => {
        const slug = slugify(name);
        const schedulerId = `${prefix}${slug}`;

        const existing = (await repeatingJobsRepo.findByUser(userId))
          .find(j => j.schedulerId === schedulerId);
        if (existing) {
          return { error: `План с именем "${name}" уже существует. Используй plan_update для изменения.` };
        }

        const cron = buildCron(days, time);
        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId,
          kind: 'custom_reminder',
          context: message,
          metadata: { planName: name },
        };

        await scheduleRepeatingJob(schedulerId, payload, cron, userTimezone);
        log.info({ userId, schedulerId, cron, name }, 'Plan created');
        return { created: true, id: schedulerId, name, schedule: cronToHuman(cron), cron };
      },
    }),

    plan_list: tool({
      description: 'Показать все планы. WHEN: перед изменением/удалением плана, или по запросу. CHAIN: ВСЕГДА первый шаг перед plan_update/plan_delete. RETURNS: { count, plans: [{ id, name, message, schedule, cron }] }.',
      inputSchema: z.object({}),
      execute: async () => {
        const all = await repeatingJobsRepo.findByUser(userId);
        const plans = all.filter(j => j.schedulerId.startsWith(prefix));
        return {
          count: plans.length,
          plans: plans.map(p => {
            const payload = p.payload as Record<string, unknown>;
            const meta = (payload.metadata as Record<string, unknown> | undefined) ?? {};
            return {
              id: p.schedulerId,
              name: (meta.planName as string | undefined) ?? p.schedulerId.replace(prefix, ''),
              message: payload.context as string,
              schedule: cronToHuman(p.cronPattern),
              cron: p.cronPattern,
            };
          }),
        };
      },
    }),

    plan_update: tool({
      description: 'Изменить план. WHEN: пользователь хочет поменять время/дни/текст плана. CHAIN: plan_list (найди id) → этот инструмент → message_send_text. RETURNS: { updated: true, id, schedule }. NEVER: не угадывай ID — бери только из plan_list.',
      inputSchema: z.object({
        id: z.string().describe('ID плана — только из plan_list, не придумывай'),
        name: z.string().optional().describe('Новое название'),
        message: z.string().optional().describe('Новый текст напоминания'),
        days: z.array(z.number().min(0).max(6)).optional().describe('Новые дни недели'),
        time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Новое время HH:MM'),
      }),
      execute: async ({ id, name, message, days, time }) => {
        if (!id.startsWith(prefix)) {
          return { error: 'Unauthorized' };
        }
        const all = await repeatingJobsRepo.findByUser(userId);
        const existing = all.find(j => j.schedulerId === id);
        if (!existing) return { error: 'Plan not found' };

        const payload = existing.payload as Record<string, unknown>;
        const meta = ((payload.metadata as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

        const newCron = (days !== undefined || time !== undefined)
          ? buildCron(
              days ?? parseDaysFromCron(existing.cronPattern),
              time ?? parseTimeFromCron(existing.cronPattern),
            )
          : existing.cronPattern;

        const newPayload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId,
          kind: 'custom_reminder',
          context: message ?? (payload.context as string),
          metadata: { ...meta, ...(name ? { planName: name } : {}) },
        };

        await cancelRepeatingJob(id);
        await scheduleRepeatingJob(id, newPayload, newCron, userTimezone);
        log.info({ userId, id, newCron }, 'Plan updated');
        return { updated: true, id, schedule: cronToHuman(newCron) };
      },
    }),

    plan_delete: tool({
      description: 'Удалить план. WHEN: пользователь просит удалить. CHAIN: plan_list (найди id) → этот инструмент → message_send_text. RETURNS: { deleted: true, id }. NEVER: не угадывай ID — бери только из plan_list.',
      inputSchema: z.object({
        id: z.string().describe('ID плана — только из plan_list, не придумывай'),
      }),
      execute: async ({ id }) => {
        if (!id.startsWith(prefix)) return { error: 'Unauthorized' };
        await cancelRepeatingJob(id);
        log.info({ userId, id }, 'Plan deleted');
        return { deleted: true, id };
      },
    }),
  };
}
