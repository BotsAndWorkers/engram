import type {
  ChatSummaryRow,
  ConversationEpisodeRow,
  DocumentRow,
  ListItemRow,
  MemoryRow,
  MessageRow,
  NoteRow,
  ReminderRow,
  TrackerEntryRow,
  UserSettingsRow,
} from './types';

/**
 * Marks a Telegram update_id as processed.
 * Returns true if this update has not been seen before.
 */
export async function tryMarkUpdateProcessed(
  db: D1Database,
  updateId: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)',
    )
    .bind(updateId, Date.now())
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function cleanupOldProcessedUpdates(
  db: D1Database,
  olderThanMs: number,
): Promise<void> {
  const cutoff = Date.now() - olderThanMs;
  await db
    .prepare('DELETE FROM processed_updates WHERE processed_at < ?')
    .bind(cutoff)
    .run();
}

/* ---------------- Messages ---------------- */

export async function getRecentMessages(
  db: D1Database,
  chatId: number,
  limit = 16,
): Promise<MessageRow[]> {
  const { results } = await db
    .prepare(
      'SELECT id, chat_id, role, content, tool_calls_json, tool_call_id, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
    )
    .bind(chatId, limit)
    .all<MessageRow>();

  return results.reverse();
}

export async function appendMessage(
  db: D1Database,
  params: {
    chatId: number;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCallsJson?: string | null;
    toolCallId?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO messages (chat_id, role, content, tool_calls_json, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      params.chatId,
      params.role,
      params.content,
      params.toolCallsJson ?? null,
      params.toolCallId ?? null,
      Date.now(),
    )
    .run();
}

export async function clearMessages(db: D1Database, chatId: number): Promise<void> {
  await Promise.all([
    db.prepare('DELETE FROM messages WHERE chat_id = ?').bind(chatId).run(),
    db.prepare('DELETE FROM chat_summaries WHERE chat_id = ?').bind(chatId).run(),
  ]);
}

export async function getMessagesForSummarization(
  db: D1Database,
  chatId: number,
  keepRecent = 14,
): Promise<MessageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, chat_id, role, content, tool_calls_json, tool_call_id, created_at
       FROM messages
       WHERE chat_id = ?
         AND id NOT IN (
           SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?
         )
       ORDER BY id ASC`,
    )
    .bind(chatId, chatId, keepRecent)
    .all<MessageRow>();
  return results;
}

export async function deleteMessagesUpToId(
  db: D1Database,
  chatId: number,
  maxId: number,
): Promise<void> {
  await db
    .prepare('DELETE FROM messages WHERE chat_id = ? AND id <= ?')
    .bind(chatId, maxId)
    .run();
}

export async function pruneOldMessages(
  db: D1Database,
  chatId: number,
  keepLast = 60,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM messages
       WHERE chat_id = ?
         AND id NOT IN (
           SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?
         )`,
    )
    .bind(chatId, chatId, keepLast)
    .run();
}

/* ---------------- Notes & FTS5 ---------------- */

/**
 * Escapes user query into safe FTS5 prefix tokens so special syntax characters
 * (quotes, colons, hyphens, boolean operators) cannot break MATCH.
 */
