import { contextCache, embeddingCache, lastQueryCache, clearGraphRagCaches } from './cache.js';

describe('GraphRAG cache clearing', () => {
  it('clears runtime GraphRAG caches', () => {
    embeddingCache.set('text', [0.1]);
    contextCache.set('1:query', { context: 'context', entityIds: ['e1'] });
    lastQueryCache.set('1', { text: 'query', embedding: [0.1] });

    clearGraphRagCaches();

    expect(embeddingCache.get('text')).toBeUndefined();
    expect(contextCache.get('1:query')).toBeUndefined();
    expect(lastQueryCache.get('1')).toBeUndefined();
  });
});
