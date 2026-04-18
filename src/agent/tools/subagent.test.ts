import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../subagents/research.js', () => ({
  runResearchAgent: vi.fn(),
}));
vi.mock('../subagents/technical.js', () => ({
  runTechnicalAgent: vi.fn(),
}));

import { runResearchAgent } from '../subagents/research.js';
import { runTechnicalAgent } from '../subagents/technical.js';
import { subagentTools } from './subagent.js';

const mockResearch = runResearchAgent as ReturnType<typeof vi.fn>;
const mockTechnical = runTechnicalAgent as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subagent_research', () => {
  it('delegates to runResearchAgent and returns summary', async () => {
    mockResearch.mockResolvedValue('Краткое резюме исследования');

    const tools = subagentTools();
    const result = await tools.subagent_research.execute({ query: 'Как учиться быстро', depth: 'shallow' }, {} as never);

    expect(mockResearch).toHaveBeenCalledWith('Как учиться быстро', 'shallow');
    expect(result).toEqual({ summary: 'Краткое резюме исследования' });
  });

  it('supports depth: deep', async () => {
    mockResearch.mockResolvedValue('Подробное резюме');

    const tools = subagentTools();
    await tools.subagent_research.execute({ query: 'Квантовая физика', depth: 'deep' }, {} as never);

    expect(mockResearch).toHaveBeenCalledWith('Квантовая физика', 'deep');
  });
});

describe('subagent_technical', () => {
  it('delegates to runTechnicalAgent and returns result', async () => {
    mockTechnical.mockResolvedValue('Оформленный конспект');

    const tools = subagentTools();
    const result = await tools.subagent_technical.execute(
      { task: 'Сделай конспект', context: 'Длинный текст лекции...' },
      {} as never,
    );

    expect(mockTechnical).toHaveBeenCalledWith('Сделай конспект', 'Длинный текст лекции...');
    expect(result).toEqual({ result: 'Оформленный конспект' });
  });
});
