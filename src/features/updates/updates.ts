import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { afterInteractive } from '@/app/startup';
import { describeError } from '@/app/diagnostics';
import { useSetSetting, useSettingsState } from '@/features/settings/hooks';
import { usePlatform } from '@/platform/PlatformProvider';
import type { AvailableUpdate } from '@/platform/PlatformService';

/** At most one automatic check a day (DIST-2). */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export const updateKeys = { available: ['update', 'available'] as const };

/** Whether an automatic check is due: never checked, a day has passed, or the clock went back. */
export function isCheckDue(lastChecked: string, now: Date): boolean {
  const last = Date.parse(lastChecked);
  if (Number.isNaN(last)) return true;
  const age = now.getTime() - last;
  return age >= CHECK_EVERY_MS || age < 0;
}

/** The update found by the last check, if any (shared by the notice and About). */
export function useAvailableUpdate(): AvailableUpdate | null {
  const { data } = useQuery<AvailableUpdate | null>({
    queryKey: updateKeys.available,
    queryFn: () => null,
    enabled: false,
  });
  return data ?? null;
}

/** Checks the update server now and remembers when. Resolves to the update or null. */
export function useCheckForUpdates() {
  const platform = usePlatform();
  const qc = useQueryClient();
  const setSetting = useSetSetting();
  return useMutation({
    mutationFn: () => platform.checkForUpdate(),
    onSuccess: (update) => {
      qc.setQueryData(updateKeys.available, update);
      setSetting.mutate({ key: 'updates.last_checked', value: new Date().toISOString() });
    },
    // Offline or GitHub unreachable: not worth interrupting anyone over.
    onError: (e) => platform.log('warn', `Update check failed: ${describeError(e)}`),
  });
}

/** The automatic check: once the app is up, if turned on and a day has passed (DIST-2). */
export function useDailyUpdateCheck() {
  const { settings, loaded } = useSettingsState();
  const check = useCheckForUpdates();
  const due =
    loaded && settings['updates.enabled'] && isCheckDue(settings['updates.last_checked'], new Date());
  const { mutate } = check;
  useEffect(() => {
    if (due) afterInteractive(() => mutate());
  }, [due, mutate]);
}
