import { generateText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config.js';
import { buildSystemPrompt } from './prompts/system.js';
import { buildProactivePrompt } from './prompts/proactive.js';
import { mem0 } from '../memory/mem0.js';
import { messagesRepo } from '../db/repos/messages.js';
import { allTools } from './tools/index.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('orchestrator');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export interface OrchestratorInput {
  userId: number;
  telegramUserId: number;
  telegramChatId: number;
  userName: string;
  userTimezone: string;
  wakeTime?: string;
  sleepTime?: string;
  preferences?: Record<string, unknown>;
  mode: 'reactive' | 'proactive';
  userMessage?: string;
  proactiveKind?: string;
  proactiveContext?: string;
  proactiveAttempt?: number;
}

export async function runOrchestrator(input: OrchestratorInput): Promise<void> {
  const uid = String(input.telegramUserId);

  // 1. Search Mem0 for relevant context
  const query = input.userMessage ?? input.proactiveContext ?? '';
  const memoryResults = await mem0.search(query, uid);
  const memories = memoryResults.map((m: { memory?: string }) => m.memory ?? '').filter(Boolean);

  // 2. Load recent message history from Postgres
  const recentMessages = await messagesRepo.getRecent(input.userId, 20);
  const messageHistory = recentMessages.reverse().map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // 3. Build system prompt
  const now = new Date();
  const currentTime = now.toLocaleString('ru-RU', { timeZone: input.userTimezone });

  let systemPrompt = buildSystemPrompt({
    userName: input.userName,
    userTimezone: input.userTimezone,
    currentTime,
    memories,
    wakeTime: input.wakeTime,
    sleepTime: input.sleepTime,
    preferences: input.preferences,
  });

  if (input.mode === 'proactive') {
    systemPrompt += '\n\n' + buildProactivePrompt(
      input.proactiveKind ?? 'unknown',
      input.proactiveContext ?? '',
      input.proactiveAttempt ?? 1,
    );
  }

  // 4. Prepare messages
  const messages = [...messageHistory];
  if (input.userMessage) {
    messages.push({ role: 'user' as const, content: input.userMessage });
    await messagesRepo.create({
      userId: input.userId,
      role: 'user',
      content: input.userMessage,
      source: 'text',
    });
  }
  if (input.mode === 'proactive' && !input.userMessage) {
    messages.push({
      role: 'user' as const,
      content: `[SYSTEM: Proactive trigger — ${input.proactiveKind}: ${input.proactiveContext}]`,
    });
  }

  // 5. Run agent loop
  log.info({ userId: input.userId, mode: input.mode }, 'Starting orchestrator');

  const result = await generateText({
    model: openrouter(config.primaryModel),
    system: systemPrompt,
    messages,
    tools: allTools(input),
    stopWhen: stepCountIs(15),
    temperature: 0.7,
  });

  log.info({ userId: input.userId, steps: result.steps.length }, 'Orchestrator completed');

  // 6. Extract memories from conversation
  const conversationForMemory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (input.userMessage) {
    conversationForMemory.push({ role: 'user', content: input.userMessage });
  }
  for (const step of result.steps) {
    if (step.text) {
      conversationForMemory.push({ role: 'assistant', content: step.text });
    }
  }
  if (conversationForMemory.length > 0) {
    await mem0.add(conversationForMemory, uid);
  }
}
