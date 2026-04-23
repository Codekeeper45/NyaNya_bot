import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config.js';
import { buildSystemPrompt } from './prompts/system.js';
import { buildProactivePrompt } from './prompts/proactive.js';
import { graphRag } from '../graphrag/index.js';
import { messagesRepo } from '../db/repos/messages.js';
import { listRepeatingJobs } from '../scheduler/jobs.js';
import { allTools } from './tools/index.js';
import { bot } from '../bot/bot.js';
import { markdownToHtml } from './tools/messaging.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('orchestrator');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });
const ORCHESTRATOR_TIMEOUT_MS = 120_000;
const ORCHESTRATOR_TIMEOUT_TEXT = 'Извини, запрос получился слишком объёмным. Я сократила исследование и готова ответить точнее, если сузим тему.';

/**
 * Some models (e.g. gemma) output tool calls as raw text using special tokens
 * like `message_send_text{text:<|"|>...<|"|>}<tool_call|>` instead of structured calls.
 * This function tries to extract the human-readable text from such output,
 * or returns null if the text is pure tool-call syntax with no useful content.
 */
function extractCleanText(raw: string): string | null {
  // Try to extract text from gemma-style: message_send_text{text:<|"|>CONTENT<|"|>}
  const gemmaMatch = raw.match(/message_send_(?:text|voice)\{[^}]*?text[:\s]*<\|"\|>([\s\S]*?)<\|"\|>/);
  if (gemmaMatch?.[1]?.trim()) return gemmaMatch[1].trim();

  // Strip known tool-call tokens and check what remains
  const stripped = raw
    .replace(/message_send_\w+\{[\s\S]*?\}/g, '')
    .replace(/<\|"\|>/g, '')
    .replace(/<\|tool_call\|>/g, '')
    .replace(/<tool_call\|?>/g, '')
    .replace(/\[TOOL_CALL\]/gi, '')
    .trim();

  // If stripping left meaningful text, return it
  if (stripped.length > 10) return stripped;

  return null;
}

/**
 * Skip GraphRAG retrieval for trivial messages to save latency and cost.
 */
function shouldRetrieveContext(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 15) return false;
  if (trimmed.startsWith('/')) return false;
  // Greetings and confirmations (Russian + basic English)
  const trivialPattern = /^(привет|ок|окей|да|нет|спасибо|благодарю|хай|здравствуй|пока|добрый|доброе|hi|hello|hey|ok|okay|yes|no|thanks|bye)\b/i;
  if (trivialPattern.test(trimmed)) return false;
  return true;
}

export interface OrchestratorInput {
  userId: number;
  telegramUserId: number;
  telegramChatId: number;
  userName: string;
  userTimezone: string;
  wakeTime?: string;
  sleepTime?: string;
  weekendWakeTime?: string;
  weekendSleepTime?: string;
  preferences?: Record<string, unknown>;
  mode: 'reactive' | 'proactive';
  userMessage?: string;
  images?: Array<{ data: string; mimeType: string }>;
  proactiveKind?: string;
  proactiveSchedulerId?: string;
  proactiveContext?: string;
  proactiveAttempt?: number;
  onboardingComplete?: boolean;
}

