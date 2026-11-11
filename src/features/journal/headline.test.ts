import { editedLaterOn } from './edited';
import { entryHeadline, entrySnippet } from './headline';

describe('entryHeadline / entrySnippet', () => {
  it('uses the title, else the first line without Markdown markers', () => {
    expect(entryHeadline({ title: 'Trip', body: 'Long day' })).toBe('Trip');
    expect(entryHeadline({ body: '\n\n## Morning run\nfelt good' })).toBe('Morning run');
    expect(entryHeadline({ body: '- [x] call mom' })).toBe('call mom');
    expect(entryHeadline({ body: '  ' })).toBe('Untitled');
    expect(entryHeadline({ body: 'x'.repeat(200) })).toHaveLength(120);
  });

  it('shows a snippet only under a title', () => {
    expect(entrySnippet({ title: 'Trip', body: '> quiet morning' })).toBe('quiet morning');
    expect(entrySnippet({ body: 'only text' })).toBeUndefined();
    expect(entrySnippet({ title: 'Trip', body: '' })).toBeUndefined();
  });
});

describe('editedLaterOn', () => {
  const at = (d: string, h: number) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).toISOString();
  it('is set only when the entry changed on a later local day', () => {
    expect(
      editedLaterOn({ createdAt: at('2026-08-14', 9), updatedAt: at('2026-08-14', 23) }),
    ).toBeUndefined();
    expect(editedLaterOn({ createdAt: at('2026-08-14', 9), updatedAt: at('2026-08-16', 8) })).toBe(
      '2026-08-16',
    );
  });
});
