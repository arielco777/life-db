import type { DateRange, JournalCursor, Repositories } from '@/domain/repositories';
import { habitCsv, type CsvLayout } from '@/domain/services/csvExport';
import { journalFiles, type MarkdownFile } from '@/domain/services/markdownExport';
import type { ISODate, JournalEntry } from '@/domain/types';

/** Optional date limits; a missing end means "no limit on that side". */
export interface DateLimits {
  from?: ISODate;
  to?: ISODate;
}

const ALL: DateRange = { from: '0001-01-01', to: '9999-12-31' };
const toRange = ({ from, to }: DateLimits): DateRange => ({ from: from || ALL.from, to: to || ALL.to });

/** The full export as text (EXP-1). One space of indentation: readable, still compact. */
export async function buildJsonExport(repos: Repositories, appVersion: string): Promise<string> {
  return JSON.stringify(await repos.transfer.exportAll({ appVersion }), null, 1);
}

/** Habit history as CSV (EXP-2), habits in their list order. */
export async function buildHabitCsv(
  repos: Repositories,
  opts: { layout: CsvLayout; includeArchived: boolean; dates: DateLimits },
): Promise<{ text: string; entries: number }> {
  const habits = await repos.habits.list({ includeArchived: opts.includeArchived });
  const entries = await repos.entries.forRange(
    toRange(opts.dates),
    habits.map((h) => h.id),
  );
  return { text: habitCsv(habits, entries, opts.layout), entries: entries.length };
}

/** Every journal entry in the dates, oldest first (EXP-3). */
async function journalEntries(repos: Repositories, dates: DateLimits): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  let after: JournalCursor | undefined;
  do {
    const page = await repos.journal.list({ ...toRange(dates) }, { after, limit: 1000 });
    out.push(...page.entries);
    after = page.next;
  } while (after);
  return out;
}

/** The journal as Markdown files (EXP-3). */
export async function buildJournalFiles(repos: Repositories, dates: DateLimits): Promise<MarkdownFile[]> {
  const [entries, tags, categories] = await Promise.all([
    journalEntries(repos, dates),
    repos.tags.list(),
    repos.categories.list({ includeArchived: true }),
  ]);
  return journalFiles(entries, tags, categories);
}
