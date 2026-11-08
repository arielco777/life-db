import type { BootResult } from './boot';

/** Everything shown before the app is usable: loading, and the error states from SEC-2 / NFR-3. */
export function BootScreen({ result }: { result: BootResult | null }) {
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
        <div className="boot">
          <h1>Can’t open your database</h1>
          <p>
            Your Life DB data is encrypted with a key stored on this device, and that key couldn’t be found.
            This can happen after reinstalling the operating system or clearing the system keyring.
          </p>
          <p className="muted">Database: {result.path}</p>
        </div>
      );
    case 'too-new':
      return (
        <div className="boot">
          <h1>Please update Life DB</h1>
          <p>
            Your data was saved by a newer version of Life DB (schema v{result.dbVersion}; this app supports
            up to v{result.appVersion}). Install the latest version to open it. Your data has not been
            changed.
          </p>
        </div>
      );
    case 'error':
      return (
        <div className="boot">
          <h1>Something went wrong</h1>
          <p>Life DB couldn’t start. Your data has not been changed.</p>
          <pre className="mono small">{result.message}</pre>
        </div>
      );
    case 'ready':
      return null;
  }
}
