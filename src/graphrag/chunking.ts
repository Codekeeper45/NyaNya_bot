/**
 * Simple sentence-based text chunking with overlap.
 * Targets ~500-800 tokens per chunk (approximated as 4 chars per token for Russian).
 */
export function chunkText(text: string, maxChars = 2400, overlapChars = 400): string[] {
  // Remove invalid UTF-8 sequences PostgreSQL text rejects
  const clean = text
    .replace(/\x00/g, '')                    // null bytes
    .replace(/[\uD800-\uDFFF]/g, '');        // lone UTF-16 surrogates
  if (!clean.trim()) return [];
  if (clean.length <= maxChars) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]+\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep last N chars from previous chunk
      const overlapStart = Math.max(0, current.length - overlapChars);
      current = current.slice(overlapStart) + sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}
