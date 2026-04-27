import { formatWhoFacts, formatWhoSavedFacts } from './who-format.js';

describe('formatWhoFacts', () => {
  it('escapes user-controlled memory fields for Telegram HTML', () => {
    const lines = formatWhoFacts(
      [
        {
          name: 'schedule_postpone_today *broken',
          description: 'uses <today> & keeps _underscores_ [link',
        },
      ],
      [
        {
          sourceName: 'A<B',
          description: 'likes & trusts _markdown_',
          targetName: 'C>D',
        },
      ],
    );

    const text = lines.join('\n');
    expect(text).toContain('<b>schedule_postpone_today *broken</b>: uses &lt;today&gt; &amp; keeps _underscores_ [link');
    expect(text).toContain('<b>A&lt;B</b> → <i>likes &amp; trusts _markdown_</i> → <b>C&gt;D</b>');
    expect(text).not.toContain('*schedule_postpone_today');
  });
});

describe('formatWhoSavedFacts', () => {
  it('shows raw memory_save facts immediately and escapes HTML', () => {
    const lines = formatWhoSavedFacts([
      {
        content: 'Факт о пользователе: Эмир занимается в Big Nation & любит <зал>',
        createdAt: new Date('2026-04-27T03:05:39.472Z'),
      },
    ]);

    const text = lines.join('\n');
    expect(text).toContain('💾 <b>Сохранённые факты:</b>');
    expect(text).toContain('1. Эмир занимается в Big Nation &amp; любит &lt;зал&gt;');
    expect(text).not.toContain('Факт о пользователе:');
  });
});
