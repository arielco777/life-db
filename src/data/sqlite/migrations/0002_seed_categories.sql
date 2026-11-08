-- Default categories (CAT-1) with fixed IDs shared by every install (FC-5).
-- IDs must match DEFAULT_CATEGORY_IDS in src/domain/ids.ts.
-- Settings are not seeded: SettingsRepository falls back to DEFAULT_SETTINGS for missing keys.
INSERT INTO categories (id, name, color, sort_order, is_default, created_at, updated_at) VALUES
  ('0190a6e0-0000-7000-8000-000000000001', 'Health',        '#5f9e6e', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000002', 'Work',          '#4f7cac', 2, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000003', 'Money',         '#c49a3a', 3, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000004', 'Learning',      '#8a6bb5', 4, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000005', 'Relationships', '#c46a7a', 5, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000006', 'Home',          '#9a7b5f', 6, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000007', 'Personal',      '#5f8f9e', 7, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('0190a6e0-0000-7000-8000-000000000008', 'Leisure',       '#d17f4a', 8, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
