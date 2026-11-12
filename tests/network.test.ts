import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The app's only network request is the update check (NFR-2, NFR-5, tasks 9.7, 10.3). It's
 * made from Rust by tauri-plugin-updater, so the webview's CSP stays local-only.
 */
const root = join(__dirname, '..');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));

/** The CSP as { directive: [sources] }. */
const csp: Record<string, string[]> = Object.fromEntries(
  (conf.app.security.csp as string)
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((parts) => parts[0])
    .map(([name, ...sources]) => [name!, sources]),
);

/**
 * Web pages the app may open in the user's browser (not requests the app makes itself);
 * the opener capability allows the same and nothing else.
 */
const BROWSER_LINKS = ['https://github.com/arielco777/life-db/issues'];

/** Sources that stay on the device: the app's own files, inline data, and Tauri's IPC. */
const LOCAL = new Set(["'self'", "'unsafe-inline'", 'data:', 'ipc:', 'http://ipc.localhost']);

describe('no network access (NFR-2, task 9.7)', () => {
  it('the CSP allows only local sources, in every directive', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    for (const [directive, sources] of Object.entries(csp))
      for (const s of sources) expect(LOCAL.has(s), `${directive} allows ${s}`).toBe(true);
  });

  it('the app may open only the issue tracker in a browser', () => {
    const caps = JSON.parse(readFileSync(join(root, 'src-tauri/capabilities/default.json'), 'utf8'));
    const open = caps.permissions.find(
      (p: unknown) =>
        typeof p === 'object' && (p as { identifier: string }).identifier === 'opener:allow-open-url',
    );
    expect(open.allow).toEqual([{ url: `${BROWSER_LINKS[0]}/*` }]);
    expect(caps.permissions).not.toContain('opener:default');
    expect(caps.permissions).not.toContain('opener:allow-default-urls');
  });

  it("updates come only from this project's GitHub Releases, signed (DIST-2)", () => {
    expect(conf.plugins.updater.endpoints).toEqual([
      'https://github.com/arielco777/life-db/releases/latest/download/latest.json',
    ]);
    expect(atob(conf.plugins.updater.pubkey)).toMatch(/^untrusted comment: minisign public key/);
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
  });

  it('connect-src is only Tauri IPC', () => {
    expect(csp['connect-src']).toEqual(['ipc:', 'http://ipc.localhost']);
  });

  it('no frontend code calls a network API or loads a remote URL', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|css|html)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    files.push(join(root, 'index.html'));
    const NETWORK = /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\/(?!ipc\.localhost)/;
    const offenders = files.filter((f) => {
      let text = readFileSync(f, 'utf8');
      for (const link of BROWSER_LINKS) text = text.replaceAll(link, '');
      return NETWORK.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