export function buildSafeFtsQuery(rawQuery: string): string {
  const tokens = rawQuery
    .trim()
    .split(/[\s,.;:!?/\\()[\]{}"'`~@#$%^&*+=<>|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export async function createNote(
  db: D1Database,
  userId: number,
  title: string,
  content: string,
  tags: string,
): Promise<NoteRow> {
  const now = Date.now();
  const result = await db
    .prepare(
      'INSERT INTO notes (user_id, title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(userId, title.trim(), content.trim(), normalizeTags(tags), now, now)
    .first<NoteRow>();

  if (!result) {
    throw new Error('Failed to insert note');
  }
  return result;
}

export async function getNoteById(
  db: D1Database,
  userId: number,
  noteId: number,
): Promise<NoteRow | null> {
  return db
    .prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .bind(noteId, userId)
    .first<NoteRow>();
}

export async function updateNote(
  db: D1Database,
  userId: number,
  noteId: number,
  patch: { title?: string; content?: string; tags?: string },
): Promise<NoteRow | null> {
  const existing = await getNoteById(db, userId, noteId);
  if (!existing) return null;

  const nextTitle = patch.title !== undefined ? patch.title.trim() : existing.title;
  const nextContent =
    patch.content !== undefined ? patch.content.trim() : existing.content;
  const nextTags =
    patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags;

  return db
    .prepare(
      'UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *',
    )
    .bind(nextTitle, nextContent, nextTags, Date.now(), noteId, userId)
    .first<NoteRow>();
}

export async function deleteNote(
  db: D1Database,
  userId: number,
  noteId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM notes WHERE id = ? AND user_id = ?')
    .bind(noteId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listRecentNotes(
  db: D1Database,
  userId: number,
  limit = 10,
  offset = 0,
): Promise<NoteRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    )
    .bind(userId, limit, offset)
    .all<NoteRow>();
  return results;
}

export async function listAllNotes(
  db: D1Database,
  userId: number,
): Promise<NoteRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<NoteRow>();
  return results;
}

export async function getNotesByIds(
  db: D1Database,
  userId: number,
  ids: number[],
): Promise<NoteRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM notes WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .bind(userId, ...ids)
    .all<NoteRow>();
  return results;
}

export async function searchNotes(
  db: D1Database,
  userId: number,
  query: string,
  tag?: string,
  limit = 10,
): Promise<NoteRow[]> {
  const ftsQuery = buildSafeFtsQuery(query);
  const cleanTag = tag?.trim().toLowerCase() ?? '';

  if (ftsQuery) {
    try {
      const sql = cleanTag
        ? `SELECT n.* FROM notes n
           JOIN notes_fts fts ON n.id = fts.rowid
           WHERE n.user_id = ? AND notes_fts MATCH ? AND LOWER(n.tags) LIKE ?
           ORDER BY bm25(notes_fts) LIMIT ?`
        : `SELECT n.* FROM notes n
           JOIN notes_fts fts ON n.id = fts.rowid
           WHERE n.user_id = ? AND notes_fts MATCH ?
           ORDER BY bm25(notes_fts) LIMIT ?`;

      const stmt = cleanTag
        ? db.prepare(sql).bind(userId, ftsQuery, `%${cleanTag}%`, limit)
        : db.prepare(sql).bind(userId, ftsQuery, limit);

      const { results } = await stmt.all<NoteRow>();
      if (results.length > 0) return results;
    } catch {
      // Fall back to LIKE search if FTS query fails
    }
  }

  const likePattern = `%${query.trim().toLowerCase()}%`;
  if (cleanTag) {
    const { results } = await db
      .prepare(
        `SELECT * FROM notes
         WHERE user_id = ?
           AND LOWER(tags) LIKE ?
           AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(userId, `%${cleanTag}%`, likePattern, likePattern, limit)
      .all<NoteRow>();
    return results;
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM notes
       WHERE user_id = ?
         AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(userId, likePattern, likePattern, likePattern, limit)
    .all<NoteRow>();
  return results;
}

function normalizeTags(raw: string): string {
  if (!raw) return '';
  const unique = new Set(
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean),
  );
  return Array.from(unique).join(', ');
}

/* ---------------- Reminders ---------------- */

export async function createReminder(
  db: D1Database,
  params: {
    userId: number;
    chatId: number;
    text: string;
    dueAt: number;
    repeatIntervalMinutes?: number | null;
  },
): Promise<ReminderRow> {
  const result = await db
    .prepare(
      `INSERT INTO reminders (user_id, chat_id, text, due_at, repeat_interval_minutes, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)
       RETURNING *`,
    )
    .bind(
      params.userId,
      params.chatId,
      params.text.trim(),
      params.dueAt,
      params.repeatIntervalMinutes ?? null,
      Date.now(),
    )
    .first<ReminderRow>();

  if (!result) {
    throw new Error('Failed to create reminder');
  }
  return result;
}

export async function listReminders(
  db: D1Database,
  userId: number,
  status: 'pending' | 'done' | 'all' = 'pending',
  limit = 20,
): Promise<ReminderRow[]> {
  if (status === 'all') {
    const { results } = await db
      .prepare(
        'SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at ASC LIMIT ?',
      )
      .bind(userId, limit)
      .all<ReminderRow>();
    return results;
  }

  const { results } = await db
    .prepare(
      'SELECT * FROM reminders WHERE user_id = ? AND status = ? ORDER BY due_at ASC LIMIT ?',
    )
    .bind(userId, status, limit)
    .all<ReminderRow>();
  return results;
}

export async function getDueReminders(
  db: D1Database,
  nowMs: number,
  limit = 25,
): Promise<ReminderRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC LIMIT ?",
    )
    .bind(nowMs, limit)
    .all<ReminderRow>();
  return results;
}

export async function completeReminder(
  db: D1Database,
  userId: number,
  reminderId: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE reminders SET status = 'done', sent_at = COALESCE(sent_at, ?) WHERE id = ? AND user_id = ?",
    )
    .bind(Date.now(), reminderId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function snoozeReminder(
  db: D1Database,
  userId: number,
  reminderId: number,
  minutes: number,
): Promise<ReminderRow | null> {
  const nextDue = Date.now() + minutes * 60_000;
  return db
    .prepare(
      "UPDATE reminders SET status = 'pending', due_at = ? WHERE id = ? AND user_id = ? RETURNING *",
    )
    .bind(nextDue, reminderId, userId)
    .first<ReminderRow>();
}

export async function markReminderDispatched(
  db: D1Database,
  reminder: ReminderRow,
  nowMs: number,
): Promise<void> {
  if (reminder.repeat_interval_minutes && reminder.repeat_interval_minutes > 0) {
    const stepMs = reminder.repeat_interval_minutes * 60_000;
    let nextDue = reminder.due_at + stepMs;
    while (nextDue <= nowMs) {
      nextDue += stepMs;
    }
    await db
      .prepare('UPDATE reminders SET due_at = ?, sent_at = ? WHERE id = ?')
      .bind(nextDue, nowMs, reminder.id)
      .run();
    return;
  }

  await db
    .prepare("UPDATE reminders SET status = 'done', sent_at = ? WHERE id = ?")
    .bind(nowMs, reminder.id)
    .run();
}

export async function deleteReminder(
  db: D1Database,
  userId: number,
  reminderId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?')
    .bind(reminderId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updateReminder(
  db: D1Database,
  userId: number,
  reminderId: number,
  patch: {
    text?: string;
    dueAt?: number;
    repeatIntervalMinutes?: number | null;
  },
): Promise<ReminderRow | null> {
  const existing = await db
    .prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?')
    .bind(reminderId, userId)
    .first<ReminderRow>();
  if (!existing) return null;

  const nextText = patch.text !== undefined ? patch.text.trim() : existing.text;
  const nextDue = patch.dueAt !== undefined ? patch.dueAt : existing.due_at;
  const nextRepeat =
    patch.repeatIntervalMinutes !== undefined
      ? patch.repeatIntervalMinutes
      : existing.repeat_interval_minutes;

  return db
    .prepare(
      "UPDATE reminders SET text = ?, due_at = ?, repeat_interval_minutes = ?, status = 'pending' WHERE id = ? AND user_id = ? RETURNING *",
    )
    .bind(nextText, nextDue, nextRepeat, reminderId, userId)
    .first<ReminderRow>();
}

/* ---------------- Long-term Memory ---------------- */

export async function upsertMemory(
  db: D1Database,
  userId: number,
  key: string,
  value: string,
): Promise<MemoryRow> {
  const cleanKey = key.trim().toLowerCase();
  const cleanValue = value.trim();
  const now = Date.now();

  const result = await db
    .prepare(
      `INSERT INTO memories (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .bind(userId, cleanKey, cleanValue, now)
    .first<MemoryRow>();

  if (!result) {
    throw new Error('Failed to save memory');
  }
  return result;
}

export async function deleteMemory(
  db: D1Database,
  userId: number,
  key: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM memories WHERE user_id = ? AND key = ?')
    .bind(userId, key.trim().toLowerCase())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteMemoryById(
  db: D1Database,
  userId: number,
  memoryId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM memories WHERE id = ? AND user_id = ?')
    .bind(memoryId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getUserStats(
  db: D1Database,
  userId: number,
): Promise<{
  notes: number;
  pendingReminders: number;
  memories: number;
  openListItems: number;
}> {
  const [notesRow, remRow, memRow, listRow] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) as cnt FROM notes WHERE user_id = ?')
      .bind(userId)
      .first<{ cnt: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) as cnt FROM reminders WHERE user_id = ? AND status = 'pending'",
      )
      .bind(userId)
      .first<{ cnt: number }>(),
    db
      .prepare('SELECT COUNT(*) as cnt FROM memories WHERE user_id = ?')
      .bind(userId)
      .first<{ cnt: number }>(),
    db
      .prepare(
        'SELECT COUNT(*) as cnt FROM list_items WHERE user_id = ? AND done = 0',
      )
      .bind(userId)
      .first<{ cnt: number }>(),
  ]);

  return {
    notes: notesRow?.cnt ?? 0,
    pendingReminders: remRow?.cnt ?? 0,
    memories: memRow?.cnt ?? 0,
    openListItems: listRow?.cnt ?? 0,
  };
}

export async function listMemories(
  db: D1Database,
  userId: number,
): Promise<MemoryRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC')
    .bind(userId)
    .all<MemoryRow>();
  return results;
}

/* ---------------- User Settings ---------------- */

export async function getUserSettings(
  db: D1Database,
  userId: number,
): Promise<UserSettingsRow | null> {
  return db
    .prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first<UserSettingsRow>();
}

export async function setUserTimezone(
  db: D1Database,
  userId: number,
  timezone: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, timezone, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, timezone, Date.now())
    .run();
}

export async function setUserModel(
  db: D1Database,
  userId: number,
  modelOverride: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, model_override, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         model_override = excluded.model_override,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, modelOverride, Date.now())
    .run();
}

