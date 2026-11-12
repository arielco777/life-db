import { lazy, Suspense, useState } from 'react';
import { updateKeys, useAvailableUpdate, useDailyUpdateCheck } from './updates';
import { flushBeforeClose } from '@/app/closeGuard';
import { usePlatform } from '@/platform/PlatformProvider';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';

const MarkdownView = lazy(() =>
  import('@/features/journal/MarkdownView').then((m) => ({ default: m.MarkdownView })),
);

/**
 * "A new version is available" (DIST-2): a quiet banner, then release notes and an install
 * that only starts when the user says so. Also runs the daily automatic check.
 */
export function UpdateNotice() {
  useDailyUpdateCheck();
  const update = useAvailableUpdate();
  const platform = usePlatform();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  if (!update) return null;
  const installing = progress !== undefined && !error;

  const later = () => {
    setOpen(false);
    qc.setQueryData(updateKeys.available, null); // until the next check
  };

  const install = async () => {
    setError(null);
    setProgress(null);
    try {
      await flushBeforeClose(); // nothing typed is lost (JRN-4)
      await update.install(setProgress);
      await platform.restartApp();
    } catch (e) {
      platform.log('error', `Update install failed: ${e instanceof Error ? e.message : String(e)}`);
      setError('The update couldn’t be installed. Your data is unchanged. Try again later.');
      setProgress(undefined);
    }
  };

  return (
    <>
      {!open && (
        <div className="update-notice" role="status">
          <span>Life DB {update.version} is available.</span>
          <button type="button" className="small-button" onClick={() => setOpen(true)}>
            See what’s new
          </button>
          <button type="button" className="link-button small" onClick={later}>
            Later
          </button>
        </div>
      )}
      {open && (
        <ConfirmDialog
          title={`Update to Life DB ${update.version}?`}
          confirmLabel={installing ? 'Installing…' : 'Install and restart'}
          cancelLabel="Not now"
          busy={installing}
          onCancel={later}
          onConfirm={() => void install()}
        >
          {update.notes ? (
            <Suspense fallback={<p className="muted">Loading release notes…</p>}>
              <MarkdownView text={update.notes} label="Release notes" />
            </Suspense>
          ) : (
            <p>No release notes for this version.</p>
          )}
          <p className="small muted">
            The update is checked against Life DB’s signature before it installs. Your data stays as it is; if
            it needs updating, a backup is made first.
          </p>
          {installing && (
            <p className="small" role="status">
              {progress === null ? 'Downloading…' : `Downloading… ${Math.round((progress ?? 0) * 100)}%`}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
