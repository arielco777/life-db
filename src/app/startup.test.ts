import { afterInteractive, markInteractive, resetStartup } from './startup';

describe('startup (task 9.6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    resetStartup();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('background work waits for the first screen, then a little longer', () => {
    const work = vi.fn();
    afterInteractive(work, { delayMs: 2000 });
    vi.advanceTimersByTime(3000);
    expect(work).not.toHaveBeenCalled();
    markInteractive();
    vi.advanceTimersByTime(16 + 1999);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(20_000); // the fallback doesn't run it again
    expect(work).toHaveBeenCalledOnce();
  });

  it('runs anyway if the daily view never opens', () => {
    const work = vi.fn();
    afterInteractive(work, { delayMs: 0, fallbackMs: 8000 });
    vi.advanceTimersByTime(7999);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledOnce();
  });

  it('logs the time to the first interactive daily view once', () => {
    markInteractive();
    markInteractive();
    vi.advanceTimersByTime(16);
    expect(console.info).toHaveBeenCalledOnce();
    expect(vi.mocked(console.info).mock.calls[0]![0]).toMatch(/^\[startup\] daily view ready \d+ ms/);
  });
});
