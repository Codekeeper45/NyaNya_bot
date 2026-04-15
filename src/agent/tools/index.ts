import type { OrchestratorInput } from '../orchestrator.js';
import { messagingTools } from './messaging.js';
import { memoryTools } from './memory.js';
import { profileTools } from './profile.js';
import { scheduleTools } from './schedule.js';
import { subagentTools } from './subagent.js';
import { mcpCalendarTools } from './mcp.js';

export function allTools(ctx: OrchestratorInput) {
  return {
    ...messagingTools(ctx.telegramChatId, ctx.userId),
    ...memoryTools(ctx.telegramUserId),
    ...profileTools(ctx.userId),
    ...scheduleTools(ctx.userId, ctx.telegramUserId, ctx.telegramChatId),
    ...subagentTools(),
    ...mcpCalendarTools(),
  };
}
