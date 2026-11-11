import { useMutation, useQuery } from '@tanstack/react-query';
import { BACKUP_EXTENSION, backupFileName, formatBytes, withBackupExtension } from './backup';
import { useToday } from './hooks';
import { usePlatform } from '@/platform/PlatformProvider';
import { useToast } from '@/ui/Toast';

export const dataKeys = { info: ['platform', 'data-info'] as const };

/** Settings → Data (tasks 8.2, 8.6): manual backup (EXP-4) and where the data lives (EXP-7). */
export function DataPage() {
  const platform = usePlatform();
  const toast = useToast();
  const today = useToday();
  const info = useQuery({ queryKey: dataKeys.info, queryFn: () => platform.dataInfo() });

  const backup = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const chosen = await platform.pickSavePath({
        title: 'Save backup',
        defaultName: backupFileName(today),
        filter: { name: 'Life DB backup', extensions: [BACKUP_EXTENSION] },
      });
      if (!chosen) return null; // cancelled
      const path = withBackupExtension(chosen);
      await platform.backupTo(path);
      return path;
    },
    onError: (e) => toast.error(e),
  });

  const reveal = (path: string) => void platform.revealInFolder(path).catch((e: unknown) => toast.error(e));

  return (
    <section className="stack">
      <section className="card stack" aria-labelledby="data-backup">
        <h2 id="data-backup">Backup</h2>
        <p>Save a copy of all your habits, goals, journal and events to a file you choose.</p>
        <p className="small muted">
          Backups are encrypted with this device's key, so they can be restored only on this device and user
          account. Moving your data to another device will come with export in a later version.
        </p>
        <div className="row">
          <button type="button" onClick={() => backup.mutate()} disabled={backup.isPending}>
            {backup.isPending ? 'Backing up…' : 'Back up now…'}
          </button>
        </div>
        {backup.data && (
          <p className="small data-result" role="status">
            Backup saved to <span className="data-path">{backup.data}</span>{' '}
            <button type="button" className="link-button" onClick={() => reveal(backup.data!)}>
              Show in folder
            </button>
          </p>
        )}
      </section>

      <section className="card stack" aria-labelledby="data-folder">
        <h2 id="data-folder">Data folder</h2>
        {info.isPending && <p className="muted">Loading…</p>}
        {info.isError && <p className="error">Couldn't find the data folder.</p>}
        {info.data && (
          <>
            <p>Everything is stored in one encrypted file on this device:</p>
            <p className="data-path" aria-label="Database file">
              {info.data.path}
            </p>
            <p className="small muted">
              {formatBytes(info.data.sizeBytes)}. Backups the app makes on its own, such as before an update,
              go in the <span className="data-path">backups</span> folder next to it.
            </p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => reveal(info.data.path)}>
                Open folder
              </button>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
