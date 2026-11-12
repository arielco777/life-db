import { createContext, useContext, type ReactNode } from 'react';
import type { Repositories } from '@/domain/repositories';

const RepositoryContext = createContext<Repositories | null>(null);

/** The only way UI code reaches data (FC-3). */
export function RepositoryProvider({ repos, children }: { repos: Repositories; children: ReactNode }) {
  return <RepositoryContext.Provider value={repos}>{children}</RepositoryContext.Provider>;
}

export function useRepositories(): Repositories {
  const repos = useContext(RepositoryContext);
  if (!repos) throw new Error('useRepositories() used outside <RepositoryProvider>');
  return repos;
}
