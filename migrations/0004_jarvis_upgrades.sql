-- Uploaded documents & extracted text (PDF, TXT, MD, code, CSV)
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_user_created
  ON documents (user_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  file_name,
  content,
  content='documents',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, file_name, content)
  VALUES (new.id, new.file_name, new.content);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, file_name, content)
  VALUES ('delete', old.id, old.file_name, old.content);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, file_name, content)
  VALUES ('delete', old.id, old.file_name, old.content);
  INSERT INTO documents_fts(rowid, file_name, content)
  VALUES (new.id, new.file_name, new.content);
END;

-- Structured personal trackers (expenses, habits, workouts, time)
CREATE TABLE IF NOT EXISTS tracker_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL,
  unit TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracker_user_cat
  ON tracker_entries (user_id, category, created_at DESC);

-- Proactive check-ins, quiet hours, and voice reply mode
ALTER TABLE user_settings ADD COLUMN quiet_start INTEGER;
ALTER TABLE user_settings ADD COLUMN quiet_end INTEGER;
ALTER TABLE user_settings ADD COLUMN checkin_hour INTEGER;
ALTER TABLE user_settings ADD COLUMN last_checkin_date TEXT;
ALTER TABLE user_settings ADD COLUMN voice_mode TEXT DEFAULT 'off';
