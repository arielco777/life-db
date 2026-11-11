import { backupFileName, dailyBackup, formatBytes, withBackupExtension } from './backup';

describe('backup file names', () => {
  it('suggests a dated name', () => {
    expect(backupFileName('2026-08-14')).toBe('life-db-2026-08-14.lifedb');
  });

  it.each([
    ['/home/me/backup', '/home/me/backup.lifedb'],
    ['/home/me/backup.lifedb', '/home/me/backup.lifedb'],
    ['/home/me/backup.db', '/home/me/backup.db'],
    ['/home/me.v2/backup', '/home/me.v2/backup.lifedb'],
    ['C:\\Users\\me\\backup', 'C:\\Users\\me\\backup.lifedb'],
    ['/home/me/.backup', '/home/me/.backup.lifedb'],
  ])('%s → %s', (input, expected) => {
    expect(withBackupExtension(input)).toBe(expected);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1023, '1023 bytes'],
    [1024, '1.0 KB'],
    [2_516_582, '2.4 MB'],
    [52_428_800, '50 MB'],
    [3 * 1024 ** 3, '3.0 GB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('dailyBackup (EXP-6)', () => {
  it('backs up with the kept count when on, and not at all when off', async () => {
    const platform = { autoBackup: vi.fn(async () => '/b/auto-2026-08-14.lifedb') };
    const on = { 'backup.auto_enabled': true, 'backup.keep_count': 5 };
    expect(await dailyBackup(platform, on, '2026-08-14')).toBe('/b/auto-2026-08-14.lifedb');
    expect(platform.autoBackup).toHaveBeenCalledWith('2026-08-14', 5);
    expect(await dailyBackup(platform, { ...on, 'backup.auto_enabled': false }, '2026-08-15')).toBeNull();
    expect(platform.autoBackup).toHaveBeenCalledTimes(1);
  });
});
