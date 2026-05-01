import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Наставник — Консоль</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Crimson+Pro:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:        #0e0e0e;
    --surface:   #161616;
    --surface2:  #1e1e1e;
    --border:    #2a2a2a;
    --amber:     #f59e0b;
    --amber-dim: rgba(245,158,11,0.12);
    --amber-glow:rgba(245,158,11,0.06);
    --text:      #e2d9c8;
    --text-dim:  #6b6560;
    --text-mid:  #9a9088;
    --user-bg:   linear-gradient(135deg, #92400e 0%, #b45309 100%);
    --bot-bg:    #1e1e1e;
    --radius-lg: 18px;
    --radius-sm: 6px;
    --font-ui:   'JetBrains Mono', monospace;
    --font-msg:  'Crimson Pro', Georgia, serif;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--font-ui);
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── TOPBAR ── */
  .topbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 20px;
    height: 52px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    position: relative;
  }
  .topbar-logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .topbar-icon {
    width: 28px; height: 28px;
    background: var(--amber);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }
  .topbar-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--amber);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .topbar-sep { width: 1px; height: 20px; background: var(--border); }
  .topbar-sub {
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
  }
  .topbar-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #22c55e;
    margin-left: auto;
    box-shadow: 0 0 6px #22c55e;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%,100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── LAYOUT ── */
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── SIDEBAR ── */
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-head {
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
  }
  .sidebar-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 10px;
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 7px 10px;
    transition: border-color 0.2s;
  }
  .search-box:focus-within { border-color: var(--amber); }
  .search-box svg { flex-shrink: 0; opacity: 0.4; }
  .search-box input {
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    width: 100%;
  }
  .search-box input::placeholder { color: var(--text-dim); }

  .chat-list { overflow-y: auto; flex: 1; padding: 8px 0; }
  .chat-list::-webkit-scrollbar { width: 4px; }
  .chat-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .chat-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    border-radius: 0;
    transition: background 0.15s;
    position: relative;
  }
  .chat-item::before {
    content: '';
    position: absolute;
    left: 0; top: 50%; transform: translateY(-50%);
    width: 3px; height: 0;
    background: var(--amber);
    border-radius: 0 2px 2px 0;
    transition: height 0.2s;
  }
  .chat-item:hover { background: var(--amber-glow); }
  .chat-item.active { background: var(--amber-dim); }
  .chat-item.active::before { height: 32px; }

  .avatar {
    width: 40px; height: 40px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
    font-weight: 600;
    flex-shrink: 0;
    letter-spacing: 0;
    font-family: var(--font-ui);
  }
  .avatar-colors { background: linear-gradient(135deg, #1e3a5f 0%, #0f3460 100%); color: #60a5fa; }
  .avatar-colors-2 { background: linear-gradient(135deg, #3f1e5f 0%, #6d28d9 60%); color: #c4b5fd; }
  .avatar-colors-3 { background: linear-gradient(135deg, #1e4a2f 0%, #065f46 60%); color: #6ee7b7; }

  .chat-meta { flex: 1; min-width: 0; }
  .chat-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 3px;
  }
  .chat-item.active .chat-name { color: var(--amber); }
  .chat-preview {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-msg);
    font-style: italic;
  }
  .chat-badge {
    background: var(--amber);
    color: #000;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    flex-shrink: 0;
    letter-spacing: 0;
  }

  /* ── MAIN ── */
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .chat-header-avatar {
    width: 36px; height: 36px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 600;
  }
  .chat-header-info { flex: 1; }
  .chat-header-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.02em;
  }
  .chat-header-sub {
    font-size: 11px;
    color: var(--text-dim);
    margin-top: 1px;
  }
  .chat-header-actions { display: flex; gap: 8px; }
  .btn-icon {
    width: 32px; height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-mid);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 13px;
  }
  .btn-icon:hover { border-color: var(--amber); color: var(--amber); }

  /* ── MESSAGES ── */
  .messages-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .messages-wrap::-webkit-scrollbar { width: 6px; }
  .messages-wrap::-webkit-scrollbar-track { background: transparent; }
  .messages-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* Date divider */
  .date-div {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 8px;
    animation: fadeIn 0.3s ease;
  }
  .date-div::before, .date-div::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .date-div span {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
    white-space: nowrap;
    padding: 3px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
  }

  /* Message row */
  .msg-row {
    display: flex;
    gap: 10px;
    max-width: 68%;
    animation: msgIn 0.2s ease;
  }
  .msg-row.user { align-self: flex-end; flex-direction: row-reverse; }
  .msg-row.assistant { align-self: flex-start; }

  @keyframes msgIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .msg-avatar-sm {
    width: 28px; height: 28px;
    border-radius: 8px;
    flex-shrink: 0;
    margin-top: auto;
    margin-bottom: 2px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px;
  }
  .msg-avatar-sm.user { background: var(--amber); color: #000; }
  .msg-avatar-sm.bot  { background: var(--surface2); border: 1px solid var(--border); }

  .msg-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .msg-row.user .msg-body { align-items: flex-end; }

  .msg-bubble {
    padding: 10px 14px;
    border-radius: var(--radius-lg);
    font-family: var(--font-msg);
    font-size: 16px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    position: relative;
  }
  .msg-row.user .msg-bubble {
    background: var(--user-bg);
    color: #fff;
    border-bottom-right-radius: 5px;
    box-shadow: 0 2px 12px rgba(245,158,11,0.2);
  }
  .msg-row.assistant .msg-bubble {
    background: var(--bot-bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-bottom-left-radius: 5px;
  }
  .msg-time {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    padding: 0 4px;
    font-family: var(--font-ui);
  }

  /* Consecutive messages compression */
  .msg-row + .msg-row.user { margin-top: 2px; }
  .msg-row + .msg-row.assistant { margin-top: 2px; }
  .msg-row.user + .msg-row.assistant,
  .msg-row.assistant + .msg-row.user { margin-top: 10px; }

  /* ── EMPTY / LOADING ── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dim);
  }
  .empty-icon {
    font-size: 40px;
    filter: grayscale(0.5);
    opacity: 0.5;
  }
  .empty-text { font-size: 13px; letter-spacing: 0.04em; }

  .spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--amber);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-dim);
    font-size: 12px;
  }

  /* ── FILTER BAR ── */
  .filter-bar {
    display: flex;
    gap: 6px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }
  .filter-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    font-family: var(--font-ui);
    transition: all 0.15s;
  }
  .filter-btn:hover { border-color: var(--amber); color: var(--amber); }
  .filter-btn.on { background: var(--amber-dim); border-color: var(--amber); color: var(--amber); }

  /* Stats row */
  .stats-row {
    display: flex;
    gap: 16px;
    padding: 0 20px 0;
    margin-left: auto;
    align-items: center;
  }
  .stat { font-size: 10px; color: var(--text-dim); letter-spacing: 0.04em; }
  .stat b { color: var(--text-mid); font-weight: 500; }

  /* Noise overlay for atmosphere */
  body::after {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    z-index: 9999;
  }
</style>
</head>
<body>

<div class="topbar">
  <div class="topbar-logo">
    <div class="topbar-icon">🤖</div>
    <span class="topbar-title">Наставник</span>
  </div>
  <div class="topbar-sep"></div>
  <span class="topbar-sub">viewer console</span>
  <div class="topbar-dot"></div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-label">Пользователи</div>
      <div class="search-box">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input id="searchInput" type="text" placeholder="Поиск...">
      </div>
    </div>
    <div class="chat-list" id="chatList">
      <div style="padding:20px 16px;font-size:11px;color:var(--text-dim)">Загрузка...</div>
    </div>
  </div>

  <div class="main">
    <div id="chatHeader" style="display:none" class="chat-header">
      <div class="chat-header-avatar avatar avatar-colors" id="chatHeaderAvatar"></div>
      <div class="chat-header-info">
        <div class="chat-header-name" id="chatHeaderName"></div>
        <div class="chat-header-sub" id="chatHeaderSub"></div>
      </div>
      <div class="chat-header-actions">
        <div class="btn-icon" onclick="scrollBottom()" title="В конец">↓</div>
        <div class="btn-icon" onclick="reload()" title="Обновить">↺</div>
      </div>
    </div>

    <div id="filterBar" style="display:none" class="filter-bar">
      <button class="filter-btn on" data-filter="all" onclick="setFilter('all')">Все</button>
      <button class="filter-btn" data-filter="user" onclick="setFilter('user')">Пользователь</button>
      <button class="filter-btn" data-filter="assistant" onclick="setFilter('assistant')">Наставник</button>
      <div class="stats-row">
        <div class="stat">всего: <b id="statTotal">—</b></div>
        <div class="stat">от юзера: <b id="statUser">—</b></div>
        <div class="stat">от бота: <b id="statBot">—</b></div>
      </div>
    </div>

    <div id="messagesWrap" class="messages-wrap">
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-text">выбери чат слева</div>
      </div>
    </div>
  </div>
</div>

<script>
const AVATAR_CLASSES = ['avatar-colors', 'avatar-colors-2', 'avatar-colors-3'];
let allMessages = [];
let currentFilter = 'all';
let currentUserId = null;
let allUsers = [];

async function loadUsers() {
  const res = await fetch('/api/users');
  allUsers = await res.json();
  renderUsers(allUsers);
}

function renderUsers(users) {
  const list = document.getElementById('chatList');
  list.innerHTML = '';
  users.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'chat-item' + (u.id === currentUserId ? ' active' : '');
    el.dataset.id = u.id;
    const cls = AVATAR_CLASSES[i % AVATAR_CLASSES.length];
    const initial = u.name[0].toUpperCase();
    el.innerHTML = \`
      <div class="avatar \${cls}">\${initial}</div>
      <div class="chat-meta">
        <div class="chat-name">\${esc(u.name)}</div>
        <div class="chat-preview">\${esc(u.last_msg || '—')}</div>
      </div>
      <div class="chat-badge">\${u.msg_count}</div>
    \`;
    el.onclick = () => selectUser(u.id, u.name, u.msg_count, i);
    list.appendChild(el);
  });
}

async function selectUser(userId, name, count, idx) {
  currentUserId = userId;
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.id) === userId);
  });

  const cls = AVATAR_CLASSES[idx % AVATAR_CLASSES.length];
  const hdr = document.getElementById('chatHeader');
  hdr.style.display = 'flex';
  document.getElementById('chatHeaderAvatar').className = 'chat-header-avatar avatar ' + cls;
  document.getElementById('chatHeaderAvatar').textContent = name[0].toUpperCase();
  document.getElementById('chatHeaderName').textContent = name;
  document.getElementById('chatHeaderSub').textContent = 'загрузка...';
  document.getElementById('filterBar').style.display = 'flex';
  document.getElementById('messagesWrap').innerHTML =
    '<div class="loading-state"><div class="spinner"></div><span>загрузка сообщений</span></div>';

  const res = await fetch('/api/messages?userId=' + userId);
  allMessages = await res.json();
  currentFilter = 'all';
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('on', b.dataset.filter === 'all'));
  renderMessages();
  updateStats();
  document.getElementById('chatHeaderSub').textContent = count + ' сообщений';
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('on', b.dataset.filter === f));
  renderMessages();
}

function updateStats() {
  const u = allMessages.filter(m => m.role === 'user').length;
  const b = allMessages.filter(m => m.role === 'assistant').length;
  document.getElementById('statTotal').textContent = allMessages.length;
  document.getElementById('statUser').textContent = u;
  document.getElementById('statBot').textContent = b;
}

function renderMessages() {
  const msgs = currentFilter === 'all' ? allMessages : allMessages.filter(m => m.role === currentFilter);
  const wrap = document.getElementById('messagesWrap');

  if (!msgs.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">🕊️</div><div class="empty-text">нет сообщений</div></div>';
    return;
  }

  let html = '';
  let lastDate = '';
  let lastRole = '';

  for (const m of msgs) {
    const dt = new Date(m.created_at);
    const dateStr = dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (dateStr !== lastDate) {
      html += \`<div class="date-div"><span>\${dateStr}</span></div>\`;
      lastDate = dateStr;
    }

    const isUser = m.role === 'user';
    const avatarIcon = isUser ? '👤' : '🤖';
    const avatarCls = isUser ? 'user' : 'bot';
    const content = esc(m.content);

    html += \`<div class="msg-row \${m.role}">
      <div class="msg-avatar-sm \${avatarCls}">\${avatarIcon}</div>
      <div class="msg-body">
        <div class="msg-bubble">\${content}</div>
        <div class="msg-time">\${timeStr}</div>
      </div>
    </div>\`;

    lastRole = m.role;
  }

  wrap.innerHTML = html;
  scrollBottom();
}

function scrollBottom() {
  const w = document.getElementById('messagesWrap');
  w.scrollTop = w.scrollHeight;
}

function reload() {
  if (currentUserId !== null) {
    const u = allUsers.find(u => u.id === currentUserId);
    if (u) selectUser(u.id, u.name, u.msg_count, allUsers.indexOf(u));
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Search
document.getElementById('searchInput').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderUsers(q ? allUsers.filter(u => u.name.toLowerCase().includes(q)) : allUsers);
});

loadUsers();
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/users') {
    const rows = await sql`
      SELECT u.id, u.name,
        COUNT(m.id)::int AS msg_count,
        (SELECT content FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_msg
      FROM users u
      LEFT JOIN messages m ON m.user_id = u.id
      GROUP BY u.id, u.name
      ORDER BY msg_count DESC
    `;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }

  if (url.pathname === '/api/messages') {
    const userId = parseInt(url.searchParams.get('userId'));
    const rows = await sql`
      SELECT role, content, created_at
      FROM messages
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

server.listen(4000, () => {
  console.log('► Chat viewer ready: http://localhost:4000');
});
