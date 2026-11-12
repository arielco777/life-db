import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { FEATURE_V1_1, SHOW_DEBUG } from './features';
import { DebugPage } from '@/features/debug/DebugPage';
import { DayRoute } from '@/features/day/DayPage';
import { HabitRoutes } from '@/features/habits/HabitPages';
import { JournalRoutes } from '@/features/journal/JournalPages';
import { MonthRoute } from '@/features/month/MonthPage';
import { FirstRunGate } from '@/features/onboarding/FirstRun';
import { Placeholder } from '@/features/Placeholder';
import { useApplyTheme, useSettings } from '@/features/settings/hooks';
import { SettingsPage } from '@/features/settings/SettingsPage';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  v11?: boolean;
}

const NAV: NavItem[] = [
  { to: '/day', label: 'Today', icon: '◉' },
  { to: '/month', label: 'Month', icon: '▦' },
  { to: '/habits', label: 'Habits', icon: '✓' },
  { to: '/journal', label: 'Journal', icon: '✎' },
  { to: '/goals', label: 'Goals', icon: '◎', v11: true },
  { to: '/events', label: 'Events', icon: '✦', v11: true },
  { to: '/analytics', label: 'Analytics', icon: '∿', v11: true },
  { to: '/search', label: 'Search', icon: '⌕', v11: true },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

const visibleNav = NAV.filter((n) => FEATURE_V1_1 || !n.v11);

export function App() {
  useApplyTheme();
  return (
    <FirstRunGate>
      <Shell />
    </FirstRunGate>
  );
}

function Shell() {
  const name = useSettings()['profile.display_name'];
  // One boundary per screen: navigating away from a crashed screen recovers.
  const screen = useLocation().pathname.split('/')[1];
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="nav-brand">
          Life DB
          {name && <span className="nav-name">{name}</span>}
        </div>
        {visibleNav.map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-link">
            <span className="nav-icon" aria-hidden>
              {n.icon}
            </span>
            <span className="nav-label">{n.label}</span>
          </NavLink>
        ))}
        {SHOW_DEBUG && (
          <NavLink to="/debug" className="nav-link nav-debug">
            <span className="nav-icon" aria-hidden>
              ⚑
            </span>
            <span className="nav-label">Debug</span>
          </NavLink>
        )}
      </nav>
      <main className="page">
        <ErrorBoundary key={screen}>
          <Routes>
            <Route path="/" element={<Navigate to="/day" replace />} />
            <Route path="/day/:date?" element={<DayRoute />} />
            <Route path="/month/:ym?" element={<MonthRoute />} />
            <Route path="/habits/*" element={<HabitRoutes />} />
            <Route path="/journal/*" element={<JournalRoutes />} />
            <Route path="/settings/*" element={<SettingsPage />} />
            {FEATURE_V1_1 && (
              <>
                <Route path="/goals/*" element={<Placeholder title="Goals" phase="Phase 11" />} />
                <Route path="/events" element={<Placeholder title="Events" phase="Phase 12" />} />
                <Route path="/analytics" element={<Placeholder title="Analytics" phase="Phase 13" />} />
                <Route path="/search" element={<Placeholder title="Search" phase="Phase 14" />} />
              </>
            )}
            {SHOW_DEBUG && <Route path="/debug" element={<DebugPage />} />}
            <Route path="*" element={<Navigate to="/day" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
