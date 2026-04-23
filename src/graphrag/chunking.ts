/**
 * Simple sentence-based text chunking with overlap.
 * Targets ~500-800 tokens per chunk (approximated as 4 chars per token for Russian).
 */
export function chunkText(text: string, maxChars = 2400, overlapChars = 400): string[] {
  if (text.length <= maxChars) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
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
