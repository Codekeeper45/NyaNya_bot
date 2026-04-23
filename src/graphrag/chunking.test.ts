import { describe, it, expect } from 'vitest';
import { chunkText } from './chunking.js';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const text = 'Hello world. This is a test.';
    const chunks = chunkText(text, 1000, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('splits long text into multiple chunks', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(50); // ~2350 chars
    const chunks = chunkText(text, 800, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be reasonable size
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });

  it('preserves sentence boundaries', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const chunks = chunkText(text, 50, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Each chunk should end with a sentence terminator if not the last
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]).toMatch(/[.!?]\s*$/);
    }
  });

  it('handles empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('handles text without sentence terminators', () => {
    const text = 'just one long string without any punctuation';
    const chunks = chunkText(text, 20, 5);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
