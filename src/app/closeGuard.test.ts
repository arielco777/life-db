import { flushBeforeClose, onAppClose } from './closeGuard';

describe('closeGuard (JRN-4)', () => {
  it('waits for every registered flusher, and forgets unregistered ones', async () => {
    const done: string[] = [];
    const offA = onAppClose(async () => {
      await new Promise((r) => setTimeout(r, 20));
      done.push('a');
    });
    const offB = onAppClose(async () => {
      done.push('b');
    });
    offB();
    await flushBeforeClose();
    expect(done).toEqual(['a']);
    offA();
  });

  it('never blocks closing on a stuck or failing save', async () => {
    const offStuck = onAppClose(() => new Promise(() => {}));
    const offFail = onAppClose(() => Promise.reject(new Error('disk full')));
    const t = Date.now();
    await flushBeforeClose(50);
    expect(Date.now() - t).toBeLessThan(1000);
    offStuck();
    offFail();
  });
});
