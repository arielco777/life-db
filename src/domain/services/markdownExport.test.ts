import { journalFiles, journalFolderName, portableName } from './markdownExport';
import type { Category, JournalEntry, Tag } from '../types';

let n = 0;
const entry = (entryDate: string, body: string, extra: Partial<JournalEntry> = {}): JournalEntry => ({
  id: `j${++n}`,
  entryDate,
  body,
  tagIds: [],
  createdAt: `2026-08-14T10:00:0${n % 10}.000Z`,
  updatedAt: '2026-08-14T10:00:00.000Z',
  ...extra,
});
const tags: Tag[] = [{ id: 't1', name: 'travel', createdAt: '', updatedAt: '' }];
const cats = [{ id: 'c1', name: 'Social' }] as Category[];

describe('Journal Markdown export (EXP-3)', () => {
  it('writes one file per entry with front matter, named by date and title', () => {
    const [f] = journalFiles(
      [entry('2026-08-14', 'Swam in the sea', { title: 'Beach', tagIds: ['t1'], categoryId: 'c1' })],
      tags,
      cats,
    );
    expect(f).toEqual({
      name: '2026-08-14 Beach.md',
      text: '---\ndate: "2026-08-14"\ntitle: "Beach"\ntags: ["travel"]\ncategory: "Social"\n---\n\nSwam in the sea\n',
    });
  });

  it('names untitled entries by their first words and keeps names apart', () => {
    const files = journalFiles(
      [
        entry('2026-08-15', '# Long day\n\nwork work'),
        entry('2026-08-14', 'Same title', { title: 'Notes' }),
        entry('2026-08-14', 'again', { title: 'notes' }),
        entry('2026-08-13', ''),
      ],
      tags,
      cats,
    );
    expect(files.map((f) => f.name)).toEqual([
      '2026-08-13.md',
      '2026-08-14 Notes.md',
      '2026-08-14 notes (2).md',
      '2026-08-15 Long day.md',
    ]);
    expect(files[0]!.text).toBe('---\ndate: "2026-08-13"\ntags: []\n---\n\n');
  });

  it('quotes front matter so any title is valid YAML', () => {
    const [f] = journalFiles([entry('2026-08-14', 'x', { title: 'Re: "quotes" & #tags\ttab' })], [], []);
    expect(f!.text).toContain('title: "Re: \\"quotes\\" & #tags\\ttab"');
  });

  it('makes file names portable across Windows, macOS and Linux', () => {
    expect(portableName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(portableName('  ...trailing dots...  ')).toBe('trailing dots');
    expect([...portableName('é'.repeat(200))]).toHaveLength(80);
    expect(journalFolderName('2026-12-01')).toBe('Life DB journal 2026-12-01');
  });
});