/* ---------------- Chat Summaries & Episodic Archive ---------------- */

export async function getChatSummary(
  db: D1Database,
  chatId: number,
): Promise<ChatSummaryRow | null> {
  return db
    .prepare('SELECT * FROM chat_summaries WHERE chat_id = ?')
    .bind(chatId)
    .first<ChatSummaryRow>();
}

export async function upsertChatSummary(
  db: D1Database,
  chatId: number,
  summary: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chat_summaries (chat_id, summary, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (chat_id) DO UPDATE SET
         summary = excluded.summary,
         updated_at = excluded.updated_at`,
    )
    .bind(chatId, summary.trim(), Date.now())
    .run();
}

export async function createEpisode(
  db: D1Database,
  params: {
    chatId: number;
    userId: number;
    topic: string;
    summary: string;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO conversation_episodes (chat_id, user_id, topic, summary, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(
      params.chatId,
      params.userId,
      params.topic.trim(),
      params.summary.trim(),
      Date.now(),
    )
    .run();
}

export async function searchEpisodes(
  db: D1Database,
  userId: number,
  query: string,
  limit = 8,
): Promise<ConversationEpisodeRow[]> {
  const ftsQuery = buildSafeFtsQuery(query);
  if (ftsQuery) {
    try {
      const { results } = await db
        .prepare(
          `SELECT e.* FROM conversation_episodes e
           JOIN episodes_fts fts ON e.id = fts.rowid
           WHERE e.user_id = ? AND episodes_fts MATCH ?
           ORDER BY bm25(episodes_fts) LIMIT ?`,
        )
        .bind(userId, ftsQuery, limit)
        .all<ConversationEpisodeRow>();
      if (results.length > 0) return results;
    } catch {
      // Fall back to LIKE search
    }
  }

  const pattern = `%${query.trim().toLowerCase()}%`;
  const { results } = await db
    .prepare(
      `SELECT * FROM conversation_episodes
       WHERE user_id = ? AND (LOWER(topic) LIKE ? OR LOWER(summary) LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, pattern, pattern, limit)
    .all<ConversationEpisodeRow>();
  return results;
}

export async function listRecentEpisodes(
  db: D1Database,
  userId: number,
  limit = 8,
): Promise<ConversationEpisodeRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM conversation_episodes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(userId, limit)
    .all<ConversationEpisodeRow>();
  return results;
}

