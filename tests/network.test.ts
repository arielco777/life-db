import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The app makes no network requests (NFR-2, NFR-5, task 9.7). Phase 10's update check will
 * be the one exception: tauri-plugin-updater makes it from Rust, and its host is added here
 * and to the CSP then.
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

/** Sources that stay on the device: the app's own files, inline data, and Tauri's IPC. */
const LOCAL = new Set(["'self'", "'unsafe-inline'", 'data:', 'ipc:', 'http://ipc.localhost']);

describe('no network access (NFR-2, task 9.7)', () => {
  it('the CSP allows only local sources, in every directive', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    for (const [directive, sources] of Object.entries(csp))
      for (const s of sources) expect(LOCAL.has(s), `${directive} allows ${s}`).toBe(true);
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
    const offenders = files.filter((f) => NETWORK.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
