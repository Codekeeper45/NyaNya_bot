import { formatWhoFacts } from './who-format.js';

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
