/**
 * Renders the self-contained Telegram Mini App HTML page.
 * Uses Telegram WebApp SDK and dark-mode styling with zero emojis.
 */
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
      --bg: var(--tg-theme-bg-color, #0f1115);
      --surface: var(--tg-theme-secondary-bg-color, #181b22);
      --surface-hover: #20242e;
      --border: #2a2f3d;
      --text: var(--tg-theme-text-color, #e6e9ef);
      --muted: var(--tg-theme-hint-color, #8b93a7);
      --accent: var(--tg-theme-button-color, #4c8bf5);
      --accent-text: var(--tg-theme-button-text-color, #ffffff);
      --danger: #e05d6f;
      --success: #45b37f;
      --radius: 12px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
      padding: 12px 14px 28px;
      -webkit-font-smoothing: antialiased;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    header h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .btn-ghost {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }

    .tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 8px;
      margin-bottom: 12px;
      scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
      display: none;
    }

    .tab {
      flex: 0 0 auto;
      background: var(--surface);
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }

    .tab.active {
      background: var(--accent);
      color: var(--accent-text);
      border-color: var(--accent);
    }

    .banner {
      background: rgba(224, 93, 111, 0.14);
      border: 1px solid rgba(224, 93, 111, 0.4);
      color: #f5a6b0;
      border-radius: var(--radius);
      padding: 10px 12px;
      font-size: 13px;
      margin-bottom: 12px;
      display: none;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      margin-bottom: 10px;
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .card-title {
      font-size: 14px;
      font-weight: 600;
      word-break: break-word;
    }

    .card-meta {
      font-size: 11px;
      color: var(--muted);
      margin-top: 4px;
    }

    .card-body {
      font-size: 13px;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 8px;
    }

    .tag {
      font-size: 11px;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px 6px;
    }

    .btn-sm {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .btn-sm.danger:hover {
      color: var(--danger);
      border-color: var(--danger);
    }

    .btn-sm.success {
      color: var(--success);
      border-color: rgba(69, 179, 127, 0.5);
    }

    .btn-primary {
      background: var(--accent);
      color: var(--accent-text);
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
    }

    .btn-primary:disabled {
      opacity: 0.6;
      cursor: default;
    }

    .form-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .input, .textarea {
      width: 100%;
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
    }

    .textarea {
      min-height: 68px;
      resize: vertical;
    }

    .list-group-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin: 12px 0 6px;
    }

    .list-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 6px;
      cursor: pointer;
    }

    .checkbox {
      width: 18px;
      height: 18px;
      border-radius: 5px;
      border: 1.5px solid var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 11px;
    }

    .list-item.done .checkbox {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-text);
    }

    .list-item.done .list-text {
      text-decoration: line-through;
      color: var(--muted);
    }

    .list-text {
      font-size: 13px;
      word-break: break-word;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 8px;
    }

    .stat-name {
      font-size: 14px;
      font-weight: 500;
      text-transform: capitalize;
    }

    .stat-val {
      font-size: 13px;
      color: var(--muted);
    }

    .section-heading {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin: 14px 0 8px;
    }

    .empty {
      text-align: center;
      color: var(--muted);
      font-size: 13px;
      padding: 28px 12px;
    }
  </style>
</head>
<body>
  <header>
    <h1>Engram</h1>
    <button class="btn-ghost" id="refreshBtn" type="button">Обновить</button>
  </header>

  <div class="banner" id="errorBanner"></div>

  <nav class="tabs" id="tabs">
    <button class="tab active" data-tab="notes" type="button">Заметки</button>
    <button class="tab" data-tab="lists" type="button">Списки</button>
    <button class="tab" data-tab="reminders" type="button">Напоминания</button>
    <button class="tab" data-tab="trackers" type="button">Трекеры</button>
    <button class="tab" data-tab="memory" type="button">Память</button>
  </nav>

  <main id="content">
    <div class="empty">Загрузка...</div>
  </main>

  <script>
    (function () {
      const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
      if (tg) {
        tg.ready();
        tg.expand();
      }

      const initData = tg ? tg.initData : '';
      const basePath = window.location.pathname.replace(/\\/+$/, '');

      let activeTab = 'notes';
      let state = {
        notes: [],
        reminders: [],
        lists: [],
        memories: [],
        trackerSummary: [],
        documents: [],
      };

      const contentEl = document.getElementById('content');
      const errorEl = document.getElementById('errorBanner');
      const tabsEl = document.getElementById('tabs');
      const refreshBtn = document.getElementById('refreshBtn');

      function showError(msg) {
        if (!msg) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
          return;
        }
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
      }

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatDate(ms) {
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

      async function api(path, options) {
        const res = await fetch(basePath + path, {
          ...(options || {}),
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': initData,
            ...((options && options.headers) || {}),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        return data;
      }

      async function loadData() {
        showError('');
        if (!initData) {
          showError('Откройте приложение внутри Telegram для доступа к данным.');
          contentEl.innerHTML = '<div class="empty">Нет данных авторизации Telegram.</div>';
          return;
        }
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
          render();
        } catch (err) {
          showError(err.message || 'Ошибка загрузки данных');
          contentEl.innerHTML = '<div class="empty">Не удалось загрузить данные.</div>';
        }
      }

      function renderNotes() {
        const formHtml =
          '<form class="form-box" id="noteForm">' +
            '<input class="input" id="noteTitle" type="text" placeholder="Заголовок заметки" />' +
            '<textarea class="textarea" id="noteContent" placeholder="Текст заметки..." required></textarea>' +
            '<input class="input" id="noteTags" type="text" placeholder="Теги через запятую (необязательно)" />' +
            '<button class="btn-primary" type="submit" id="noteSubmit">Сохранить заметку</button>' +
          '</form>';

        if (!state.notes.length) {
          return formHtml + '<div class="empty">Заметок пока нет.</div>';
        }

        const cards = state.notes.map((n) => {
          const tags = (n.tags || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => '<span class="tag">#' + escapeHtml(t) + '</span>')
            .join('');

          return (
            '<div class="card">' +
              '<div class="card-header">' +
                '<div class="card-title">' + escapeHtml(n.title || 'Без названия') + '</div>' +
                '<button class="btn-sm danger" data-delete-note="' + n.id + '" type="button">Удалить</button>' +
              '</div>' +
              '<div class="card-body">' + escapeHtml(n.content) + '</div>' +
              (tags ? '<div class="tags">' + tags + '</div>' : '') +
              '<div class="card-meta">' + escapeHtml(formatDate(n.updated_at)) + '</div>' +
            '</div>'
          );
        }).join('');

        return formHtml + cards;
      }

      function renderLists() {
        if (!state.lists.length) {
          return '<div class="empty">Списки пусты.</div>';
        }

        const groups = {};
        for (const item of state.lists) {
          const name = item.list_name || 'общее';
          if (!groups[name]) groups[name] = [];
          groups[name].push(item);
        }

        return Object.keys(groups).map((name) => {
          const itemsHtml = groups[name].map((item) => {
            const doneClass = item.done ? ' done' : '';
            const check = item.done ? 'v' : '';
            return (
              '<div class="list-item' + doneClass + '" data-toggle-list="' + item.id + '">' +
                '<div class="checkbox">' + check + '</div>' +
                '<div class="list-text">' + escapeHtml(item.text) + '</div>' +
              '</div>'
            );
          }).join('');
          return '<div class="list-group-title">' + escapeHtml(name) + '</div>' + itemsHtml;
        }).join('');
      }

      function renderReminders() {
        if (!state.reminders.length) {
          return '<div class="empty">Активных напоминаний нет.</div>';
        }

        return state.reminders.map((r) => (
          '<div class="card">' +
            '<div class="card-header">' +
              '<div class="card-title">' + escapeHtml(r.text) + '</div>' +
              '<button class="btn-sm success" data-done-reminder="' + r.id + '" type="button">Готово</button>' +
            '</div>' +
            '<div class="card-meta">Срок: ' + escapeHtml(formatDate(r.due_at)) + '</div>' +
          '</div>'
        )).join('');
      }

      function renderTrackers() {
        if (!state.trackerSummary.length) {
          return '<div class="empty">Записей в трекерах за 30 дней нет.</div>';
        }

        return state.trackerSummary.map((row) => {
          const totalText = row.total
            ? row.total + (row.unit ? ' ' + row.unit : '') + ' (' + row.count + ' зап.)'
            : row.count + ' зап.';
          return (
            '<div class="stat-row">' +
              '<div class="stat-name">' + escapeHtml(row.category) + '</div>' +
              '<div class="stat-val">' + escapeHtml(totalText) + '</div>' +
            '</div>'
          );
        }).join('');
      }

      function renderMemory() {
        let html = '<div class="section-heading">Факты и предпочтения</div>';
        if (!state.memories.length) {
          html += '<div class="empty">Память пока пуста.</div>';
        } else {
          html += state.memories.map((m) => (
            '<div class="card">' +
              '<div class="card-title">' + escapeHtml(m.key) + '</div>' +
              '<div class="card-body">' + escapeHtml(m.value) + '</div>' +
            '</div>'
          )).join('');
        }

        html += '<div class="section-heading">Документы</div>';
        if (!state.documents.length) {
          html += '<div class="empty">Сохраненных документов нет.</div>';
        } else {
          html += state.documents.map((d) => (
            '<div class="card">' +
              '<div class="card-title">' + escapeHtml(d.file_name) + '</div>' +
              '<div class="card-meta">' + escapeHtml(d.mime_type) + ' — ' + escapeHtml(formatDate(d.created_at)) + '</div>' +
            '</div>'
          )).join('');
        }

        return html;
      }

      function render() {
        if (activeTab === 'notes') contentEl.innerHTML = renderNotes();
        else if (activeTab === 'lists') contentEl.innerHTML = renderLists();
        else if (activeTab === 'reminders') contentEl.innerHTML = renderReminders();
        else if (activeTab === 'trackers') contentEl.innerHTML = renderTrackers();
        else if (activeTab === 'memory') contentEl.innerHTML = renderMemory();

        const noteForm = document.getElementById('noteForm');
        if (noteForm) {
          noteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('noteTitle').value.trim();
            const content = document.getElementById('noteContent').value.trim();
            const tags = document.getElementById('noteTags').value.trim();
            const submitBtn = document.getElementById('noteSubmit');
            if (!content) return;

            submitBtn.disabled = true;
            try {
              const res = await api('/api/notes', {
                method: 'POST',
                body: JSON.stringify({ title, content, tags }),
              });
              if (res.note) {
                state.notes.unshift(res.note);
              }
              render();
            } catch (err) {
              showError(err.message || 'Не удалось создать заметку');
              submitBtn.disabled = false;
            }
          });
        }
      }

      tabsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab');
        if (!btn) return;
        activeTab = btn.getAttribute('data-tab') || 'notes';
        for (const el of tabsEl.querySelectorAll('.tab')) {
          el.classList.toggle('active', el === btn);
        }
        render();
      });

      contentEl.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('[data-delete-note]');
        if (delBtn) {
          const id = delBtn.getAttribute('data-delete-note');
          try {
            await api('/api/notes/' + id, { method: 'DELETE' });
            state.notes = state.notes.filter((n) => String(n.id) !== String(id));
            render();
          } catch (err) {
            showError(err.message || 'Не удалось удалить заметку');
          }
          return;
        }

        const listEl = e.target.closest('[data-toggle-list]');
        if (listEl) {
          const id = listEl.getAttribute('data-toggle-list');
          try {
            const res = await api('/api/lists/' + id + '/toggle', { method: 'POST' });
            if (res.item) {
              state.lists = state.lists.map((it) =>
                String(it.id) === String(id) ? res.item : it
              );
              render();
            }
          } catch (err) {
            showError(err.message || 'Не удалось обновить элемент списка');
          }
          return;
        }

        const remBtn = e.target.closest('[data-done-reminder]');
        if (remBtn) {
          const id = remBtn.getAttribute('data-done-reminder');
          try {
            await api('/api/reminders/' + id + '/done', { method: 'POST' });
            state.reminders = state.reminders.filter((r) => String(r.id) !== String(id));
            render();
          } catch (err) {
            showError(err.message || 'Не удалось завершить напоминание');
          }
        }
      });

      refreshBtn.addEventListener('click', loadData);
      loadData();
    })();
  </script>
</body>
</html>`;
}
