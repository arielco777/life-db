/**
 * V1.1 screens (goals, events, analytics, search) stay hidden in releases until the V1.1
 * release (tasks Phase 15). `.env.development` turns them on for the dev server only.
 */
export const FEATURE_V1_1 = import.meta.env.VITE_FEATURE_V1_1 === 'true';

/** Dev-only debug page (Phase 1 "done when" check). */
export const SHOW_DEBUG = import.meta.env.DEV;
