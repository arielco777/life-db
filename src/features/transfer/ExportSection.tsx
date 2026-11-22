import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { buildHabitCsv, buildJournalFiles, buildJsonExport, type DateLimits } from './build';
import { useRepositories } from '@/app/RepositoryProvider';
import type { CsvLayout } from '@/domain/services/csvExport';
import { journalFolderName } from '@/domain/services/markdownExport';
import { withExtension } from '@/features/settings/backup';
import { useToday } from '@/features/settings/hooks';
import { usePlatform } from '@/platform/PlatformProvider';
import { Field } from '@/ui/Field';
import { useToast } from '@/ui/Toast';

/** Shortest export password (EXP-8; Rust refuses shorter ones too). */
export const MIN_PASSWORD = 8;

/**
 * Settings → Data → Export (task 16.7): everything as JSON, optionally password-protected
 * (EXP-1, EXP-8); habit history as CSV (EXP-2); the journal as Markdown files (EXP-3).
 */
export function ExportSection() {
  return (
    <section className="card stack" aria-labelledby="data-export">
      <h2 id="data-export">Export</h2>
      <p>
        Save your data as files you can read, keep, and open in other apps. An export of everything can be
        imported back into Life DB, on this computer or another one.
      </p>
      <JsonExport />
      <CsvExport />
      <MarkdownExport />
    </section>
  );
}

/** "Saved to …  Show in folder" after an export. */
function Saved({ what, path }: { what: string; path: string }) {
  const platform = usePlatform();
  const toast = useToast();
  return (
    <p className="small data-result" role="status">
      {what} <span className="data-path">{path}</span>{' '}
      <button
        type="button"
        className="link-button"
        onClick={() => void platform.revealInFolder(path).catch((e: unknown) => toast.error(e))}
      >
        Show in folder
      </button>
    </p>
  );
}

const READABLE_WARNING = 'This file isn’t encrypted: anyone who has it can read everything in it.';

function JsonExport() {
  const ids = useId();
  const platform = usePlatform();
  const repos = useRepositories();
  const toast = useToast();
  const today = useToday();
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [tried, setTried] = useState(false);

  const tooShort = protect && [...password].length < MIN_PASSWORD;
  const mismatch = protect && !tooShort && password !== repeat;

  const run = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const ext = protect ? 'lifedb-export' : 'json';
      const chosen = await platform.pickSavePath({
        title: 'Save export',
        defaultName: `life-db-export-${today}.${ext}`,
        filters: [
          protect
            ? { name: 'Protected Life DB export', extensions: [ext] }
            : { name: 'Life DB export (JSON)', extensions: [ext] },
        ],
      });
      if (!chosen) return null;
      const path = withExtension(chosen, ext);
      const { version } = await platform.appInfo();
      const text = await buildJsonExport(repos, version);
      await platform.writeExport(path, text, protect ? password : undefined);
      return path;
    },
    onSuccess: (path) => {
      if (!path) return;
      // Don't keep the password around once it has been used.
      setPassword('');
      setRepeat('');
      setTried(false);
    },
    onError: (e) => toast.error(e),
  });

  return (
    <section className="stack-sm" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>Everything (JSON)</h3>
      <p className="small muted">
        Habits and their history, goals, journal, events, categories, tags and your preferences.
      </p>
      <label className="row check-row">
        <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
        <span>Protect with a password</span>
      </label>
      {protect ? (
        <>
          <div className="form-grid">
            <Field
              label="Password"
              id={`${ids}-pw`}
              hint={`at least ${MIN_PASSWORD} characters`}
              error={tried && tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
            >
              <input
                id={`${ids}-pw`}
                type="password"
                autoComplete="new-password"
                value={password}
                aria-invalid={tried && tooShort}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field
              label="Repeat password"
              id={`${ids}-pw2`}
              error={tried && mismatch ? 'The passwords don’t match.' : undefined}
            >
              <input
                id={`${ids}-pw2`}
                type="password"
                autoComplete="new-password"
                value={repeat}
                aria-invalid={tried && mismatch}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Field>
          </div>
          <p className="small muted">
            Without this password the export can’t be opened. Life DB can’t recover a forgotten one.
          </p>
        </>
      ) : (
        <p className="small muted">{READABLE_WARNING}</p>
      )}
      <div className="row">
        <button
          type="button"
          disabled={run.isPending}
          onClick={() => {
            setTried(true);
            if (!tooShort && !mismatch) run.mutate();
          }}
        >
          {run.isPending ? 'Exporting…' : 'Export everything…'}
        </button>
      </div>
      {run.data && <Saved what="Export saved to" path={run.data} />}
    </section>
  );
}

