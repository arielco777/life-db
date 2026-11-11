import { useId, useState } from 'react';
import { useSetSetting, useSettings, useToday } from './hooks';
import { DATE_FORMATS, formatDate } from '@/domain/services/dateFormat';
import type { Settings } from '@/domain/types';

const HOURS = [0, 1, 2, 3, 4, 5, 6];
const hourLabel = (h: number) => (h === 0 ? 'Midnight' : `${h} a.m.`);

const THEMES: { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: 'Same as system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Settings → General (task 9.2): profile name, week start, day start, theme, date format (SET-2…4). */
export function GeneralPage() {
  const ids = useId();
  const settings = useSettings();
  const set = useSetSetting();
  const today = useToday();

  return (
    <section className="stack">
      <section className="card stack" aria-labelledby={`${ids}-you`}>
        <h2 id={`${ids}-you`}>You</h2>
        <NameField key={settings['profile.display_name']} saved={settings['profile.display_name']} />
      </section>

      <section className="card stack" aria-labelledby={`${ids}-days`}>
        <h2 id={`${ids}-days`}>Days and weeks</h2>
        <div className="field">
          <label htmlFor={`${ids}-week`}>Week starts on</label>
          <select
            id={`${ids}-week`}
            value={settings.week_start}
            onChange={(e) =>
              set.mutate({ key: 'week_start', value: e.target.value as Settings['week_start'] })
            }
          >
            <option value="mon">Monday</option>
            <option value="sun">Sunday</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-daystart`}>A new day starts at</label>
          <select
            id={`${ids}-daystart`}
            aria-describedby={`${ids}-daystart-hint`}
            value={settings.day_start_hour}
            onChange={(e) => set.mutate({ key: 'day_start_hour', value: Number(e.target.value) })}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <p id={`${ids}-daystart-hint`} className="small muted">
            {settings.day_start_hour === 0
              ? 'Each day starts at midnight.'
              : `Until ${hourLabel(settings.day_start_hour)}, the app still shows the day before, so a late night counts for that day. Entries you've already made stay on their dates.`}
          </p>
        </div>
      </section>

      <section className="card stack" aria-labelledby={`${ids}-look`}>
        <h2 id={`${ids}-look`}>Appearance</h2>
        <div className="field">
          <label htmlFor={`${ids}-theme`}>Theme</label>
          <select
            id={`${ids}-theme`}
            value={settings.theme}
            onChange={(e) => set.mutate({ key: 'theme', value: e.target.value as Settings['theme'] })}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-datefmt`}>Date format</label>
          <select
            id={`${ids}-datefmt`}
            value={settings.date_format}
            onChange={(e) => set.mutate({ key: 'date_format', value: e.target.value })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f.pattern} value={f.pattern}>
                {formatDate(today, f.pattern)}
              </option>
            ))}
          </select>
          <p className="small muted">Used for short dates. Headings keep the written-out form.</p>
        </div>
      </section>
    </section>
  );
}

/** Saves on blur (Enter blurs), so typing doesn't write a setting per keystroke. */
function NameField({ saved }: { saved: string }) {
  const id = useId();
  const set = useSetSetting();
  const [value, setValue] = useState(saved);
  const save = () => {
    const name = value.trim();
    if (name !== saved) set.mutate({ key: 'profile.display_name', value: name });
  };
  return (
    <div className="field">
      <label htmlFor={id}>Your name</label>
      <input
        id={id}
        value={value}
        maxLength={100}
        placeholder="Optional"
        autoComplete="given-name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <p className="small muted">Shown in the sidebar. It stays on this device.</p>
    </div>
  );
}
