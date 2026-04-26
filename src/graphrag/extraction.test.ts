import { describe, it, expect, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { openrouterApiKey: 'test-key' },
}));

import { generateText } from 'ai';
import { extractTriplets } from './extraction.js';

describe('extractTriplets', () => {
  it('extracts triplets from JSON array response', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '[{"subject": "Alice", "predicate": "likes", "object": "tea"}]',
    } as any);

    const result = await extractTriplets('Alice likes tea.');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ subject: 'Alice', predicate: 'likes', object: 'tea' });
  });

  it('extracts triplets from markdown-fenced JSON', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '```json\n[{"subject": "Bob", "predicate": "works at", "object": "Google"}]\n```',
    } as any);

    const result = await extractTriplets('Bob works at Google.');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ subject: 'Bob', predicate: 'works at', object: 'Google' });
  });

  it('filters invalid triplets', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '[{"subject": "A", "predicate": "B", "object": "C"}, {"invalid": true}]',
    } as any);

    const result = await extractTriplets('A B C.');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ subject: 'A', predicate: 'B', object: 'C' });
  });

  it('normalizes triplets and filters empty, excessive, and duplicate values', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify([
        { subject: '  Emir  ', predicate: '  любит  ', object: '  чай  ' },
        { subject: 'Emir', predicate: 'любит', object: 'чай' },
        { subject: '', predicate: 'любит', object: 'кофе' },
        { subject: 'A'.repeat(121), predicate: 'любит', object: 'кофе' },
        { subject: 'Emir', predicate: 'x'.repeat(201), object: 'кофе' },
      ]),
    } as any);

    const result = await extractTriplets('Emir likes tea.');

    expect(result).toEqual([{ subject: 'Emir', predicate: 'любит', object: 'чай' }]);
  });

  it('returns empty array on parse error', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: 'not valid json',
    } as any);

    const result = await extractTriplets('Something.');
    expect(result).toEqual([]);
  });

  it('returns empty array when API key missing', async () => {
    const { config } = await import('../config.js');
    (config as any).openrouterApiKey = '';

    const result = await extractTriplets('Something.');
    expect(result).toEqual([]);
  });
});
