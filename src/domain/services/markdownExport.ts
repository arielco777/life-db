import type { Category, ISODate, JournalEntry, Tag } from '../types';

/**
 * The journal as Markdown files, one per entry (EXP-3, V1.5 design §3). Front matter in
 * YAML with JSON-quoted values (always valid YAML), then the body.
 */
export interface MarkdownFile {
  name: string;
  text: string;
}

/** Longest file name before `.md`. Leaves room for ` (2)` and stays far below OS limits. */
const MAX_NAME = 80;

/** The folder an export creates: `Life DB journal 2026-12-01`. */
export const journalFolderName = (today: ISODate) => `Life DB journal ${today}`;

/**
 * A file name that is valid on Windows, macOS and Linux: no `<>:"/\|?*` or control
 * characters, no leading or trailing dots or spaces, at most `MAX_NAME` characters.
 */
export function portableName(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned]
    .slice(0, MAX_NAME)
    .join('')
    .replace(/^[.\s]+|[.\s]+$/g, '');
}

/** The first few words of the body, without Markdown punctuation, for untitled entries. */
function firstWords(body: string, words = 6): string {
  const firstLine = body.split('\n').find((l) => l.trim()) ?? '';
  return firstLine
    .replace(/[#*_>`[\]()!~|]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, words)
    .join(' ');
}

/** `2026-08-14 Beach`, `2026-08-14 Swam in the sea`, or just `2026-08-14`. */
function baseName(e: JournalEntry): string {
  const label = portableName(e.title?.trim() || firstWords(e.body));
  return portableName(label ? `${e.entryDate} ${label}` : e.entryDate);
}

const q = (s: string) => JSON.stringify(s);

function fileText(e: JournalEntry, tagNames: string[], category: string | undefined): string {
  const front = [
    '---',
    `date: ${q(e.entryDate)}`,
    ...(e.title?.trim() ? [`title: ${q(e.title.trim())}`] : []),
    `tags: [${tagNames.map(q).join(', ')}]`,
    ...(category ? [`category: ${q(category)}`] : []),
    '---',
  ];
  const body = e.body.endsWith('\n') || !e.body ? e.body : `${e.body}\n`;
  return `${front.join('\n')}\n\n${body}`;
}

/**
 * One file per entry, sorted by date then creation time. Names start with the date, so
 * they sort by date in any file manager. Clashes (compared case-insensitively, as on
 * Windows and macOS) get ` (2)`, ` (3)`…
 */
export function journalFiles(entries: JournalEntry[], tags: Tag[], categories: Category[]): MarkdownFile[] {
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const taken = new Set<string>();
  return [...entries]
    .sort((a, b) =>
      a.entryDate === b.entryDate
        ? a.createdAt.localeCompare(b.createdAt)
        : a.entryDate < b.entryDate
          ? -1
          : 1,
    )
    .map((e) => {
      const base = baseName(e);
      let name = `${base}.md`;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i}).md`;
      taken.add(name.toLowerCase());
      const names = e.tagIds.map((id) => tagName.get(id)).filter((n): n is string => !!n);
      return { name, text: fileText(e, names, e.categoryId ? categoryName.get(e.categoryId) : undefined) };
    });
}
