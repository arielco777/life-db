import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformService } from './PlatformService';

const PlatformContext = createContext<PlatformService | null>(null);

/** Provides the device's PlatformService (FC-4). */
export function PlatformProvider({ platform, children }: { platform: PlatformService; children: ReactNode }) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformService {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('usePlatform() used outside <PlatformProvider>');
  return platform;
}