/** Optional From / To dates. Empty means no limit on that side. */
function DateLimitsFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: DateLimits;
  onChange(v: DateLimits): void;
}) {
  const backwards = !!value.from && !!value.to && value.to < value.from;
  return (
    <div className="form-grid">
      <Field label="From" id={`${idPrefix}-from`} hint="optional">
        <input
          id={`${idPrefix}-from`}
          type="date"
          value={value.from ?? ''}
          onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
        />
      </Field>
      <Field
        label="To"
        id={`${idPrefix}-to`}
        hint="optional"
        error={backwards ? 'Choose a date on or after From.' : undefined}
      >
        <input
          id={`${idPrefix}-to`}
          type="date"
          value={value.to ?? ''}
          aria-invalid={backwards}
          onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
        />
      </Field>
    </div>
  );
}

const validDates = (d: DateLimits) => !d.from || !d.to || d.to >= d.from;

function CsvExport() {
  const ids = useId();
  const platform = usePlatform();
  const repos = useRepositories();
  const toast = useToast();
  const today = useToday();
  const [layout, setLayout] = useState<CsvLayout>('long');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dates, setDates] = useState<DateLimits>({});

  const run = useMutation({
    mutationFn: async (): Promise<string | null> => {
      const chosen = await platform.pickSavePath({
        title: 'Save habit history',
        defaultName: `life-db-habits-${today}.csv`,
        filters: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
      });
      if (!chosen) return null;
      const path = withExtension(chosen, 'csv');
      const { text } = await buildHabitCsv(repos, { layout, includeArchived, dates });
      await platform.writeExport(path, text);
      return path;
    },
    onError: (e) => toast.error(e),
  });

  const layouts: [CsvLayout, string][] = [
    ['long', 'One row per entry'],
    ['wide', 'One row per day'],
  ];
  return (
    <section className="stack-sm" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>Habit history (CSV)</h3>
      <p className="small muted">
        For Excel, LibreOffice or Google Sheets. Durations are in minutes; done/not done is 1 or 0.
      </p>
      <fieldset className="field">
        <legend>Layout</legend>
        <div className="segmented">
          {layouts.map(([value, label]) => (
            <label key={value} className={layout === value ? 'on' : undefined}>
              <input
                type="radio"
                name={`${ids}-layout`}
                checked={layout === value}
                onChange={() => setLayout(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <DateLimitsFields idPrefix={`${ids}-csv`} value={dates} onChange={setDates} />
      <label className="row check-row">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        <span>Include archived habits</span>
      </label>
      <p className="small muted">{READABLE_WARNING}</p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={run.isPending || !validDates(dates)}
          onClick={() => run.mutate()}
        >
          {run.isPending ? 'Exporting…' : 'Export habits…'}
        </button>
      </div>
      {run.data && <Saved what="Habit history saved to" path={run.data} />}
    </section>
  );
}

function MarkdownExport() {
  const ids = useId();
  const platform = usePlatform();
  const repos = useRepositories();
  const toast = useToast();
  const today = useToday();
  const [dates, setDates] = useState<DateLimits>({});
  const [empty, setEmpty] = useState(false);

  const run = useMutation({
    mutationFn: async (): Promise<{ folder: string; count: number } | null> => {
      setEmpty(false);
      const files = await buildJournalFiles(repos, dates);
      if (files.length === 0) {
        setEmpty(true);
        return null;
      }
      const parent = await platform.pickFolder('Choose where to save the journal');
      if (!parent) return null;
      const folder = await platform.writeFolder(parent, journalFolderName(today), files);
      return { folder, count: files.length };
    },
    onError: (e) => toast.error(e),
  });

  return (
    <section className="stack-sm" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>Journal (Markdown)</h3>
      <p className="small muted">
        One file per entry, in a new folder. Works with Obsidian and any text editor; each file starts with
        its date, title, tags and category.
      </p>
      <DateLimitsFields idPrefix={`${ids}-md`} value={dates} onChange={setDates} />
      <p className="small muted">{READABLE_WARNING.replace('This file isn’t', 'These files aren’t')}</p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={run.isPending || !validDates(dates)}
          onClick={() => run.mutate()}
        >
          {run.isPending ? 'Exporting…' : 'Export journal…'}
        </button>
      </div>
      {empty && (
        <p className="small" role="status">
          No journal entries {dates.from || dates.to ? 'in those dates' : 'yet'}, so there’s nothing to
          export.
        </p>
      )}
      {run.data && (
        <Saved
          what={`${run.data.count} ${run.data.count === 1 ? 'entry' : 'entries'} saved to`}
          path={run.data.folder}
        />
      )}
    </section>
  );
}
