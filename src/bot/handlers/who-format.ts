function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Categorize an entity based on its name/description heuristics.
 */
function categorizeEntity(name: string, description: string): string {
  const text = (name + ' ' + description).toLowerCase();
  if (/имя|nickname|ник|зовут|name/.test(text)) return '👤 Личное';
  if (/город|страна|жив[еу]т|адрес|место|location|city|country/.test(text)) return '📍 Место';
  if (/работа|профессия|компани|должност|job|work|career|company/.test(text)) return '💼 Работа';
  if (/хобби|интерес|любит|увлека|hobby|interest|passion/.test(text)) return '🎯 Интересы';
  if (/семья|родител|жена|муж|дети|брат|сестра|father|mother|family|wife|husband|child/.test(text)) return '👨‍👩‍👧‍👦 Семья';
  if (/образовани|учеба|школ|университет|education|university|school|degree/.test(text)) return '🎓 Образование';
  if (/здоровье|болезн|врач|лечени|health|doctor|medicine/.test(text)) return '🏥 Здоровье';
  return '📌 Другое';
}

/**
 * Format entities and relationships into Telegram-safe HTML lines.
 */
export function formatWhoFacts(entities: Array<{ name: string; description: string }>, relationships: Array<{ sourceName: string; description: string; targetName: string }>): string[] {
  const groups = new Map<string, Array<{ name: string; description: string }>>();
  for (const e of entities) {
    const cat = categorizeEntity(e.name, e.description);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(e);
  }

  const sortedCats = Array.from(groups.keys()).sort();
  for (const cat of sortedCats) {
    groups.get(cat)!.sort((a, b) => a.name.localeCompare(b.name));
  }

  const lines: string[] = [];
  lines.push('🧠 <b>Вот что я помню о тебе:</b>');
  lines.push('');

  let factNum = 1;
  for (const cat of sortedCats) {
    lines.push(cat);
    for (const e of groups.get(cat)!) {
      lines.push(`${factNum}. <b>${escapeHtml(e.name)}</b>: ${escapeHtml(e.description)}`);
      factNum++;
    }
    lines.push('');
  }

  if (relationships.length > 0) {
    lines.push('🔗 <b>Связи:</b>');
    let relNum = 1;
    for (const r of relationships.slice(0, 30)) {
      lines.push(`${relNum}. <b>${escapeHtml(r.sourceName)}</b> → <i>${escapeHtml(r.description)}</i> → <b>${escapeHtml(r.targetName)}</b>`);
      relNum++;
    }
    lines.push('');
  }

  lines.push(`<i>Всего фактов: ${entities.length}, связей: ${relationships.length}</i>`);
  return lines;
}

export function formatWhoContinuationPrefix(index: number, total: number): string {
  return index === 0 ? '' : `<i>(продолжение ${index + 1}/${total})</i>\n\n`;
}
