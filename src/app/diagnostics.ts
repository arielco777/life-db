import type { PlatformService } from '@/platform/PlatformService';

/** Where "Report an issue" goes (DIST-4). */
export const ISSUES_URL = 'https://github.com/arielco777/life-db/issues';

/**
 * Removes anything quoted from text bound for the log or an issue (SEC-3). Error messages
 * quote values: a habit name in "already exists", the text in a JSON parse error. The
 * shape of the message and the code locations are what a bug report needs.
 */
export function scrub(text: string): string {
  return text.replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|“[^”\n]*”|‘[^’\n]*’/g, '"…"');
}

/** One log entry for an error: type, scrubbed message and the top of the stack. */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const stack = (e.stack ?? '')
      .split('\n')
      .filter((l) => /^\s*at |@/.test(l))
      .slice(0, 8)
      .join('\n');
    return scrub(`${e.name}: ${e.message}${stack ? `\n${stack}` : ''}`);
  }
  return scrub(typeof e === 'string' ? e : 'Non-error value thrown');
}

/** Sends uncaught errors and unhandled promise rejections to the log file (DIST-6). */
export function installErrorLogging(platform: Pick<PlatformService, 'log'>): () => void {
  const onError = (event: ErrorEvent) =>
    platform.log('error', `Uncaught ${describeError(event.error ?? event.message)}`);
  const onRejection = (event: PromiseRejectionEvent) =>
    platform.log('error', `Unhandled rejection ${describeError(event.reason)}`);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * A new-issue link with the app and data versions filled in. The user sees and edits it on
 * GitHub before anything is sent; an error, if given, is scrubbed first.
 */
export function issueUrl(info: { version: string; schemaVersion: number }, error?: string): string {
  const body = [
    '**What happened?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '---',
    `Life DB ${info.version} · data version ${info.schemaVersion} · ${navigator.platform || 'unknown OS'}`,
    ...(error ? ['', '```', scrub(error), '```'] : []),
  ].join('\n');
  return `${ISSUES_URL}/new?body=${encodeURIComponent(body)}`;
}
