-- Interactive checklists / lists (shopping, movies, todos, etc.)
CREATE TABLE IF NOT EXISTS list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  list_name TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_list_items_user_list
  ON list_items (user_id, list_name, done, id);

-- Daily briefing preferences in user_settings
ALTER TABLE user_settings ADD COLUMN briefing_hour INTEGER;
ALTER TABLE user_settings ADD COLUMN last_briefing_date TEXT;
ALTER TABLE user_settings ADD COLUMN chat_id INTEGER;
