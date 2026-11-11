import type { JournalEntry } from '@/domain/types';

const MAX = 120;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s);
/** First non-empty line, without leading Markdown markers (#, >, -, *, 1.). */
const firstLine = (body: string) =>
  body
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim())
    .find(Boolean);

/** What a list shows for an entry: its title, else its first line, else "Untitled". */
export const entryHeadline = (e: Pick<JournalEntry, 'title' | 'body'>): string =>
  clip(e.title || firstLine(e.body) || 'Untitled');

/** A second line under a titled entry: the start of its text. */
export const entrySnippet = (e: Pick<JournalEntry, 'title' | 'body'>): string | undefined =>
  e.title ? firstLine(e.body) && clip(firstLine(e.body)!) : undefined;
