import type { RepoContext } from '../context';
import { DomainError } from '@/domain/errors';
import { DATE_FORMATS } from '@/domain/services/dateFormat';
import type { SettingsRepository } from '@/domain/repositories';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/types';

const validators: { [K in keyof Settings]: (v: unknown) => boolean } = {
  'profile.display_name': (v) => typeof v === 'string' && v.length <= 100,
  week_start: (v) => v === 'mon' || v === 'sun',
  day_start_hour: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6,
  theme: (v) => v === 'light' || v === 'dark' || v === 'system',
  date_format: (v) => DATE_FORMATS.some((f) => f.pattern === v),
  'backup.auto_enabled': (v) => typeof v === 'boolean',
  'backup.keep_count': (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100,
  'updates.enabled': (v) => typeof v === 'boolean',
  'onboarding.completed': (v) => typeof v === 'boolean',
  'day.group_by_category': (v) => typeof v === 'boolean',
};

/** Key/value settings stored as JSON; missing or invalid keys fall back to DEFAULT_SETTINGS. */
export function createSettingsRepository(ctx: RepoContext): SettingsRepository {
  const { db } = ctx;
  const decode = <K extends keyof Settings>(key: K, raw: string | undefined): Settings[K] => {
    if (raw === undefined) return DEFAULT_SETTINGS[key];
    try {
      const v = JSON.parse(raw);
      return validators[key](v) ? v : DEFAULT_SETTINGS[key];
    } catch {
      return DEFAULT_SETTINGS[key];
    }
  };

  return {
    async getAll() {
      const rows = await db.query<{ key: string; value: string }>('SELECT key, value FROM settings');
      const raw = new Map(rows.map((r) => [r.key, r.value]));
      const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
        out[key] = decode(key, raw.get(key));
      return out as unknown as Settings;
    },
    async get(key) {
      const rows = await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
      return decode(key, rows[0]?.value);
    },
    async set(key, value) {
      if (!(key in validators) || !validators[key](value))
        throw new DomainError('validation', `Invalid value for setting ${String(key)}`);
      await db.execute(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), ctx.now()],
      );
    },
  };
}
