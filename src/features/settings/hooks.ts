import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useRepositories } from '@/app/RepositoryProvider';
import { logicalToday } from '@/domain/services/clock';
import { formatDate } from '@/domain/services/dateFormat';
import { DEFAULT_SETTINGS, type ISODate, type Settings } from '@/domain/types';
import { useToast } from '@/ui/Toast';

export const settingsKeys = { all: ['settings'] as const };

/** All settings, falling back to defaults while loading so callers never wait on them. */
export function useSettings(): Settings {
  return useSettingsState().settings;
}

/** Settings plus whether they've actually loaded (not just defaults). */
export function useSettingsState(): { settings: Settings; loaded: boolean } {
  const { settings } = useRepositories();
  const { data } = useQuery({ queryKey: settingsKeys.all, queryFn: () => settings.getAll() });
  return { settings: data ?? DEFAULT_SETTINGS, loaded: data !== undefined };
}

/** The logical today (SET-4), computed at render time. */
export function useToday(): ISODate {
  return logicalToday(useSettings().day_start_hour);
}

/** Formats calendar dates in the user's chosen date format (SET-2). */
export function useFormatDate(): (d: ISODate, withYear?: boolean) => string {
  const pattern = useSettings().date_format;
  return (d, withYear = true) => formatDate(d, pattern, withYear);
}

/** One setting change, with the value type tied to its key. */
export type SettingChange = { [K in keyof Settings]: { key: K; value: Settings[K] } }[keyof Settings];

/** Changes one setting; applied optimistically, rolled back with a toast on failure. */
export function useSetSetting() {
  const { settings } = useRepositories();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ key, value }: SettingChange) =>
      // The union keeps key and value paired for callers; the repository validates again.
      (settings.set as (k: keyof Settings, v: unknown) => Promise<void>)(key, value),
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: settingsKeys.all });
      const previous = qc.getQueryData<Settings>(settingsKeys.all);
      qc.setQueryData<Settings>(settingsKeys.all, { ...(previous ?? DEFAULT_SETTINGS), [key]: value });
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      qc.setQueryData(settingsKeys.all, ctx?.previous);
      toast.error(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

/** Applies the theme setting to the page (SET-2); "system" follows the OS. */
export function useApplyTheme() {
  const { theme } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}
