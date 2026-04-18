import { describe, it, expect } from 'vitest';
import { getDb } from './client.js';

describe('getDb', () => {
  it('returns same instance for same DATABASE_URL and throws for different one', () => {
    const url1 = 'postgresql://user:pass@localhost:5432/db1';
    const url2 = 'postgresql://user:pass@localhost:5432/db2';

    const db1 = getDb(url1);
    const db1Again = getDb(url1);

    expect(db1Again).toBe(db1);
    expect(() => getDb(url2)).toThrow('different DATABASE_URL');
  });
});
