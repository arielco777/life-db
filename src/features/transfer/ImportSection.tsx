import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRepositories } from '@/app/RepositoryProvider';
import { isDomainError } from '@/domain/errors';
import {
  parseExport,
  TABLE_LABELS,
  type ImportMode,
  type ImportPlan,
  type TableCounts,
} from '@/domain/importFile';
import { EXPORT_TABLE_NAMES, type ExportFile, type ExportTable } from '@/domain/transfer';
import { usePlatform } from '@/platform/PlatformProvider';
import { useToast } from '@/ui/Toast';

/**
 * Settings → Data → Import (task 17.7, IMP-1..7): choose a Life DB export, unlock it if
 * protected, choose Replace or Merge, see what will change, import (after a `pre-import`
 * backup), then keep the result or undo it.
 */
export function ImportSection() {
  const platform = usePlatform();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ path: string; protected: boolean; file?: ExportFile } | null>(null);
  const [reading, setReading] = useState(false);

  const choose = async () => {
    setError(null);
    try {
      const path = await platform.pickOpenPath({
        title: 'Choose a Life DB export',
        filters: [
          { name: 'Life DB export', extensions: ['json', 'lifedb-export'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (!path) return;
      setReading(true);
      const read = await platform.readExport(path);
      if (read.state === 'needs_password') setOpened({ path, protected: true });
      else if (read.state === 'ok') setOpened({ path, protected: false, file: parseExport(read.text) });
      else setError('This file isn’t a Life DB export.');
    } catch (e) {
      if (isDomainError(e)) setError(e.message);
      else toast.error(e);
    } finally {
      setReading(false);
    }
  };

  return (
    <section className="card stack" aria-labelledby="data-import">
      <h2 id="data-import">Import</h2>
      <p>
        Bring in a Life DB export, for example from your other computer. You choose whether it replaces what’s
        here or is combined with it, and see what will change before anything does.
      </p>
      <div className="row">
        <button type="button" className="secondary" disabled={reading} onClick={() => void choose()}>
          {reading ? 'Reading…' : 'Import a Life DB export…'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {opened && <ImportDialog {...opened} onClose={() => setOpened(null)} />}
    </section>
  );
}

type Step =
  | { kind: 'password'; wrong: boolean }
  | { kind: 'mode'; file: ExportFile }
  | { kind: 'preview'; file: ExportFile; plan: ImportPlan }
  | { kind: 'done'; plan: ImportPlan; backup: string };

const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

function ImportDialog({
  path,
  file,
  onClose,
}: {
  path: string;
  protected: boolean;
  file?: ExportFile;
  onClose(): void;
}) {
  const platform = usePlatform();
  const repos = useRepositories();
  const [step, setStep] = useState<Step>(file ? { kind: 'mode', file } : { kind: 'password', wrong: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs a step's action, turning failures into a message in the dialog. */
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isDomainError(e) || e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // After an import every screen shows old data: start the app again, as after a restore.
  const close = step.kind === 'done' ? () => platform.reloadApp() : onClose;

  return (
    <Modal onClose={busy ? undefined : close} title={TITLES[step.kind]} stepKey={step.kind}>
      {step.kind === 'password' && (
        <PasswordStep
          name={fileName(path)}
          wrong={step.wrong}
          busy={busy}
          onCancel={onClose}
          onSubmit={(password) =>
            void attempt(async () => {
              const read = await platform.readExport(path, password);
              if (read.state === 'wrong_password') setStep({ kind: 'password', wrong: true });
              else if (read.state === 'ok') setStep({ kind: 'mode', file: parseExport(read.text) });
              else throw new Error('This file isn’t a Life DB export.');
            })
          }
        />
      )}
      {step.kind === 'mode' && (
        <ModeStep
          file={step.file}
          name={fileName(path)}
          busy={busy}
          onCancel={onClose}
          onNext={(mode) =>
            void attempt(async () => {
              setStep({ kind: 'preview', file: step.file, plan: await repos.transfer.plan(step.file, mode) });
            })
          }
        />
      )}
      {step.kind === 'preview' && (
        <PreviewStep
          plan={step.plan}
          busy={busy}
          onBack={() => setStep({ kind: 'mode', file: step.file })}
          onImport={() =>
            void attempt(async () => {
              const backup = await platform.safetyBackup('pre-import');
              await repos.transfer.apply(step.plan);
              setStep({ kind: 'done', plan: step.plan, backup });
            })
          }
        />
      )}
      {step.kind === 'done' && (
        <DoneStep
          plan={step.plan}
          busy={busy}
          onDone={() => platform.reloadApp()}
          onUndo={() =>
            void attempt(async () => {
              await platform.restoreFrom(step.backup);
              platform.reloadApp();
            })
          }
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

const TITLES: Record<Step['kind'], string> = {
  password: 'This export is protected',
  mode: 'Import this export?',
  preview: 'What will change',
  done: 'Imported',
};

/**
 * A dialog that moves through steps. Focus goes to the heading on every step, so screen
 * readers announce it; Tab stays inside; Escape and the backdrop call `onClose` (absent
 * while busy). Focus returns to where it was when the dialog closes.
 */
function Modal({
  title,
  stepKey,
  onClose,
  children,
}: {
  title: string;
  stepKey: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    // Steps with a field focus it themselves (autoFocus); others focus the heading.
    if (!headingRef.current?.parentElement?.querySelector('[autofocus], [data-autofocus]'))
      headingRef.current?.focus();
  }, [stepKey]);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog dialog-wide"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose?.();
          } else if (e.key === 'Tab') {
            const focusable = [
              ...e.currentTarget.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]'),
            ].filter((el) => !(el as HTMLButtonElement).disabled);
            const first = focusable[0];
            const last = focusable.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function PasswordStep({
  name,
  wrong,
  busy,
  onCancel,
  onSubmit,
}: {
  name: string;
  wrong: boolean;
  busy: boolean;
  onCancel(): void;
  onSubmit(password: string): void;
}) {
  const id = useId();
  const [password, setPassword] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (password) onSubmit(password);
      }}
    >
      <div className="dialog-body stack-sm">
        <p>
          <strong>{name}</strong> was protected with a password when it was exported.
        </p>
        <div className="field">
          <label htmlFor={id}>Password</label>
          <input
            id={id}
            type="password"
            autoComplete="off"
            autoFocus
            data-autofocus
            value={password}
            aria-invalid={wrong}
            aria-describedby={wrong ? `${id}-wrong` : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {wrong && (
            <p id={`${id}-wrong`} className="field-msg error" role="alert">
              That password isn’t right.
            </p>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !password}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    </form>
  );
}

function ModeStep({
  file,
  name,
  busy,
  onCancel,
  onNext,
}: {
  file: ExportFile;
  name: string;
  busy: boolean;
  onCancel(): void;
  onNext(mode: ImportMode): void;
}) {
  const ids = useId();
  const [mode, setMode] = useState<ImportMode>('merge');
  const exported = new Date(file.exportedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const options: [ImportMode, string, string][] = [
    [
      'merge',
      'Combine with what’s here',
      'Adds what’s new and keeps the most recent version of anything that’s in both. Tags and categories with the same name become one.',
    ],
    [
      'replace',
      'Replace everything here',
      'Removes everything in Life DB and puts the export’s data in its place, including its preferences. For moving to a new computer.',
    ],
  ];
  return (
    <>
      <div className="dialog-body stack-sm">
        <p>
          <strong>{name}</strong>, exported {exported} from Life DB {file.appVersion}.
        </p>
        <fieldset className="field">
          <legend>How should it be imported?</legend>
          {options.map(([value, label, hint]) => (
            <label key={value} className="row check-row import-option">
              <input
                type="radio"
                name={`${ids}-mode`}
                checked={mode === value}
                onChange={() => setMode(value)}
                aria-describedby={`${ids}-${value}`}
              />
              <span className="stack-xs">
                <span>{label}</span>
                <span id={`${ids}-${value}`} className="small muted">
                  {hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="small muted">Nothing changes until you’ve seen what the import will do.</p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={() => onNext(mode)} disabled={busy}>
          {busy ? 'Checking…' : 'Next'}
        </button>
      </div>
    </>
  );
}

/** "1,204 habit entries, 3 habits and 1 goal" for one kind of change, or null if none. */
function listOf(counts: Record<ExportTable, TableCounts>, kind: keyof TableCounts): string | null {
  const parts = EXPORT_TABLE_NAMES.filter((t) => counts[t][kind] > 0).map((t) => {
    const n = counts[t][kind];
    return `${n.toLocaleString()} ${n === 1 ? TABLE_LABELS[t].one : TABLE_LABELS[t].many}`;
  });
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function Summary({ plan, done }: { plan: ImportPlan; done?: boolean }) {
  const { counts, mode, combined } = plan;
  const add = listOf(counts, 'add');
  const update = listOf(counts, 'update');
  const remove = listOf(counts, 'remove');
  const merged = [
    combined.tags && `${combined.tags} ${combined.tags === 1 ? 'tag' : 'tags'}`,
    combined.categories && `${combined.categories} ${combined.categories === 1 ? 'category' : 'categories'}`,
  ].filter(Boolean);
  if (mode === 'replace')
    return (
      <ul className="import-summary">
        <li>
          <strong>{done ? 'Removed' : 'Removes'}</strong> everything that was in Life DB
          {remove ? `: ${remove}` : ''}.
        </li>
        <li>
          <strong>{done ? 'Added' : 'Adds'}</strong> {add ?? 'nothing: the export is empty'}
          {add ? ' from the export' : ''}.
        </li>
      </ul>
    );
  if (!add && !update && !remove && merged.length === 0)
    return <p>Everything in this export is already here, so nothing will change.</p>;
  return (
    <ul className="import-summary">
      {add && (
        <li>
          <strong>{done ? 'Added' : 'Adds'}</strong> {add}.
        </li>
      )}
      {update && (
        <li>
          <strong>{done ? 'Updated' : 'Updates'}</strong> {update} with the export’s newer version.
        </li>
      )}
      {remove && (
        <li>
          <strong>{done ? 'Removed' : 'Removes'}</strong> {remove} deleted on the other side since.
        </li>
      )}
      {merged.length > 0 && (
        <li>
          <strong>{done ? 'Combined' : 'Combines'}</strong> {merged.join(' and ')} with yours of the same
          name.
        </li>
      )}
    </ul>
  );
}

function PreviewStep({
  plan,
  busy,
  onBack,
  onImport,
}: {
  plan: ImportPlan;
  busy: boolean;
  onBack(): void;
  onImport(): void;
}) {
  const kept = EXPORT_TABLE_NAMES.reduce((n, t) => n + plan.counts[t].unchanged, 0);
  return (
    <>
      <div className="dialog-body stack-sm">
        <Summary plan={plan} />
        {plan.mode === 'merge' && kept > 0 && (
          <p className="small muted">
            {kept.toLocaleString()} {kept === 1 ? 'record is' : 'records are'} already up to date here, or
            newer here, and stay as they are.
          </p>
        )}
        <p className="small muted">
          Your current data is saved to the backups folder first, and you can undo the import right after.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className={plan.mode === 'replace' ? 'danger' : undefined}
          onClick={onImport}
          disabled={busy}
        >
          {busy ? 'Importing…' : plan.mode === 'replace' ? 'Replace everything' : 'Import'}
        </button>
      </div>
    </>
  );
}

function DoneStep({
  plan,
  busy,
  onDone,
  onUndo,
}: {
  plan: ImportPlan;
  busy: boolean;
  onDone(): void;
  onUndo(): void;
}) {
  return (
    <>
      <div className="dialog-body stack-sm" role="status">
        <Summary plan={plan} done />
      </div>
      <p className="small muted">The app restarts to show the imported data.</p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onUndo} disabled={busy}>
          {busy ? 'Undoing…' : 'Undo import'}
        </button>
        <button type="button" onClick={onDone} disabled={busy}>
          Done
        </button>
      </div>
    </>
  );
}