/* ---------------- Interactive Lists ---------------- */

export async function addListItems(
  db: D1Database,
  userId: number,
  listName: string,
  items: string[],
): Promise<ListItemRow[]> {
  const cleanList = listName.trim().toLowerCase() || 'общий';
  const now = Date.now();
  const inserted: ListItemRow[] = [];

  for (const raw of items) {
    const text = raw.trim();
    if (!text) continue;
    const row = await db
      .prepare(
        'INSERT INTO list_items (user_id, list_name, text, done, created_at) VALUES (?, ?, ?, 0, ?) RETURNING *',
      )
      .bind(userId, cleanList, text, now)
      .first<ListItemRow>();
    if (row) inserted.push(row);
  }
  return inserted;
}

export async function getListNames(
  db: D1Database,
  userId: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      'SELECT DISTINCT list_name FROM list_items WHERE user_id = ? ORDER BY list_name ASC',
    )
    .bind(userId)
    .all<{ list_name: string }>();
  return results.map((r) => r.list_name);
}

export async function getListItems(
  db: D1Database,
  userId: number,
  listName?: string,
): Promise<ListItemRow[]> {
  if (listName) {
    const { results } = await db
      .prepare(
        'SELECT * FROM list_items WHERE user_id = ? AND list_name = ? ORDER BY done ASC, id DESC LIMIT 40',
      )
      .bind(userId, listName.trim().toLowerCase())
      .all<ListItemRow>();
    return results;
  }

  const { results } = await db
    .prepare(
      'SELECT * FROM list_items WHERE user_id = ? ORDER BY list_name ASC, done ASC, id DESC LIMIT 50',
    )
    .bind(userId)
    .all<ListItemRow>();
  return results;
}

