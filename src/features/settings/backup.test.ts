import { backupFileName, formatBytes, withBackupExtension } from './backup';

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
