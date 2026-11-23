import type { SqlDriver } from '../driver';
import { createContext } from './context';
import { createCategoryRepository } from './repositories/categories';
import { createGoalRepository } from './repositories/goals';
import { createHabitEntryRepository } from './repositories/entries';
import { createHabitRepository } from './repositories/habits';
import { createJournalRepository } from './repositories/journal';
import { createLifeEventRepository } from './repositories/lifeEvents';
import { createSearchRepository } from './repositories/search';
import { createSettingsRepository } from './repositories/settings';
import { createTagRepository } from './repositories/tags';
import { exportAll } from './transfer/export';
import type { Repositories } from '@/domain/repositories';
import { systemClock, type Clock } from '@/domain/services/clock';

export { migrate, MIGRATIONS, LATEST_SCHEMA_VERSION, DatabaseTooNewError } from './migrate';

/** Builds every repository over one driver (design §5.2). */
export function createRepositories(driver: SqlDriver, clock: Clock = systemClock): Repositories {
  const ctx = createContext(driver, clock);
  const habits = createHabitRepository(ctx);
  const settings = createSettingsRepository(ctx);
  return {
    categories: createCategoryRepository(ctx),
    tags: createTagRepository(ctx),
    habits,
    entries: createHabitEntryRepository(ctx, habits),
    journal: createJournalRepository(ctx),
    goals: createGoalRepository(ctx),
    events: createLifeEventRepository(ctx),
    search: createSearchRepository(ctx),
    settings,
    transfer: { exportAll: ({ appVersion }) => exportAll(ctx, settings, appVersion) },
  };
}