export async function toggleListItem(
  db: D1Database,
  userId: number,
  itemId: number,
  explicitDone?: boolean,
): Promise<ListItemRow | null> {
  const existing = await db
    .prepare('SELECT * FROM list_items WHERE id = ? AND user_id = ?')
    .bind(itemId, userId)
    .first<ListItemRow>();
  if (!existing) return null;

  const nextDone =
    explicitDone !== undefined ? (explicitDone ? 1 : 0) : existing.done ? 0 : 1;

  return db
    .prepare(
      'UPDATE list_items SET done = ? WHERE id = ? AND user_id = ? RETURNING *',
    )
    .bind(nextDone, itemId, userId)
    .first<ListItemRow>();
}

export async function deleteListItem(
  db: D1Database,
  userId: number,
  itemId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM list_items WHERE id = ? AND user_id = ?')
    .bind(itemId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function clearDoneListItems(
  db: D1Database,
  userId: number,
  listName: string,
): Promise<number> {
  const result = await db
    .prepare(
      'DELETE FROM list_items WHERE user_id = ? AND list_name = ? AND done = 1',
    )
    .bind(userId, listName.trim().toLowerCase())
    .run();
  return result.meta.changes ?? 0;
}

/* ---------------- Daily Briefing Settings ---------------- */

export async function touchUserChatId(
  db: D1Database,
  userId: number,
  chatId: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, chat_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         chat_id = COALESCE(user_settings.chat_id, excluded.chat_id)`,
    )
    .bind(userId, chatId, Date.now())
    .run();
}

export async function setUserBriefingHour(
  db: D1Database,
  userId: number,
  chatId: number,
  hour: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, chat_id, briefing_hour, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         briefing_hour = excluded.briefing_hour,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, chatId, hour, Date.now())
    .run();
}

export async function getUsersForBriefing(
  db: D1Database,
): Promise<UserSettingsRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM user_settings WHERE briefing_hour IS NOT NULL AND chat_id IS NOT NULL',
    )
    .all<UserSettingsRow>();
  return results;
}

export async function markBriefingSent(
  db: D1Database,
  userId: number,
  dateStr: string,
): Promise<void> {
  await db
    .prepare('UPDATE user_settings SET last_briefing_date = ? WHERE user_id = ?')
    .bind(dateStr, userId)
    .run();
}

export async function setUserQuietHours(
  db: D1Database,
  userId: number,
  quietStart: number | null,
  quietEnd: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, quiet_start, quiet_end, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         quiet_start = excluded.quiet_start,
         quiet_end = excluded.quiet_end,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, quietStart, quietEnd, Date.now())
    .run();
}

export async function setUserCheckinHour(
  db: D1Database,
  userId: number,
  chatId: number,
  hour: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, chat_id, checkin_hour, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         checkin_hour = excluded.checkin_hour,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, chatId, hour, Date.now())
    .run();
}

export async function getUsersForCheckin(
  db: D1Database,
): Promise<UserSettingsRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM user_settings WHERE checkin_hour IS NOT NULL AND chat_id IS NOT NULL',
    )
    .all<UserSettingsRow>();
  return results;
}

export async function markCheckinSent(
  db: D1Database,
  userId: number,
  dateStr: string,
): Promise<void> {
  await db
    .prepare('UPDATE user_settings SET last_checkin_date = ? WHERE user_id = ?')
    .bind(dateStr, userId)
    .run();
}

export async function setUserVoiceMode(
  db: D1Database,
  userId: number,
  voiceMode: 'off' | 'voice' | 'always',
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, voice_mode, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         voice_mode = excluded.voice_mode,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, voiceMode, Date.now())
    .run();
}

/* ---------------- Documents ---------------- */

export async function saveDocument(
  db: D1Database,
  params: {
    userId: number;
    fileName: string;
    mimeType: string;
    telegramFileId: string;
    content: string;
  },
): Promise<DocumentRow> {
  const result = await db
    .prepare(
      'INSERT INTO documents (user_id, file_name, mime_type, telegram_file_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(
      params.userId,
      params.fileName.trim(),
      params.mimeType,
      params.telegramFileId,
      params.content.trim(),
      Date.now(),
    )
    .first<DocumentRow>();

  if (!result) throw new Error('Failed to save document');
  return result;
}

export async function getDocumentById(
  db: D1Database,
  userId: number,
  docId: number,
): Promise<DocumentRow | null> {
  return db
    .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
    .bind(docId, userId)
    .first<DocumentRow>();
}

export async function listRecentDocuments(
  db: D1Database,
  userId: number,
  limit = 10,
): Promise<DocumentRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(userId, limit)
    .all<DocumentRow>();
  return results;
}

export async function searchDocuments(
  db: D1Database,
  userId: number,
  query: string,
  limit = 8,
): Promise<DocumentRow[]> {
  const ftsQuery = buildSafeFtsQuery(query);
  if (ftsQuery) {
    try {
      const { results } = await db
        .prepare(
          `SELECT d.* FROM documents d
           JOIN documents_fts fts ON d.id = fts.rowid
           WHERE d.user_id = ? AND documents_fts MATCH ?
           ORDER BY bm25(documents_fts) LIMIT ?`,
        )
        .bind(userId, ftsQuery, limit)
        .all<DocumentRow>();
      if (results.length > 0) return results;
    } catch {
      // fallback to LIKE
    }
  }

  const pattern = `%${query.trim().toLowerCase()}%`;
  const { results } = await db
    .prepare(
      `SELECT * FROM documents
       WHERE user_id = ? AND (LOWER(file_name) LIKE ? OR LOWER(content) LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, pattern, pattern, limit)
    .all<DocumentRow>();
  return results;
}

export async function deleteDocument(
  db: D1Database,
  userId: number,
  docId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM documents WHERE id = ? AND user_id = ?')
    .bind(docId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/* ---------------- Personal Trackers ---------------- */

export async function addTrackerEntry(
  db: D1Database,
  params: {
    userId: number;
    category: string;
    label: string;
    amount?: number | null;
    unit?: string | null;
    note?: string | null;
  },
): Promise<TrackerEntryRow> {
  const result = await db
    .prepare(
      'INSERT INTO tracker_entries (user_id, category, label, amount, unit, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(
      params.userId,
      params.category.trim().toLowerCase(),
      params.label.trim(),
      params.amount ?? null,
      params.unit?.trim() || null,
      params.note?.trim() || null,
      Date.now(),
    )
    .first<TrackerEntryRow>();

  if (!result) throw new Error('Failed to insert tracker entry');
  return result;
}

export async function getTrackerEntries(
  db: D1Database,
  userId: number,
  category?: string,
  days = 30,
  limit = 30,
): Promise<TrackerEntryRow[]> {
  const since = Date.now() - days * 86_400_000;
  if (category) {
    const { results } = await db
      .prepare(
        `SELECT * FROM tracker_entries
         WHERE user_id = ? AND category = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(userId, category.trim().toLowerCase(), since, limit)
      .all<TrackerEntryRow>();
    return results;
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM tracker_entries
       WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, since, limit)
    .all<TrackerEntryRow>();
  return results;
}

export async function getTrackerSummary(
  db: D1Database,
  userId: number,
  days = 30,
): Promise<
  Array<{ category: string; unit: string | null; count: number; total: number }>
> {
  const since = Date.now() - days * 86_400_000;
  const { results } = await db
    .prepare(
      `SELECT category, unit, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM tracker_entries
       WHERE user_id = ? AND created_at >= ?
       GROUP BY category, unit
       ORDER BY count DESC`,
    )
    .bind(userId, since)
    .all<{ category: string; unit: string | null; count: number; total: number }>();
  return results;
}

export async function deleteTrackerEntry(
  db: D1Database,
  userId: number,
  entryId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM tracker_entries WHERE id = ? AND user_id = ?')
    .bind(entryId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
