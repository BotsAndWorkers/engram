-- Rolling summary for the active conversation
CREATE TABLE IF NOT EXISTS chat_summaries (
  chat_id INTEGER PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Long-term episodic archive of past conversation segments
CREATE TABLE IF NOT EXISTS conversation_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_user_created
  ON conversation_episodes (user_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
  topic,
  summary,
  content='conversation_episodes',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON conversation_episodes BEGIN
  INSERT INTO episodes_fts(rowid, topic, summary)
  VALUES (new.id, new.topic, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON conversation_episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, topic, summary)
  VALUES ('delete', old.id, old.topic, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON conversation_episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, topic, summary)
  VALUES ('delete', old.id, old.topic, old.summary);
  INSERT INTO episodes_fts(rowid, topic, summary)
  VALUES (new.id, new.topic, new.summary);
END;
