// @vitest-environment jsdom
import { describeError, installErrorLogging, ISSUES_URL, issueUrl, scrub } from './diagnostics';

describe('diagnostics (DIST-6, SEC-3)', () => {
  it('scrubs quoted values out of messages', () => {
    expect(scrub('A habit named "Run with Sam" already exists')).toBe('A habit named "…" already exists');
    expect(scrub(`Unexpected token 'D', "Dear diary" is not valid JSON`)).toBe(
      'Unexpected token "…", "…" is not valid JSON',
    );
    expect(scrub('Cannot read properties of undefined (reading `x`) “smart” ‘quotes’')).toBe(
      'Cannot read properties of undefined (reading "…") "…" "…"',
    );
  });

  it('describes an error with its type, scrubbed message and stack', () => {
    const e = new TypeError('bad value "secret"');
    e.stack = 'TypeError: bad value "secret"\n    at save (app.js:1:2)\n    at run (app.js:3:4)';
    expect(describeError(e)).toBe(
      'TypeError: bad value "…"\n    at save (app.js:1:2)\n    at run (app.js:3:4)',
    );
    expect(describeError('plain "text"')).toBe('plain "…"');
    expect(describeError({ some: 'object' })).toBe('Non-error value thrown');
  });

  it('forwards uncaught errors and rejections to the log', () => {
    const platform = { log: vi.fn() };
    const off = installErrorLogging(platform);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom "journal text"') }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.assign(rejection, { reason: new Error('nope') });
    window.dispatchEvent(rejection);
    off();
    const after = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.assign(after, { reason: new Error('after') });
    window.dispatchEvent(after);
    expect(platform.log.mock.calls.map(([level, msg]) => [level, (msg as string).split('\n')[0]])).toEqual([
      ['error', 'Uncaught Error: boom "…"'],
      ['error', 'Unhandled rejection Error: nope'],
    ]);
  });

  it('builds a prefilled issue link without user content', () => {
    const url = issueUrl({ version: '1.0.0', schemaVersion: 3 }, 'Error: failed on "My habit"');
    expect(url.startsWith(`${ISSUES_URL}/new?body=`)).toBe(true);
    const body = decodeURIComponent(url.split('body=')[1]!);
    expect(body).toContain('Life DB 1.0.0 · data version 3');
    expect(body).toContain('Error: failed on "…"');
    expect(body).not.toContain('My habit');
  });
});
