/**
 * Startup timing (NFR-1: cold start to an interactive daily view in under 2 s, task 9.6),
 * and a hook for work that shouldn't compete with the first screen.
 */
let interactive = false;
const waiting: (() => void)[] = [];

/** Called once the first daily view shows its data. Later calls do nothing. */
export function markInteractive(): void {
  if (interactive) return;
  interactive = true;
  // After the browser has painted that frame.
  requestAnimationFrame(() => {
    performance.mark('life-db:interactive');
    console.info(
      `[startup] daily view ready ${Math.round(performance.now())} ms after the page began loading`,
    );
    waiting.splice(0).forEach((fn) => fn());
  });
}

/**
 * Runs `fn` once the first screen is interactive, then `delayMs` later, so background
 * work (the daily backup holds the database while it copies) never delays it. If the
 * daily view never opens, it runs after `fallbackMs` anyway.
 */
export function afterInteractive(fn: () => void, { delayMs = 2000, fallbackMs = 8000 } = {}): void {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    setTimeout(fn, delayMs);
  };
  if (interactive) start();
  else {
    waiting.push(start);
    setTimeout(start, fallbackMs);
  }
}

/** Test hook: back to "not started". */
export function resetStartup(): void {
  interactive = false;
  waiting.length = 0;
}
