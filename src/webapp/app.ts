export function renderMiniAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Engram</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      --bg: var(--tg-theme-bg-color, #0b0d12);
      --surface: var(--tg-theme-secondary-bg-color, #151922);
      --surface-elevated: #1c222e;
      --border: rgba(255, 255, 255, 0.08);
      --text: var(--tg-theme-text-color, #eef1f6);
      --muted: var(--tg-theme-hint-color, #8a94a6);
      --accent: var(--tg-theme-button-color, #3b82f6);
      --accent-soft: rgba(59, 130, 246, 0.14);
      --accent-text: var(--tg-theme-button-text-color, #ffffff);
      --danger: #ef4444;
      --danger-soft: rgba(239, 68, 68, 0.14);
      --success: #10b981;
      --warn: #f59e0b;
      --radius: 14px;
      --radius-sm: 10px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Inter, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
      padding: 14px 14px 92px;
      -webkit-font-smoothing: antialiased;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-mark {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), #6366f1);
      display: grid;
      place-items: center;
      color: #fff;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.28);
    }

    .brand-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .brand-sub {
      font-size: 11px;
      color: var(--muted);
    }

    .icon-btn {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      display: grid;
      place-items: center;
      cursor: pointer;
    }

    .icon-btn:active { transform: scale(0.95); }

    .search-wrap {
      position: relative;
      margin-bottom: 12px;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      font-size: 14px;
      padding: 10px 12px 10px 36px;
      outline: none;
    }

    .search-input:focus { border-color: var(--accent); }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }

    .stat-tile {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 8px;
      text-align: center;
      cursor: pointer;
    }

    .stat-tile.active {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .stat-num {
      font-size: 18px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1.15;
    }

    .stat-label {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 6px 2px 10px;
    }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 13px 14px;
      margin-bottom: 10px;
      transition: border-color 0.15s ease;
    }

    .card-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .card-meta {
      font-size: 12px;
      color: var(--muted);
      margin-top: 2px;
    }

    .card-body {
      font-size: 13.5px;
      color: var(--text);
      opacity: 0.92;
      margin-top: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .card-body.clamped {
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 9px;
    }

    .chip {
      font-size: 11px;
      color: var(--accent);
      background: var(--accent-soft);
      border-radius: 999px;
      padding: 2px 9px;
      font-weight: 500;
    }

    .badge-warn {
      color: var(--warn);
      background: rgba(245, 158, 11, 0.14);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
    }

    .btn-mini {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      border-radius: 8px;
      padding: 5px 9px;
      font-size: 12px;
      cursor: pointer;
    }

    .btn-mini.danger:hover, .btn-mini.danger:active {
      color: var(--danger);
      border-color: var(--danger);
      background: var(--danger-soft);
    }

    .btn-mini.accent {
      color: var(--accent);
      border-color: rgba(59, 130, 246, 0.35);
      background: var(--accent-soft);
    }

    .list-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 11px 13px;
      margin-bottom: 8px;
      cursor: pointer;
    }

    .check-box {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 2px solid var(--muted);
      display: grid;
      place-items: center;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }

    .list-item.done .check-box {
      background: var(--success);
      border-color: var(--success);
      color: #fff;
    }

    .list-item.done .list-text {
      text-decoration: line-through;
      color: var(--muted);
    }

    .list-text {
      font-size: 14px;
      flex: 1;
      word-break: break-word;
    }

    .tracker-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }

    .tracker-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 13px;
    }

    .tracker-cat {
      font-size: 12px;
      color: var(--muted);
      text-transform: capitalize;
    }

    .tracker-val {
      font-size: 22px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      margin: 4px 0 2px;
    }

    .bottom-nav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 18, 25, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-top: 1px solid var(--border);
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      padding: 6px 6px calc(8px + env(safe-area-inset-bottom, 0px));
      z-index: 20;
    }

    .nav-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      font-size: 10.5px;
      font-weight: 500;
      padding: 4px 2px;
      cursor: pointer;
    }

    .nav-btn.active { color: var(--accent); }

    .fab {
      position: fixed;
      right: 16px;
      bottom: 72px;
      width: 50px;
      height: 50px;
      border-radius: 16px;
      border: none;
      background: var(--accent);
      color: var(--accent-text);
      box-shadow: 0 8px 24px rgba(59, 130, 246, 0.35);
      display: grid;
      place-items: center;
      cursor: pointer;
      z-index: 25;
    }

    .fab:active { transform: scale(0.94); }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.58);
      display: none;
      align-items: flex-end;
      z-index: 40;
    }

    .modal-backdrop.open { display: flex; }

    .sheet {
      width: 100%;
      background: var(--surface);
      border-top-left-radius: 20px;
      border-top-right-radius: 20px;
      border-top: 1px solid var(--border);
      padding: 16px 16px calc(22px + env(safe-area-inset-bottom, 0px));
      animation: slideUp 0.18s ease-out;
    }

    @keyframes slideUp {
      from { transform: translateY(24px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .sheet-title { font-size: 16px; font-weight: 700; }

    .field {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 14px;
      padding: 10px 12px;
      margin-bottom: 10px;
      outline: none;
      font-family: inherit;
    }

    .field:focus { border-color: var(--accent); }

    textarea.field { min-height: 92px; resize: vertical; }

    .btn-primary {
      width: 100%;
      background: var(--accent);
      color: var(--accent-text);
      border: none;
      border-radius: 11px;
      padding: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-primary:disabled { opacity: 0.55; }

    .empty {
      text-align: center;
      padding: 34px 16px;
      color: var(--muted);
      font-size: 13.5px;
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }

    .error-banner {
      background: var(--danger-soft);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 13px;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="brand">
      <div class="brand-mark">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v2a3 3 0 0 1-2 2.83V17a4 4 0 0 1-8 0v-2.17A3 3 0 0 1 7 12v-2a3 3 0 0 1 3-3V6a4 4 0 0 1 2-4Z"/></svg>
      </div>
      <div>
        <div class="brand-title">Engram</div>
        <div class="brand-sub" id="syncStatus">Персональная база знаний</div>
      </div>
    </div>
    <button class="icon-btn" id="refreshBtn" title="Обновить">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
    </button>
  </div>

  <div class="search-wrap">
    <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
    <input class="search-input" id="searchInput" type="search" placeholder="Поиск по заметкам, спискам, памяти..." />
  </div>

  <div class="stats-grid" id="statsGrid"></div>
  <div id="errorBanner" class="error-banner" style="display:none"></div>
  <main id="content"><div class="empty">Загрузка данных...</div></main>

  <button class="fab" id="fabBtn" title="Создать">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
  </button>

  <nav class="bottom-nav" id="bottomNav">
    <button class="nav-btn active" data-tab="notes">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
      <span>Заметки</span>
    </button>
    <button class="nav-btn" data-tab="lists">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <span>Списки</span>
    </button>
    <button class="nav-btn" data-tab="reminders">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <span>Задачи</span>
    </button>
    <button class="nav-btn" data-tab="trackers">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
      <span>Трекер</span>
    </button>
    <button class="nav-btn" data-tab="memory">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>
      <span>Память</span>
    </button>
  </nav>

  <div class="modal-backdrop" id="modalBackdrop">
    <div class="sheet" id="modalSheet"></div>
  </div>

  <script>
    (function () {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
      }

      const initData = (tg && tg.initData) || '';
      const basePath = window.location.pathname.replace(/\\/+$/, '');
      const contentEl = document.getElementById('content');
      const statsGridEl = document.getElementById('statsGrid');
      const errorBanner = document.getElementById('errorBanner');
      const searchInput = document.getElementById('searchInput');
      const bottomNav = document.getElementById('bottomNav');
      const fabBtn = document.getElementById('fabBtn');
      const modalBackdrop = document.getElementById('modalBackdrop');
      const modalSheet = document.getElementById('modalSheet');
      const syncStatus = document.getElementById('syncStatus');

      let activeTab = 'notes';
      let query = '';
      let activeListFilter = '';
      const expandedNotes = new Set();

      let state = {
        notes: [],
        reminders: [],
        lists: [],
        memories: [],
        trackerSummary: [],
        documents: [],
      };

      function haptic(type) {
        try {
          if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred(type || 'light');
          }
        } catch {}
      }

      function esc(v) {
        return String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function fmtDate(ms) {
        try {
          return new Date(ms).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return '';
        }
      }

      function showError(msg) {
        if (!msg) {
          errorBanner.style.display = 'none';
          return;
        }
        errorBanner.textContent = msg;
        errorBanner.style.display = 'block';
      }

      async function api(path, options) {
        const res = await fetch(basePath + path, {
          method: (options && options.method) || 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': initData,
          },
          body: options && options.body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function renderStats() {
        const openLists = state.lists.filter((i) => !i.done).length;
        const tiles = [
          { tab: 'notes', num: state.notes.length, label: 'Заметки' },
          { tab: 'lists', num: openLists, label: 'Списки' },
          { tab: 'reminders', num: state.reminders.length, label: 'Задачи' },
          { tab: 'memory', num: state.memories.length + state.documents.length, label: 'Память' },
        ];
        statsGridEl.innerHTML = tiles.map((t) => (
          '<div class="stat-tile ' + (activeTab === t.tab ? 'active' : '') + '" data-jump="' + t.tab + '">' +
            '<div class="stat-num">' + t.num + '</div>' +
            '<div class="stat-label">' + t.label + '</div>' +
          '</div>'
        )).join('');
      }

      function matchesQuery(text) {
        if (!query) return true;
        return String(text || '').toLowerCase().includes(query);
      }

      function renderNotes() {
        const items = state.notes.filter((n) =>
          matchesQuery(n.title + ' ' + n.content + ' ' + n.tags)
        );
        if (!items.length) return '<div class="empty">Заметок не найдено. Нажмите + чтобы создать.</div>';

        return items.map((n) => {
          const isOpen = expandedNotes.has(n.id);
          const tags = (n.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
          return (
            '<div class="card">' +
              '<div class="card-row">' +
                '<div>' +
                  '<div class="card-title">' + esc(n.title) + '</div>' +
                  '<div class="card-meta">#' + n.id + ' · ' + esc(fmtDate(n.updated_at)) + '</div>' +
                '</div>' +
                '<div class="card-actions">' +
                  '<button class="btn-mini" data-expand-note="' + n.id + '">' + (isOpen ? 'Свернуть' : 'Открыть') + '</button>' +
                  '<button class="btn-mini danger" data-delete-note="' + n.id + '">Удалить</button>' +
                '</div>' +
              '</div>' +
              '<div class="card-body ' + (isOpen ? '' : 'clamped') + '">' + esc(n.content) + '</div>' +
              (tags.length ? '<div class="chip-row">' + tags.map((t) => '<span class="chip">#' + esc(t) + '</span>').join('') + '</div>' : '') +
            '</div>'
          );
        }).join('');
      }

      function renderLists() {
        const filtered = state.lists.filter((i) => matchesQuery(i.list_name + ' ' + i.text));
        if (!filtered.length) return '<div class="empty">Списки пусты. Нажмите + чтобы добавить пункт.</div>';

        const names = Array.from(new Set(filtered.map((i) => i.list_name)));
        if (activeListFilter && !names.includes(activeListFilter)) activeListFilter = '';

        const pills = '<div class="chip-row" style="margin:0 0 12px">' +
          '<button class="btn-mini ' + (!activeListFilter ? 'accent' : '') + '" data-list-filter="">Все</button>' +
          names.map((name) =>
            '<button class="btn-mini ' + (activeListFilter === name ? 'accent' : '') + '" data-list-filter="' + esc(name) + '">' + esc(name) + '</button>'
          ).join('') +
        '</div>';

        const visible = activeListFilter ? filtered.filter((i) => i.list_name === activeListFilter) : filtered;
        const rows = visible.map((item) => (
          '<div class="list-item ' + (item.done ? 'done' : '') + '" data-toggle-list="' + item.id + '">' +
            '<div class="check-box">' + (item.done ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : '') + '</div>' +
            '<div class="list-text">' + esc(item.text) + '</div>' +
            '<span class="chip">' + esc(item.list_name) + '</span>' +
          '</div>'
        )).join('');

        return pills + rows;
      }

      function renderReminders() {
        const items = state.reminders.filter((r) => matchesQuery(r.text));
        if (!items.length) return '<div class="empty">Активных напоминаний нет.</div>';

        const now = Date.now();
        return items.map((r) => {
          const overdue = r.due_at < now;
          return (
            '<div class="card">' +
              '<div class="card-row">' +
                '<div>' +
                  '<div class="card-title">' + esc(r.text) + '</div>' +
                  '<div class="card-meta">' + esc(fmtDate(r.due_at)) + (r.repeat_interval_minutes ? ' · повтор каждые ' + r.repeat_interval_minutes + ' мин' : '') + '</div>' +
                  (overdue ? '<div style="margin-top:6px"><span class="badge-warn">Просрочено</span></div>' : '') +
                '</div>' +
                '<button class="btn-mini accent" data-done-reminder="' + r.id + '">Готово</button>' +
              '</div>' +
            '</div>'
          );
        }).join('');
      }

      function renderTrackers() {
        if (!state.trackerSummary.length) {
          return '<div class="empty">Записей трекера за 30 дней пока нет. Нажмите + чтобы добавить расход или привычку.</div>';
        }
        return '<div class="section-head"><span class="section-title">Сводка за 30 дней</span></div>' +
          '<div class="tracker-grid">' +
          state.trackerSummary.map((t) => (
            '<div class="tracker-card">' +
              '<div class="tracker-cat">' + esc(t.category) + '</div>' +
              '<div class="tracker-val">' + esc(t.total) + (t.unit ? ' ' + esc(t.unit) : '') + '</div>' +
              '<div class="card-meta">Записей: ' + t.count + '</div>' +
            '</div>'
          )).join('') +
          '</div>';
      }

      function renderMemory() {
        const mems = state.memories.filter((m) => matchesQuery(m.key + ' ' + m.value));
        const docs = state.documents.filter((d) => matchesQuery(d.file_name + ' ' + d.content));

        let html = '<div class="section-head"><span class="section-title">Факты памяти (' + mems.length + ')</span></div>';
        if (!mems.length) {
          html += '<div class="empty" style="margin-bottom:14px">Фактов не найдено.</div>';
        } else {
          html += mems.map((m) => (
            '<div class="card">' +
              '<div class="card-row">' +
                '<div>' +
                  '<div class="card-title">' + esc(m.key) + '</div>' +
                  '<div class="card-body" style="margin-top:4px">' + esc(m.value) + '</div>' +
                '</div>' +
                '<button class="btn-mini danger" data-delete-memory="' + m.id + '">Удалить</button>' +
              '</div>' +
            '</div>'
          )).join('');
        }

        html += '<div class="section-head" style="margin-top:14px"><span class="section-title">Документы (' + docs.length + ')</span></div>';
        if (!docs.length) {
          html += '<div class="empty">Загруженных документов нет.</div>';
        } else {
          html += docs.map((d) => (
            '<div class="card">' +
              '<div class="card-title">' + esc(d.file_name) + '</div>' +
              '<div class="card-meta">' + esc(d.mime_type) + ' · ' + esc(fmtDate(d.created_at)) + '</div>' +
            '</div>'
          )).join('');
        }
        return html;
      }

      function setTab(tab) {
        activeTab = tab;
        for (const el of bottomNav.querySelectorAll('.nav-btn')) {
          el.classList.toggle('active', el.getAttribute('data-tab') === tab);
        }
        fabBtn.style.display = tab === 'memory' ? 'none' : 'grid';
        render();
      }

      function render() {
        renderStats();
        if (activeTab === 'notes') contentEl.innerHTML = renderNotes();
        else if (activeTab === 'lists') contentEl.innerHTML = renderLists();
        else if (activeTab === 'reminders') contentEl.innerHTML = renderReminders();
        else if (activeTab === 'trackers') contentEl.innerHTML = renderTrackers();
        else if (activeTab === 'memory') contentEl.innerHTML = renderMemory();
      }

      function openCreateSheet() {
        haptic('light');
        let title = 'Новая заметка';
        let bodyHtml = '';

        if (activeTab === 'lists') {
          title = 'Добавить в список';
          bodyHtml =
            '<input class="field" id="mListName" placeholder="Название списка (например: покупки)" value="' + esc(activeListFilter || 'покупки') + '" />' +
            '<input class="field" id="mListText" placeholder="Что добавить?" required />' +
            '<button class="btn-primary" id="mSubmit">Добавить</button>';
        } else if (activeTab === 'reminders') {
          title = 'Новое напоминание';
          bodyHtml =
            '<input class="field" id="mRemText" placeholder="О чем напомнить?" required />' +
            '<select class="field" id="mRemMins">' +
              '<option value="15">Через 15 минут</option>' +
              '<option value="60" selected>Через 1 час</option>' +
              '<option value="180">Через 3 часа</option>' +
              '<option value="1440">Завтра в это же время</option>' +
            '</select>' +
            '<button class="btn-primary" id="mSubmit">Создать напоминание</button>';
        } else if (activeTab === 'trackers') {
          title = 'Запись в трекер';
          bodyHtml =
            '<input class="field" id="mTrCat" placeholder="Категория (расходы, спорт, привычки)" value="расходы" />' +
            '<input class="field" id="mTrLabel" placeholder="Название (например: кофе)" required />' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
              '<input class="field" id="mTrAmount" type="number" step="any" placeholder="Значение" />' +
              '<input class="field" id="mTrUnit" placeholder="Ед. (₽, км, мин)" value="₽" />' +
            '</div>' +
            '<button class="btn-primary" id="mSubmit">Сохранить запись</button>';
        } else {
          bodyHtml =
            '<input class="field" id="mNoteTitle" placeholder="Заголовок" />' +
            '<textarea class="field" id="mNoteContent" placeholder="Текст заметки..." required></textarea>' +
            '<input class="field" id="mNoteTags" placeholder="Теги через запятую" />' +
            '<button class="btn-primary" id="mSubmit">Сохранить заметку</button>';
        }

        modalSheet.innerHTML =
          '<div class="sheet-head">' +
            '<div class="sheet-title">' + title + '</div>' +
            '<button class="btn-mini" id="mClose">Закрыть</button>' +
          '</div>' +
          bodyHtml;

        modalBackdrop.classList.add('open');
        document.getElementById('mClose').onclick = closeSheet;
        document.getElementById('mSubmit').onclick = submitSheet;
      }

      function closeSheet() {
        modalBackdrop.classList.remove('open');
      }

      async function submitSheet() {
        const btn = document.getElementById('mSubmit');
        btn.disabled = true;
        try {
          if (activeTab === 'lists') {
            const listName = document.getElementById('mListName').value.trim();
            const text = document.getElementById('mListText').value.trim();
            if (!text) return;
            const res = await api('/api/lists', { method: 'POST', body: JSON.stringify({ listName, text }) });
            if (res.item) state.lists.unshift(res.item);
          } else if (activeTab === 'reminders') {
            const text = document.getElementById('mRemText').value.trim();
            const inMinutes = Number(document.getElementById('mRemMins').value);
            if (!text) return;
            const res = await api('/api/reminders', { method: 'POST', body: JSON.stringify({ text, inMinutes }) });
            if (res.reminder) state.reminders.push(res.reminder);
          } else if (activeTab === 'trackers') {
            const category = document.getElementById('mTrCat').value.trim();
            const label = document.getElementById('mTrLabel').value.trim();
            const amount = document.getElementById('mTrAmount').value;
            const unit = document.getElementById('mTrUnit').value.trim();
            if (!label) return;
            await api('/api/trackers', { method: 'POST', body: JSON.stringify({ category, label, amount, unit }) });
            await loadData();
          } else {
            const title = document.getElementById('mNoteTitle').value.trim();
            const content = document.getElementById('mNoteContent').value.trim();
            const tags = document.getElementById('mNoteTags').value.trim();
            if (!content && !title) return;
            const res = await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content, tags }) });
            if (res.note) state.notes.unshift(res.note);
          }
          haptic('medium');
          closeSheet();
          render();
        } catch (err) {
          showError(err.message || 'Ошибка сохранения');
          btn.disabled = false;
        }
      }

      async function loadData() {
        showError('');
        syncStatus.textContent = 'Синхронизация...';
        try {
          const data = await api('/api/data');
          state = {
            notes: data.notes || [],
            reminders: data.reminders || [],
            lists: data.lists || [],
            memories: data.memories || [],
            trackerSummary: data.trackerSummary || [],
            documents: data.documents || [],
          };
          syncStatus.textContent = 'Синхронизировано';
          render();
        } catch (err) {
          syncStatus.textContent = 'Ошибка доступа';
          showError('Откройте Mini App внутри Telegram (' + (err.message || 'Unauthorized') + ')');
          contentEl.innerHTML = '';
        }
      }

      bottomNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-btn');
        if (!btn) return;
        haptic('light');
        setTab(btn.getAttribute('data-tab') || 'notes');
      });

      statsGridEl.addEventListener('click', (e) => {
        const tile = e.target.closest('[data-jump]');
        if (!tile) return;
        haptic('light');
        setTab(tile.getAttribute('data-jump'));
      });

      searchInput.addEventListener('input', (e) => {
        query = (e.target.value || '').trim().toLowerCase();
        render();
      });

      contentEl.addEventListener('click', async (e) => {
        const expandBtn = e.target.closest('[data-expand-note]');
        if (expandBtn) {
          const id = Number(expandBtn.getAttribute('data-expand-note'));
          if (expandedNotes.has(id)) expandedNotes.delete(id);
          else expandedNotes.add(id);
          render();
          return;
        }

        const delNoteBtn = e.target.closest('[data-delete-note]');
        if (delNoteBtn) {
          const id = delNoteBtn.getAttribute('data-delete-note');
          try {
            await api('/api/notes/' + id, { method: 'DELETE' });
            state.notes = state.notes.filter((n) => String(n.id) !== String(id));
            haptic('light');
            render();
          } catch (err) { showError(err.message); }
          return;
        }

        const filterBtn = e.target.closest('[data-list-filter]');
        if (filterBtn) {
          activeListFilter = filterBtn.getAttribute('data-list-filter') || '';
          render();
          return;
        }

        const listEl = e.target.closest('[data-toggle-list]');
        if (listEl) {
          const id = listEl.getAttribute('data-toggle-list');
          try {
            const res = await api('/api/lists/' + id + '/toggle', { method: 'POST' });
            if (res.item) {
              state.lists = state.lists.map((it) => String(it.id) === String(id) ? res.item : it);
              haptic('light');
              render();
            }
          } catch (err) { showError(err.message); }
          return;
        }

        const remBtn = e.target.closest('[data-done-reminder]');
        if (remBtn) {
          const id = remBtn.getAttribute('data-done-reminder');
          try {
            await api('/api/reminders/' + id + '/done', { method: 'POST' });
            state.reminders = state.reminders.filter((r) => String(r.id) !== String(id));
            haptic('medium');
            render();
          } catch (err) { showError(err.message); }
          return;
        }

        const delMemBtn = e.target.closest('[data-delete-memory]');
        if (delMemBtn) {
          const id = delMemBtn.getAttribute('data-delete-memory');
          try {
            await api('/api/memories/' + id, { method: 'DELETE' });
            state.memories = state.memories.filter((m) => String(m.id) !== String(id));
            haptic('light');
            render();
          } catch (err) { showError(err.message); }
        }
      });

      fabBtn.addEventListener('click', openCreateSheet);
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeSheet();
      });
      document.getElementById('refreshBtn').addEventListener('click', () => {
        haptic('light');
        loadData();
      });

      loadData();
    })();
  </script>
</body>
</html>`;
}
