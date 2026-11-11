import { isTauri } from '@tauri-apps/api/core';

/**
 * Work that must finish before the app closes, such as an editor's unsaved text (JRN-4).
 * Each flusher returns a promise; the window closes once they all settle, or after
 * `CLOSE_TIMEOUT_MS` so a stuck save can never keep the app from closing.
 */
type Flusher = () => Promise<unknown>;
const flushers = new Set<Flusher>();
const CLOSE_TIMEOUT_MS = 3000;

/** Registers `fn` to run before the app closes. Returns the unregister function. */
export function onAppClose(fn: Flusher): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/** Runs every registered flusher; resolves when all settle or the timeout passes. */
export function flushBeforeClose(timeoutMs = CLOSE_TIMEOUT_MS): Promise<void> {
  const all = Promise.allSettled([...flushers].map((f) => f()));
  return Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]).then(() => undefined);
}

/**
 * In Tauri, holds the window's close until pending saves finish (needs the
 * `core:window:allow-destroy` permission). In a plain browser, `pagehide` is best effort.
 */
let installed = false;
export async function installCloseGuard(): Promise<void> {
  if (installed) return; // StrictMode runs effects twice in development
  installed = true;
  if (!isTauri()) {
    window.addEventListener('pagehide', () => void flushBeforeClose());
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().onCloseRequested(async () => {
    await flushBeforeClose();
  });
}
