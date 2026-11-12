import type { BootResult } from './boot';
import { issueUrl } from './diagnostics';
import type { PlatformService } from '@/platform/PlatformService';
import { tauriPlatform } from '@/platform/tauriPlatform';

type Platform = Pick<PlatformService, 'appInfo' | 'openInBrowser' | 'revealInFolder' | 'dataInfo'>;

/** Ways out of an error screen. Failures here have nowhere to be shown, so they're ignored. */
function Actions({
  platform,
  error,
  folder,
}: {
  platform: Platform;
  error?: string;
  folder?: 'data' | 'backups';
}) {
  const attempt = (fn: () => Promise<unknown>) => () => void fn().catch(() => {});
  const report = attempt(async () => platform.openInBrowser(issueUrl(await platform.appInfo(), error)));
  const openLog = attempt(async () => platform.revealInFolder((await platform.appInfo()).logFile));
  const openFolder = attempt(async () => {
    const info = await platform.dataInfo();
    await platform.revealInFolder(folder === 'backups' ? info.backupsDir : info.path);
  });
  return (
    <div className="row boot-actions">
      {folder && (
        <button type="button" onClick={openFolder}>
          {folder === 'backups' ? 'Open backups folder' : 'Open data folder'}
        </button>
      )}
      <button type="button" className="secondary" onClick={report}>
        Report an issue
      </button>
      <button type="button" className="secondary" onClick={openLog}>
        Open log file
      </button>
    </div>
  );
}

/** Everything shown before the app is usable: loading, and the error states (SEC-2, NFR-3, DIST-3). */
export function BootScreen({
  result,
  platform = tauriPlatform,
}: {
  result: BootResult | null;
  platform?: Platform;
}) {
  if (!result) {
    return (
      <div className="boot" aria-busy="true">
        <p className="muted">Opening your notebook…</p>
      </div>
    );
  }
  switch (result.kind) {
    case 'no-tauri':
      return (
        <div className="boot">
          <h1>Life DB</h1>
          <p>
            This page runs inside the Life DB desktop app. Start it with <code>npm run tauri dev</code>.
          </p>
        </div>
      );
    case 'key-missing':
      return (
        <div className="boot" role="alert">
          <h1>Can’t open your database</h1>
          <p>
            Your Life DB data is encrypted with a key stored on this device, and that key couldn’t be found.
            This can happen after reinstalling the operating system or clearing the system keyring.
          </p>
          <p className="muted">Database: {result.path}</p>
          <Actions platform={platform} error="Startup: database key missing" />
        </div>
      );
    case 'too-new':
      return (
        <div className="boot" role="alert">
          <h1>Please update Life DB</h1>
          <p>
            Your data was saved by a newer version of Life DB (data version {result.dbVersion}; this app reads
            up to {result.appVersion}). Install the latest version to open it. Your data has not been changed.
          </p>
        </div>
      );
    case 'migration-failed':
      return (
        <div className="boot" role="alert">
          <h1>Life DB couldn’t finish updating your data</h1>
          <p>
            This version of the app needed to update how your data is stored, and the update failed. It was
            undone completely, so your data is exactly as it was
            {result.backedUp ? ', and a copy was also saved in the backups folder before it started' : ''}.
          </p>
          <p>
            Please report the problem so it can be fixed. Until then, reinstalling the previous version of
            Life DB opens your data as before.
          </p>
          <pre className="mono small">{result.message}</pre>
          <Actions
            platform={platform}
            error={`Migration failed: ${result.message}`}
            folder={result.backedUp ? 'backups' : 'data'}
          />
        </div>
      );
    case 'error':
      return (
        <div className="boot" role="alert">
          <h1>Something went wrong</h1>
          <p>Life DB couldn’t start. Your data has not been changed.</p>
          <pre className="mono small">{result.message}</pre>
          <Actions platform={platform} error={`Startup failed: ${result.message}`} />
        </div>
      );
    case 'ready':
      return null;
  }
}
