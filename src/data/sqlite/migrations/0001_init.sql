-- Life DB schema v1 (design §4.3). Contains every V1.0 and V1.1 table so V1.1 needs no data migration.
-- Conventions: TEXT UUID PKs; *_at = ISO-8601 UTC; dates = local 'YYYY-MM-DD'; soft delete via deleted_at.

-- ───────── meta ─────────
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,            -- JSON-encoded
  updated_at  TEXT NOT NULL
);

-- ───────── categories & tags ─────────
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_categories_name ON categories(name COLLATE NOCASE)
  WHERE deleted_at IS NULL;

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,            -- normalized: trimmed, lowercase (TAG-3)
  color       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_tags_name ON tags(name) WHERE deleted_at IS NULL;

CREATE TABLE entity_tags (
  id          TEXT PRIMARY KEY,         -- naturalId('entity_tag', tag_id, entity_type, entity_id)
  tag_id      TEXT NOT NULL REFERENCES tags(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('habit','goal','journal_entry','life_event')),
  entity_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_entity_tags ON entity_tags(tag_id, entity_type, entity_id);
CREATE INDEX ix_entity_tags_entity ON entity_tags(entity_type, entity_id);

-- ───────── habits ─────────
CREATE TABLE habits (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  type             TEXT NOT NULL CHECK (type IN ('boolean','number','duration','rating')),
  unit             TEXT,
  rating_min       INTEGER,
  rating_max       INTEGER,
  target_value     REAL,
  target_op        TEXT CHECK (target_op IN ('at_least','at_most')),
  target_period    TEXT CHECK (target_period IN ('day','week','month')),
  frequency_type   TEXT NOT NULL DEFAULT 'daily'
                   CHECK (frequency_type IN ('daily','weekdays','times_per_week')),
  frequency_days   INTEGER,                    -- bitmask: bit0=Mon … bit6=Sun
  frequency_count  INTEGER,
  category_id      TEXT REFERENCES categories(id),
  priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  start_date       TEXT NOT NULL,
  end_date         TEXT,
  archived_at      TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK ((target_value IS NULL) = (target_op IS NULL) AND (target_value IS NULL) = (target_period IS NULL)),
  CHECK (type <> 'rating' OR (rating_min IS NOT NULL AND rating_max IS NOT NULL AND rating_max > rating_min))
);
CREATE INDEX ix_habits_active ON habits(deleted_at, archived_at, sort_order);

CREATE TABLE habit_entries (
  id          TEXT PRIMARY KEY,               -- naturalId('habit_entry', habit_id, date)
  habit_id    TEXT NOT NULL REFERENCES habits(id),
  date        TEXT NOT NULL,
  value       REAL NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_habit_entries_day ON habit_entries(habit_id, date);
CREATE INDEX ix_habit_entries_date ON habit_entries(date, habit_id);

-- ───────── goals (V1.1 UI) ─────────
CREATE TABLE goals (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  category_id      TEXT REFERENCES categories(id),
  priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('not_started','active','paused','completed','abandoned')),
  progress_mode    TEXT NOT NULL DEFAULT 'milestones'
                   CHECK (progress_mode IN ('milestones','manual','numeric')),
  progress_manual  REAL,
  progress_current REAL,
  progress_target  REAL,
  progress_unit    TEXT,
  start_date       TEXT,
  target_date      TEXT,
  completed_at     TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX ix_goals_status ON goals(deleted_at, status);

CREATE TABLE goal_milestones (
  id            TEXT PRIMARY KEY,
  goal_id       TEXT NOT NULL REFERENCES goals(id),
  title         TEXT NOT NULL,
  target_date   TEXT,
  completed_at  TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX ix_goal_milestones_goal ON goal_milestones(goal_id, sort_order);

CREATE TABLE goal_habits (
  id          TEXT PRIMARY KEY,               -- naturalId('goal_habit', goal_id, habit_id)
  goal_id     TEXT NOT NULL REFERENCES goals(id),
  habit_id    TEXT NOT NULL REFERENCES habits(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_goal_habits ON goal_habits(goal_id, habit_id);
CREATE INDEX ix_goal_habits_habit ON goal_habits(habit_id);

CREATE TABLE goal_months (
  id          TEXT PRIMARY KEY,               -- naturalId('goal_month', goal_id, month)
  goal_id     TEXT NOT NULL REFERENCES goals(id),
  month       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_goal_months ON goal_months(goal_id, month);
CREATE INDEX ix_goal_months_month ON goal_months(month);

-- ───────── journal & events ─────────
CREATE TABLE journal_entries (
  id          TEXT PRIMARY KEY,
  entry_date  TEXT NOT NULL,
  title       TEXT,
  body        TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX ix_journal_date ON journal_entries(entry_date, created_at);

CREATE TABLE life_events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  category_id TEXT REFERENCES categories(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX ix_life_events_range ON life_events(start_date, end_date);

-- ───────── search (SRCH) ─────────
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  date        UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix   = '2 3'
);

-- Each source table: insert → index if live; update → drop + re-index if live; delete → drop.

CREATE TRIGGER trg_journal_ai AFTER INSERT ON journal_entries WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  VALUES ('journal_entry', NEW.id, NEW.entry_date, COALESCE(NEW.title, ''), NEW.body);
END;
CREATE TRIGGER trg_journal_au AFTER UPDATE ON journal_entries BEGIN
  DELETE FROM search_index WHERE entity_type = 'journal_entry' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  SELECT 'journal_entry', NEW.id, NEW.entry_date, COALESCE(NEW.title, ''), NEW.body WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER trg_journal_ad AFTER DELETE ON journal_entries BEGIN
  DELETE FROM search_index WHERE entity_type = 'journal_entry' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_habits_ai AFTER INSERT ON habits WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  VALUES ('habit', NEW.id, NULL, NEW.name, COALESCE(NEW.description, ''));
END;
CREATE TRIGGER trg_habits_au AFTER UPDATE ON habits BEGIN
  DELETE FROM search_index WHERE entity_type = 'habit' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  SELECT 'habit', NEW.id, NULL, NEW.name, COALESCE(NEW.description, '') WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER trg_habits_ad AFTER DELETE ON habits BEGIN
  DELETE FROM search_index WHERE entity_type = 'habit' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_goals_ai AFTER INSERT ON goals WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  VALUES ('goal', NEW.id, NEW.start_date, NEW.title, COALESCE(NEW.description, ''));
END;
CREATE TRIGGER trg_goals_au AFTER UPDATE ON goals BEGIN
  DELETE FROM search_index WHERE entity_type = 'goal' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  SELECT 'goal', NEW.id, NEW.start_date, NEW.title, COALESCE(NEW.description, '') WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER trg_goals_ad AFTER DELETE ON goals BEGIN
  DELETE FROM search_index WHERE entity_type = 'goal' AND entity_id = OLD.id;
END;

-- Milestones are indexed as 'goal_milestone' rows whose entity_id is the milestone; the search
-- repository resolves them to their goal. (Keyed by milestone id so each can be removed alone.)
CREATE TRIGGER trg_milestones_ai AFTER INSERT ON goal_milestones WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  VALUES ('goal_milestone', NEW.id, NEW.target_date, NEW.title, '');
END;
CREATE TRIGGER trg_milestones_au AFTER UPDATE ON goal_milestones BEGIN
  DELETE FROM search_index WHERE entity_type = 'goal_milestone' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  SELECT 'goal_milestone', NEW.id, NEW.target_date, NEW.title, '' WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER trg_milestones_ad AFTER DELETE ON goal_milestones BEGIN
  DELETE FROM search_index WHERE entity_type = 'goal_milestone' AND entity_id = OLD.id;
END;

CREATE TRIGGER trg_events_ai AFTER INSERT ON life_events WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  VALUES ('life_event', NEW.id, NEW.start_date, NEW.name, COALESCE(NEW.description, ''));
END;
CREATE TRIGGER trg_events_au AFTER UPDATE ON life_events BEGIN
  DELETE FROM search_index WHERE entity_type = 'life_event' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, date, title, body)
  SELECT 'life_event', NEW.id, NEW.start_date, NEW.name, COALESCE(NEW.description, '') WHERE NEW.deleted_at IS NULL;
END;
CREATE TRIGGER trg_events_ad AFTER DELETE ON life_events BEGIN
  DELETE FROM search_index WHERE entity_type = 'life_event' AND entity_id = OLD.id;
END;
