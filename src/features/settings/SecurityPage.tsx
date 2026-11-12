import { useQuery } from '@tanstack/react-query';
import { dataKeys } from './DataPage';
import { usePlatform } from '@/platform/PlatformProvider';

/** Settings → Security (task 8.4): what's encrypted and where the key is (SEC-2, SEC-4). */
export function SecurityPage() {
  const platform = usePlatform();
  const info = useQuery({ queryKey: dataKeys.info, queryFn: () => platform.dataInfo() });
  const keyFile = info.data?.keyFile;

  return (
    <section className="stack">
      {keyFile && (
        <section className="card stack security-warning" aria-labelledby="security-key-file">
          <h2 id="security-key-file">Your key is stored in a file</h2>
          <p>
            No system keychain was available when Life DB was set up, so the encryption key is kept in a file
            that only your user account can read:
          </p>
          <p className="data-path">{keyFile}</p>
          <p>
            Anyone who gets a copy of both this file and your database, or a backup, can read your data. When
            you copy the data folder somewhere, leave this file out.
          </p>
        </section>
      )}

      <section className="card stack" aria-labelledby="security-encryption">
        <h2 id="security-encryption">Encryption</h2>
        <p>
          Everything you keep in Life DB (habits, goals, journal, events and settings) is stored in an
          encrypted file (AES-256). Backups are encrypted the same way. Opening them with any other program
          shows nothing readable.
        </p>
        <p>
          The key was created on this device the first time you opened the app, and is kept{' '}
          {keyFile
            ? 'in the file above.'
            : "in your system's keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux)."}{' '}
          You never need to type it. Nothing is sent anywhere.
        </p>
      </section>

      <section className="card stack" aria-labelledby="security-limits">
        <h2 id="security-limits">What it doesn't do</h2>
        <ul className="security-list">
          <li>
            Life DB has no password or lock of its own. Anyone who can use your unlocked user account can open
            it, so lock your computer when you step away.
          </li>
          <li>
            If the key is lost, for example when the system is reinstalled or the keychain is reset, the data
            and its backups can't be opened by anyone. Export to readable files will come in a later version.
          </li>
        </ul>
      </section>
    </section>
  );
}
