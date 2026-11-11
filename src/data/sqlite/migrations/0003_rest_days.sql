-- Rest days (HAB-5): a weekday habit can mark its other days as days it shouldn't be done.
-- 0 = other days are optional (the default, and every habit before this migration); 1 = rest days.
ALTER TABLE habits ADD COLUMN frequency_rest INTEGER NOT NULL DEFAULT 0 CHECK (frequency_rest IN (0, 1));
