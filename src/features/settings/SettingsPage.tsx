import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { DataPage } from './DataPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { TagsPage } from '@/features/tags/TagsPage';
import { TagView } from '@/features/tags/TagView';

const TABS = [
  { to: 'general', label: 'General' },
  { to: 'categories', label: 'Categories' },
  { to: 'tags', label: 'Tags' },
  { to: 'data', label: 'Data' },
];

/** /settings/* — sub-pages share one header and tab bar. */
export function SettingsPage() {
  return (
    <section>
      <h1 className="page-title">Settings</h1>
      <nav className="tabs" aria-label="Settings">
        {TABS.map((t) => (
          <NavLink key={t.to} to={`/settings/${t.to}`} className="tab">
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to="/settings/general" replace />} />
        <Route path="general" element={<p className="muted">Preferences arrive in Phase 9.</p>} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="tags/:id" element={<TagView />} />
        <Route path="data" element={<DataPage />} />
        <Route path="*" element={<Navigate to="/settings/general" replace />} />
      </Routes>
    </section>
  );
}
