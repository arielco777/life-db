import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { BACKUP_EXTENSION, backupFileName, formatBytes, withBackupExtension } from './backup';
import { useFormatDate, useSetSetting, useSettings, useToday } from './hooks';
import { usePlatform } from '@/platform/PlatformProvider';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { useToast } from '@/ui/Toast';

export const dataKeys = { info: ['platform', 'data-info'] as const };

/** Choices for how many daily backups to keep (the setting allows 1–100). */
const KEEP_CHOICES = [3, 5, 7, 14, 30, 60, 90];

const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

/**
 * Settings → Data (tasks 8.2, 8.3, 8.5, 8.6): manual backup (EXP-4), restore (EXP-5),
 * automatic daily backups (EXP-6) and where the data lives (EXP-7).
 */
export function DataPage() {
  const platform = usePlatform();
  const info = useQuery({ queryKey: dataKeys.info, queryFn: () => platform.dataInfo() });
  return (
    <section className="stack">
      <BackupSection />
      <RestoreSection />
      <AutoBackupSection lastAutoBackup={info.data?.lastAutoBackup} />
      <section className="card stack" aria-labelledby="data-folder">
        <h2 id="data-folder">Data folder</h2>
        {info.isPending && <p className="muted">Loading…</p>}
        {info.isError && <p className="error">Couldn't find the data folder.</p>}
        {info.data && <DataFolder path={info.data.path} sizeBytes={info.data.sizeBytes} />}
      </section>
    </section>
  );
}

function useReveal() {
  const platform = usePlatform();
  const toast = useToast();
  return (path: string) => void platform.revealInFolder(path).catch((e: unknown) => toast.error(e));
}

function BackupSection() {
  const platform = usePlatform();
  const toast = useToast();
  const today = useToday();
  const reveal = useReveal();
  const backup = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const chosen = await platform.pickSavePath({
        title: 'Save backup',
        defaultName: backupFileName(today),
        filters: [{ name: 'Life DB backup', extensions: [BACKUP_EXTENSION] }],
      });
      if (!chosen) return null; // cancelled
      const path = withBackupExtension(chosen);
      await platform.backupTo(path);
      return path;
    },
    onError: (e) => toast.error(e),
  });

  return (
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
  );
}

function RestoreSection() {
  const platform = usePlatform();
  const toast = useToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    try {
      const path = await platform.pickOpenPath({
        title: 'Choose a backup to restore',
        filters: [
          { name: 'Life DB backup', extensions: [BACKUP_EXTENSION, 'db'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (path) setChosen(path);
    } catch (e) {
      toast.error(e);
    }
  };

  const restore = useMutation({
    mutationFn: (path: string) => platform.restoreFrom(path),
    // Every query and screen now describes the old data: start the app again.
    onSuccess: () => platform.reloadApp(),
    onError: (e) => {
      setChosen(null);
      // The Rust side writes these messages for people ("isn't a backup from this device"…).
      setError(e instanceof Error && e.message ? e.message : 'The backup couldn’t be restored.');
    },
  });

  return (
    <section className="card stack" aria-labelledby="data-restore">
      <h2 id="data-restore">Restore</h2>
      <p>Replace everything in Life DB with the contents of a backup made on this device.</p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() => void choose()}
          disabled={restore.isPending}
        >
          Restore from backup…
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {chosen && (
        <ConfirmDialog
          title="Replace all your data with this backup?"
          confirmLabel="Restore"
          danger
          busy={restore.isPending}
          onCancel={() => setChosen(null)}
          onConfirm={() => restore.mutate(chosen)}
        >
          <p>
            Everything in Life DB will be replaced by <strong>{fileName(chosen)}</strong>. Anything added
            since that backup was made will no longer show.
          </p>
          <p className="small muted">
            Your current data is saved to the backups folder first, so you can get it back by restoring that
            copy. The app restarts afterwards.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function AutoBackupSection({ lastAutoBackup }: { lastAutoBackup?: string | null }) {
  const ids = useId();
  const settings = useSettings();
  const set = useSetSetting();
  const formatDate = useFormatDate();
  const enabled = settings['backup.auto_enabled'];
  const keep = settings['backup.keep_count'];
  const choices = KEEP_CHOICES.includes(keep) ? KEEP_CHOICES : [...KEEP_CHOICES, keep].sort((a, b) => a - b);

  return (
    <section className="card stack" aria-labelledby="data-auto">
      <h2 id="data-auto">Automatic backups</h2>
      <label className="row check-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => set.mutate({ key: 'backup.auto_enabled', value: e.target.checked })}
        />
        <span>Back up once a day, when the app starts</span>
      </label>
      <div className="row">
        <label htmlFor={`${ids}-keep`}>Keep the last</label>
        <select
          id={`${ids}-keep`}
          value={keep}
          disabled={!enabled}
          onChange={(e) => set.mutate({ key: 'backup.keep_count', value: Number(e.target.value) })}
        >
          {choices.map((n) => (
            <option key={n} value={n}>
              {n} days
            </option>
          ))}
        </select>
      </div>
      <p className="small muted">
        {lastAutoBackup ? `Latest: ${formatDate(lastAutoBackup)}. ` : 'None yet. '}
        They're kept in the backups folder, encrypted like your data. Older ones are deleted; backups you save
        yourself are never touched.
      </p>
    </section>
  );
}

function DataFolder({ path, sizeBytes }: { path: string; sizeBytes: number }) {
  const reveal = useReveal();
  return (
    <>
      <p>Everything is stored in one encrypted file on this device:</p>
      <p className="data-path" aria-label="Database file">
        {path}
      </p>
      <p className="small muted">
        {formatBytes(sizeBytes)}. Automatic backups, and the copies made before an update or a restore, go in
        the <span className="data-path">backups</span> folder next to it.
      </p>
      <div className="row">
        <button type="button" className="secondary" onClick={() => reveal(path)}>
          Open folder
        </button>
      </div>
    </>
  );
}
