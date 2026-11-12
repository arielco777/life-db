import type { SqlDriver } from '../driver';
import { createContext } from './context';
import { createCategoryRepository } from './repositories/categories';
import { createHabitEntryRepository } from './repositories/entries';
import { createHabitRepository } from './repositories/habits';
import { createJournalRepository } from './repositories/journal';
import { createSettingsRepository } from './repositories/settings';
import { createTagRepository } from './repositories/tags';
import type { Repositories } from '@/domain/repositories';
import { systemClock, type Clock } from '@/domain/services/clock';

export { migrate, MIGRATIONS, LATEST_SCHEMA_VERSION, DatabaseTooNewError } from './migrate';

/** Builds every repository over one driver (design §5.2). */
export function createRepositories(driver: SqlDriver, clock: Clock = systemClock): Repositories {
  const ctx = createContext(driver, clock);
  const habits = createHabitRepository(ctx);
  return {
    categories: createCategoryRepository(ctx),
    tags: createTagRepository(ctx),
    habits,
    entries: createHabitEntryRepository(ctx, habits),
    journal: createJournalRepository(ctx),
    settings: createSettingsRepository(ctx),
  };
}
