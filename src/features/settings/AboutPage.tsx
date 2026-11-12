import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ISSUES_URL, issueUrl } from '@/app/diagnostics';
import { usePlatform } from '@/platform/PlatformProvider';
import { useToast } from '@/ui/Toast';

/** Settings → About (task 10.5): versions, privacy statement, support (DIST-4, DIST-5, DIST-6). */
export function AboutPage() {
  const platform = usePlatform();
  const toast = useToast();
  const info = useQuery({ queryKey: ['platform', 'app-info'], queryFn: () => platform.appInfo() });

  const report = () => {
    if (info.data) void platform.openInBrowser(issueUrl(info.data)).catch((e: unknown) => toast.error(e));
  };
  const openLog = () => {
    if (info.data) void platform.revealInFolder(info.data.logFile).catch((e: unknown) => toast.error(e));
  };

  return (
    <section className="stack">
      <section className="card stack" aria-labelledby="about-app">
        <h2 id="about-app">Life DB</h2>
        <p>A notebook for your habits and your days.</p>
        {info.data && (
          <dl className="about-versions">
            <dt>Version</dt>
            <dd>{info.data.version}</dd>
            <dt>Data version</dt>
            <dd>{info.data.schemaVersion}</dd>
          </dl>
        )}
      </section>

      <section className="card stack" aria-labelledby="about-privacy">
        <h2 id="about-privacy">Privacy</h2>
        <ul className="security-list">
          <li>
            Everything you enter stays on this device, in an encrypted file. There is no account and no cloud.
          </li>
          <li>
            Life DB sends nothing about you or how you use it: no analytics, no tracking, no crash reports.
          </li>
          <li>
            It doesn't go online at all. Checking for new versions will be the one exception when it arrives,
            and you'll be able to turn it off.
          </li>
          <li>
            Errors are written to a log file on this device. It records what went wrong, never what you wrote.
            It's only shared if you attach it to a report yourself.
          </li>
        </ul>
        <p className="small muted">
          Backups, restore and where your data lives are in <Link to="/settings/data">Data</Link>; encryption
          is explained in <Link to="/settings/security">Security</Link>.
        </p>
      </section>

      <section className="card stack" aria-labelledby="about-support">
        <h2 id="about-support">Problems and ideas</h2>
        <p>
          Found a bug, or have an idea? Open an issue on GitHub. The app and data versions are filled in for
          you, and you can review everything before sending.
        </p>
        <div className="row">
          <button type="button" onClick={report} disabled={!info.data}>
            Report an issue
          </button>
          <button type="button" className="secondary" onClick={openLog} disabled={!info.data}>
            Open log file
          </button>
        </div>
        <p className="small muted">
          Issues are public at <span className="data-path">{ISSUES_URL.replace(/^\w+:\/\//, '')}</span>. Look
          over the log before attaching it.
        </p>
      </section>
    </section>
  );
}
