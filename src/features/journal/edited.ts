import { toISODate } from '@/domain/services/clock';
import type { ISODate, JournalEntry } from '@/domain/types';

/** Local calendar date of a timestamp. */
export const localDateOf = (ts: string): ISODate => toISODate(new Date(ts));

/**
 * The day an entry was last changed, when that's later than the day it was written.
 * Fixes made the same day (autosave, typos) don't count, so "edited" means it was
 * revisited.
 */
export function editedLaterOn(e: Pick<JournalEntry, 'createdAt' | 'updatedAt'>): ISODate | undefined {
  const written = localDateOf(e.createdAt);
  const changed = localDateOf(e.updatedAt);
  return changed > written ? changed : undefined;
}
