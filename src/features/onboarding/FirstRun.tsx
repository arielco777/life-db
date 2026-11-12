import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { SUGGESTIONS } from './suggestions';
import { useRepositories } from '@/app/RepositoryProvider';
import { habitKeys } from '@/features/habits/hooks';
import { settingsKeys } from '@/features/settings/hooks';
import { useToast } from '@/ui/Toast';

const FIRST_RUN_KEY = ['first-run'] as const;

/**
 * Shows the first-run screen (task 9.1, SET-1) until it's been completed or skipped, then
 * the app. A database that already has habits or journal entries (made before onboarding
 * existed) counts as set up, so existing users never see it.
 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const { settings, habits, journal } = useRepositories();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: FIRST_RUN_KEY,
    queryFn: async () => {
      if ((await settings.getAll())['onboarding.completed']) return 'done';
      const [h, j] = await Promise.all([
        habits.list({ includeArchived: true }),
        journal.list(undefined, { limit: 1 }),
      ]);
      if (h.length === 0 && j.entries.length === 0) return 'first-run';
      await settings.set('onboarding.completed', true);
      return 'done';
    },
    staleTime: Infinity,
  });

  if (status.isPending) return null; // a local read; avoids flashing the app first
  if (status.data === 'first-run')
    return (
      <Onboarding
        onDone={() => {
          qc.setQueryData(FIRST_RUN_KEY, 'done');
          void qc.invalidateQueries({ queryKey: settingsKeys.all });
          void qc.invalidateQueries({ queryKey: habitKeys.all });
        }}
      />
    );
  // An error reading the state shouldn't lock anyone out of their data.
  return children;
}

function Onboarding({ onDone }: { onDone(): void }) {
  const ids = useId();
  const { settings, habits } = useRepositories();
  const toast = useToast();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (habitName: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(habitName)) next.delete(habitName);
      else next.add(habitName);
      return next;
    });

  const finish = async (withChoices: boolean) => {
    setBusy(true);
    try {
      if (withChoices) {
        if (name.trim()) await settings.set('profile.display_name', name.trim());
        for (const s of SUGGESTIONS) if (picked.has(s.habit.name)) await habits.create(s.habit);
      }
      await settings.set('onboarding.completed', true);
      onDone();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void finish(true);
  };

  return (
    <main className="page onboarding">
      <form className="stack" onSubmit={submit} aria-labelledby={`${ids}-title`}>
        <header>
          <h1 id={`${ids}-title`} className="page-title">
            Welcome to Life DB
          </h1>
          <p>
            A notebook for your habits and your days. Everything stays on this computer, in an encrypted file.
          </p>
        </header>

        <div className="field">
          <label htmlFor={`${ids}-name`}>What should we call you?</label>
          <input
            id={`${ids}-name`}
            value={name}
            maxLength={100}
            placeholder="Optional"
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <fieldset className="field">
          <legend>Start with a few habits?</legend>
          <ul className="plain onboarding-habits">
            {SUGGESTIONS.map((s) => (
              <li key={s.habit.name}>
                <label className="row check-row">
                  <input
                    type="checkbox"
                    checked={picked.has(s.habit.name)}
                    onChange={() => toggle(s.habit.name)}
                  />
                  <span>
                    {s.habit.name} <span className="small muted">· {s.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="small muted">You can change these, or add your own, at any time.</p>
        </fieldset>

        <div className="row">
          <button type="submit" disabled={busy}>
            {picked.size > 0 ? `Start with ${picked.size} habit${picked.size === 1 ? '' : 's'}` : 'Start'}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void finish(false)}>
            Skip
          </button>
        </div>
      </form>
    </main>
  );
}
