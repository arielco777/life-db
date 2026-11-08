import { createNodeDriver } from './nodeDriver';
import { createRepositories, migrate } from '@/data/sqlite';
import type { Clock } from '@/domain/services/clock';

/** A controllable clock; `advance` moves time forward so updated_at values differ. */
export function fakeClock(start = '2026-08-14T12:00:00') {
  let t = new Date(start).getTime();
  const clock: Clock & { set(iso: string): void; advance(ms?: number): void } = {
    now: () => new Date(t),
    set: (iso) => {
      t = new Date(iso).getTime();
    },
    advance: (ms = 1000) => {
      t += ms;
    },
  };
  return clock;
}

export async function setup(start?: string) {
  const driver = createNodeDriver();
  const clock = fakeClock(start);
  await migrate(driver, { clock });
  const repos = createRepositories(driver, clock);
  return { driver, clock, repos, db: driver.db };
}
