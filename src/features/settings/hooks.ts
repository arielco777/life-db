import { useQuery } from '@tanstack/react-query';
import { useRepositories } from '@/app/RepositoryProvider';
import { logicalToday } from '@/domain/services/clock';
import { DEFAULT_SETTINGS, type ISODate, type Settings } from '@/domain/types';

export const settingsKeys = { all: ['settings'] as const };

/** All settings, falling back to defaults while loading so callers never wait on them. */
export function useSettings(): Settings {
  const { settings } = useRepositories();
  const { data } = useQuery({ queryKey: settingsKeys.all, queryFn: () => settings.getAll() });
  return data ?? DEFAULT_SETTINGS;
}

/** The logical today (SET-4), computed at render time. */
export function useToday(): ISODate {
  return logicalToday(useSettings().day_start_hour);
}