export async function runOrchestrator(input: OrchestratorInput): Promise<void> {
  // 1. Load recent message history from Postgres
  const recentMessages = await messagesRepo.getRecent(input.userId, 20);
  const messageHistory: ModelMessage[] = [...recentMessages].reverse().map(m => ({
    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: m.content,
  }));

  // 3. Build system prompt
  const now = new Date();
  const currentTime = now.toLocaleString('ru-RU', { timeZone: input.userTimezone });

  const repeatingJobs = await listRepeatingJobs(input.userId).catch(() => []);
  const activeJobs = repeatingJobs.length > 0
    ? repeatingJobs.map(j => `- ${j.name} (${j.cron})`).join('\n')
    : undefined;

  let systemPrompt = buildSystemPrompt({
    userName: input.userName,
    userId: input.userId,
    userTimezone: input.userTimezone,
    currentTime,
    wakeTime: input.wakeTime,
    sleepTime: input.sleepTime,
    weekendWakeTime: input.weekendWakeTime,
    weekendSleepTime: input.weekendSleepTime,
    preferences: input.preferences,
    activeJobs,
    onboardingComplete: input.onboardingComplete,
  });

  if (input.mode === 'proactive') {
    systemPrompt += '\n\n' + buildProactivePrompt(
      input.proactiveKind ?? 'unknown',
      input.proactiveContext ?? '',
      input.proactiveAttempt ?? 1,
    );
  }

  // 4. Prepare messages
  const messages: ModelMessage[] = [...messageHistory] as ModelMessage[];
  type UserContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; image: string; mimeType: string };

  if (input.userMessage) {
    let userMessageText = input.userMessage;

    // Auto-augment user query with GraphRAG context (if highly relevant — threshold filter in retrieval.ts)
    if (shouldRetrieveContext(input.userMessage)) {
      try {
        const graphContext = await graphRag.retrieve(input.userId, input.userMessage);
        if (graphContext && graphContext.trim().length > 0) {
          userMessageText = `[Релевантный контекст из памяти:\n${graphContext}\n]\n\n${input.userMessage}`;
        }
      } catch (err) {
        log.warn({ userId: input.userId, err }, 'GraphRAG auto-retrieval failed');
      }
    } else {
      log.debug({ userId: input.userId, query: input.userMessage }, 'Skipping GraphRAG retrieval — trivial message');
    }

    const userContent: UserContentPart[] = [{ type: 'text', text: userMessageText }];

    if (input.images && input.images.length > 0) {
      for (const img of input.images) {
        userContent.push({
          type: 'image',
          image: img.data,
          mimeType: img.mimeType,
        });
      }
    }

    messages.push({ role: 'user' as const, content: userContent });
    
    await messagesRepo.create({
      userId: input.userId,
      role: 'user',
      content: input.userMessage + (input.images && input.images.length > 0 ? ` [Изображений: ${input.images.length}]` : ''),
      source: input.images && input.images.length > 0 ? 'photo' : 'text',
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

  const { tools, wasSent, getOnboardingCompleted } = allTools(input);
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    log.warn({ userId: input.userId }, 'Orchestrator timeout reached, aborting');
    abortController.abort();
  }, ORCHESTRATOR_TIMEOUT_MS);

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: openrouter(config.primaryModel),
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(15),
      temperature: 0.7,
      abortSignal: abortController.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) throw err;
    log.warn({ userId: input.userId }, 'Orchestrator ended early by timeout');
    if (!wasSent()) {
      try {
        await bot.api.sendMessage(input.telegramChatId, markdownToHtml(ORCHESTRATOR_TIMEOUT_TEXT), { parse_mode: 'HTML' });
      } catch {
        await bot.api.sendMessage(input.telegramChatId, ORCHESTRATOR_TIMEOUT_TEXT);
      }
      await messagesRepo.create({
        userId: input.userId,
        role: 'assistant',
        content: ORCHESTRATOR_TIMEOUT_TEXT,
        source: 'text',
      });
    }
    return;
  } finally {
    clearTimeout(timeoutHandle);
  }

  // Log tool calls per step
  for (const [i, step] of result.steps.entries()) {
    for (const call of step.toolCalls ?? []) {
      const c = call as { toolName: string; input: unknown };
      log.info({
        userId: input.userId,
        step: i + 1,
        tool: c.toolName,
        input: JSON.stringify(c.input ?? {}).slice(0, 200),
      }, `→ tool call`);
    }
    for (const res of step.toolResults ?? []) {
      const r = res as { toolName: string; output: unknown };
      const preview = typeof r.output === 'object' && r.output !== null
        ? JSON.stringify(r.output).slice(0, 150)
        : String(r.output ?? '').slice(0, 150);
      log.info({
        userId: input.userId,
        step: i + 1,
        tool: r.toolName,
        output: preview,
      }, `← tool result`);
    }
  }

  log.info({ userId: input.userId, steps: result.steps.length, onboardingCompleted: getOnboardingCompleted() }, 'Orchestrator completed');

  // 6. Fallback: если модель не вызвала message_send_text — отправляем result.text напрямую
  if (!wasSent() && result.text?.trim()) {
    const clean = extractCleanText(result.text);
    if (clean) {
      log.warn({ userId: input.userId }, 'Model did not call message_send_text — sending extracted fallback text');
      try {
        await bot.api.sendMessage(input.telegramChatId, markdownToHtml(clean), { parse_mode: 'HTML' });
      } catch {
        await bot.api.sendMessage(input.telegramChatId, clean);
      }
      await messagesRepo.create({
        userId: input.userId,
        role: 'assistant',
        content: clean,
        source: 'text',
      });
    } else {
      log.warn({ userId: input.userId, raw: result.text.slice(0, 200) }, 'Fallback text contains only tool-call syntax — skipping send');
    }
  }

}
