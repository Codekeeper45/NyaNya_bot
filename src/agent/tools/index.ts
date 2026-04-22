import type { OrchestratorInput } from '../orchestrator.js';
import { messagingTools } from './messaging.js';
import { memoryTools } from './memory.js';
import { profileTools } from './profile.js';
import { scheduleTools } from './schedule.js';
import { subagentTools } from './subagent.js';
import { mcpCalendarTools } from './mcp.js';
import { educationTools } from './education.js';
import { weatherTools } from './weather.js';
import { mapsTools } from './maps.js';
import { researchTools } from './research.js';
import { diagramTools } from './diagram.js';
import { habitTools } from './habits.js';
import { callTools } from './call.js';
import { expenseTools } from './expenses.js';
import { todoTools } from './todos.js';
import { planTools } from './plans.js';

export function allTools(ctx: OrchestratorInput) {
  const { tools: msgTools, wasSent } = messagingTools(ctx.telegramChatId, ctx.userId);

  let onboardingCompleted = false;
  const setOnboardingDone = () => { onboardingCompleted = true; };

  const tools = {
    ...msgTools,
    ...memoryTools(ctx.telegramUserId),
    ...profileTools(ctx.userId),
    ...scheduleTools(
      ctx.userId,
      ctx.telegramUserId,
      ctx.telegramChatId,
      ctx.userTimezone,
      setOnboardingDone,
      ctx.proactiveKind,
    ),
    ...educationTools(ctx.userId, ctx.telegramUserId, ctx.telegramChatId, ctx.userTimezone),
    ...weatherTools(),
    ...mapsTools(),
    ...researchTools(ctx.telegramChatId),
    ...diagramTools(ctx.telegramChatId),
    ...habitTools(ctx.userId, ctx.userTimezone),
    ...callTools(ctx.userId, ctx.telegramChatId, ctx.userName, ctx.userTimezone),
    ...subagentTools(),
    ...mcpCalendarTools(ctx.userId, ctx.userTimezone),
    ...expenseTools(ctx.userId, ctx.userTimezone),
    ...todoTools(ctx.userId, ctx.userTimezone),
    ...planTools(ctx.userId, ctx.telegramUserId, ctx.telegramChatId, ctx.userTimezone),
  };

  return { tools, wasSent, getOnboardingCompleted: () => onboardingCompleted };
}
