import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useRepositories } from '@/app/RepositoryProvider';
import type { HabitType } from '@/domain/types';

/** Dev-only check for Phase 1: create and list a habit and an entry through the real DB. */
export function DebugPage() {
  const repos = useRepositories();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<HabitType>('boolean');
  const [error, setError] = useState<string | null>(null);

  const habits = useQuery({ queryKey: ['debug', 'habits'], queryFn: () => repos.habits.list() });
  const entries = useQuery({
    queryKey: ['debug', 'entries'],
    queryFn: () => repos.entries.forRange({ from: '0000-01-01', to: '9999-12-31' }),
  });
  const categories = useQuery({ queryKey: ['debug', 'categories'], queryFn: () => repos.categories.list() });

  const refresh = () => qc.invalidateQueries({ queryKey: ['debug'] });
  const run = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const create = useMutation({
    mutationFn: () => repos.habits.create({ name, type }),
    onSuccess: () => {
      setName('');
      void refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  const sampleValue = (t: HabitType) => ({ boolean: 1, number: 2, duration: 30, rating: 7 })[t];

  return (
    <section>
      <h1 className="page-title">Debug</h1>
      <p className="muted">Development only. Talks to the encrypted database through the repository layer.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="row">
        <input
          aria-label="Habit name"
          placeholder="Habit name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select aria-label="Habit type" value={type} onChange={(e) => setType(e.target.value as HabitType)}>
          <option value="boolean">boolean</option>
          <option value="number">number</option>
          <option value="duration">duration</option>
          <option value="rating">rating</option>
        </select>
        <button type="submit" disabled={create.isPending}>
          Add habit
        </button>
      </form>

      <h2>Habits ({habits.data?.length ?? '…'})</h2>
      <ul className="plain">
        {habits.data?.map((h) => (
          <li key={h.id} className="row">
            <strong>{h.name}</strong>{' '}
            <span className="muted">
              {h.type} · from {h.startDate}
            </span>
            <button onClick={run(async () => repos.entries.set(h.id, h.startDate, sampleValue(h.type)))}>
              Log sample entry
            </button>
            <button onClick={run(() => repos.habits.remove(h.id))}>Delete</button>
          </li>
        ))}
      </ul>

      <h2>Entries ({entries.data?.length ?? '…'})</h2>
      <ul className="plain mono">
        {entries.data?.map((e) => (
          <li key={e.id}>
            {e.date} · {habits.data?.find((h) => h.id === e.habitId)?.name ?? e.habitId} = {e.value}
          </li>
        ))}
      </ul>

      <h2>Categories</h2>
      <p className="muted">{categories.data?.map((c) => c.name).join(' · ')}</p>
    </section>
  );
}
