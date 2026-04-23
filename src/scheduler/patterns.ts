import { jobExecutionsRepo } from '../db/repos/job_executions.js';
import { usersRepo } from '../db/repos/users.js';
import { repeatingJobsRepo } from '../db/repos/repeating_jobs.js';
import { messagesRepo } from '../db/repos/messages.js';
import { bot } from '../bot/bot.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('patterns');

export interface DetectedPattern {
  type: 'routine_skip_by_day' | 'followup_no_response' | 'followup_always_responds';
  userId: number;
  telegramChatId: number;
  schedulerId?: string;
  kind?: string;
  description: string;
  suggestedAction: string;
  confidence: number; // 0-1
}

async function detectRoutineSkipByDay(userId: number): Promise<DetectedPattern[]> {
  const patterns: DetectedPattern[] = [];
  const user = await usersRepo.findById(userId);
  if (!user) return patterns;

  const jobs = await repeatingJobsRepo.findByUser(userId);

  for (const job of jobs) {
    const stats = await jobExecutionsRepo.getSkipRateByDayOfWeek(userId, job.kind);
    for (const [day, { total, skipped }] of Object.entries(stats)) {
      if (total < 3) continue; // Need at least 3 data points
      const skipRate = skipped / total;
      if (skipRate > 0.7) {
        const dayNames = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
        patterns.push({
          type: 'routine_skip_by_day',
          userId,
          telegramChatId: user.telegramUserId,
          schedulerId: job.schedulerId,
          kind: job.kind,
          description: `Пропускает ${job.kind} в ${dayNames[Number(day)]} (${Math.round(skipRate * 100)}% случаев)`,
          suggestedAction: `Отключить ${job.schedulerId} по ${dayNames[Number(day)]}`,
          confidence: skipRate,
        });
      }
    }
  }

  return patterns;
}

async function detectFollowupPatterns(userId: number): Promise<DetectedPattern[]> {
  const patterns: DetectedPattern[] = [];
  const user = await usersRepo.findById(userId);
  if (!user) return patterns;

  const stats = await jobExecutionsRepo.getFollowupResponseStats(userId);
  if (stats.length === 0) return patterns;

  // Check if user never responds to attempt 2+ followups
  const attempt2 = stats.find(s => s.attempt === 2);
  const attempt3 = stats.find(s => s.attempt === 3);

  if (attempt2 && attempt2.total >= 3 && attempt2.replied === 0) {
    patterns.push({
      type: 'followup_no_response',
      userId,
      telegramChatId: user.telegramUserId,
      description: 'Никогда не отвечает на второй follow-up',
      suggestedAction: 'Уменьшить followup_max_attempts до 1',
      confidence: Math.min(attempt2.total / 10, 0.95),
    });
  }

  if (attempt2 && attempt2.total >= 3 && attempt2.replied === attempt2.total) {
    patterns.push({
      type: 'followup_always_responds',
      userId,
      telegramChatId: user.telegramUserId,
      description: 'Всегда отвечает на второй follow-up',
      suggestedAction: 'Оставить followup_max_attempts как есть или увеличить до 3',
      confidence: Math.min(attempt2.total / 10, 0.95),
    });
  }

  return patterns;
}

async function detectPatternsForUser(userId: number): Promise<DetectedPattern[]> {
  const [routinePatterns, followupPatterns] = await Promise.all([
    detectRoutineSkipByDay(userId),
    detectFollowupPatterns(userId),
  ]);
  return [...routinePatterns, ...followupPatterns];
}

async function sendPatternSuggestion(pattern: DetectedPattern): Promise<void> {
  const user = await usersRepo.findById(pattern.userId);
  if (!user) return;

  // Check if we already sent a suggestion for this pattern recently (within 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentMessages = await messagesRepo.getRecent(pattern.userId, 50);
  const alreadySuggested = recentMessages.some(m =>
    m.role === 'assistant' &&
    new Date(m.createdAt) > sevenDaysAgo &&
    m.content.includes('Заметила, что')
  );
  if (alreadySuggested) {
    log.info({ userId: pattern.userId, type: pattern.type }, 'Pattern suggestion already sent recently');
    return;
  }

  let text: string;
  if (pattern.type === 'routine_skip_by_day') {
    text = `Заметила, что ты часто пропускаешь ${pattern.kind} ${pattern.description.split('в ')[1]?.split(' (')[0] ?? ''}. Хочешь, уберу это напоминание в этот день?`;
  } else if (pattern.type === 'followup_no_response') {
    text = 'Заметила, что ты обычно отвечаешь сразу, а повторные напоминания пропускаешь. Может, оставлю только одно напоминание? Так будет меньше спама.';
  } else if (pattern.type === 'followup_always_responds') {
    text = 'Заметила, что ты отвечаешь даже на повторные напоминания. Может, стоит оставить 2-3 попытки — так точно не пропустишь важное?';
  } else {
    text = `Заметила паттерн: ${pattern.description}. Что думаешь?`;
  }

  try {
    await bot.api.sendMessage(pattern.telegramChatId, text);
    await messagesRepo.create({
      userId: pattern.userId,
      role: 'assistant',
      content: text,
      source: 'text',
      metadata: { pattern_suggestion: pattern.type, confidence: pattern.confidence },
    });
    log.info({ userId: pattern.userId, type: pattern.type }, 'Pattern suggestion sent');
  } catch (err) {
    log.error({ err, userId: pattern.userId }, 'Failed to send pattern suggestion');
  }
}

export async function runDailyPatternDetection(): Promise<void> {
  log.info('Running daily pattern detection');
  const allUsers = await usersRepo.findAllActive();
  for (const user of allUsers) {
    try {
      const patterns = await detectPatternsForUser(user.id);
      for (const pattern of patterns) {
        if (pattern.confidence > 0.7) {
          await sendPatternSuggestion(pattern);
        }
      }
    } catch (err) {
      log.error({ err, userId: user.id }, 'Pattern detection failed for user');
    }
  }
  log.info('Daily pattern detection completed');
}
