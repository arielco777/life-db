import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { FEATURE_V1_1 } from './features';
import { Placeholder } from '@/features/Placeholder';

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
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="nav-brand">Life DB</div>
        {visibleNav.map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-link">
            <span className="nav-icon" aria-hidden>
              {n.icon}
            </span>
            <span className="nav-label">{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/day" replace />} />
          <Route path="/day/:date?" element={<Placeholder title="Today" phase="Phase 5" />} />
          <Route path="/month/:ym?" element={<Placeholder title="Month" phase="Phase 6" />} />
          <Route path="/habits/*" element={<Placeholder title="Habits" phase="Phase 4" />} />
          <Route path="/journal/*" element={<Placeholder title="Journal" phase="Phase 7" />} />
          <Route path="/settings/*" element={<Placeholder title="Settings" phase="Phase 9" />} />
          {FEATURE_V1_1 && (
            <>
              <Route path="/goals/*" element={<Placeholder title="Goals" phase="Phase 11" />} />
              <Route path="/events" element={<Placeholder title="Events" phase="Phase 12" />} />
              <Route path="/analytics" element={<Placeholder title="Analytics" phase="Phase 13" />} />
              <Route path="/search" element={<Placeholder title="Search" phase="Phase 14" />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/day" replace />} />
        </Routes>
      </main>
    </div>
  );
}
