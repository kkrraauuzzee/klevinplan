// адрес серверных api-запросов
const API = '';

// основные данные текущего пользователя
let token = localStorage.getItem('klevin_token') || '';
let currentUser = null;
let spaces = [];
let activeSpaceId = Number(localStorage.getItem('klevin_space_id') || 0);
let tab = 'overview';
let authMode = 'login';

let cache = { tasks: [], events: [], notes: [], attachments: [], members: [], friends: [] };

let friendRequests = [];

let invitations = [];

let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let calendarSelectedDate = '';
let calendarView = 'month';

let contextMenuDate = '';
let contextMenuEl = null;

// контекстное меню календаря
function contextMenuHandler(ev, dateStr) {
  ev.preventDefault();
  hideContextMenu();
  contextMenuDate = dateStr;
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.top = `${ev.clientY}px`;
  menu.style.left = `${ev.clientX}px`;
  menu.innerHTML = `
    <button onclick="contextAction('task')">Задача</button>
    <button onclick="contextAction('event')">Событие</button>
    <button onclick="contextAction('note')">Заметка</button>
  `;
  document.body.appendChild(menu);
  contextMenuEl = menu;
}

function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function contextAction(kind) {
  if (!contextMenuDate) return;
  calendarSelectedDate = contextMenuDate;
  const d = new Date(contextMenuDate + 'T00:00:00');
  calendarYear = d.getFullYear();
  calendarMonth = d.getMonth();
  if (kind === 'note') {
    tab = 'notes';
  } else {
    tab = 'items';
  }
  renderApp();
  setTimeout(() => {
    if (kind === 'note') {
      if (!visibility.noteForm) toggleNoteForm();
    } else {
      if (!visibility.itemForm) toggleItemForm();
    }
    createDayItem(kind);
  });
  hideContextMenu();
}

document.addEventListener('click', (ev) => {
  if (contextMenuEl && contextMenuEl.contains(ev.target)) return;
  hideContextMenu();
});

// всплывающее сообщение для результата действия
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

async function loadInvitations() {
  try {
    invitations = await api('/api/invitations');
  } catch (e) {
    invitations = [];
  }
}

async function loadFriendRequests() {
  try {
    friendRequests = await api('/api/friend-requests');
  } catch (e) {
    friendRequests = [];
  }
}

async function respondFriendRequest(id, status) {
  try {
    await api(`/api/friend-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadApp();
    showToast(status === 'accepted' ? 'Друг добавлен' : 'Запрос отклонён', status === 'accepted' ? 'success' : 'error');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function respondInvite(id, status) {
  try {
    await api(`/api/invitations/${id}`, { method:'PATCH', body: JSON.stringify({ status }) });
    await loadApp();
    showToast(status === 'accepted' ? 'Приглашение принято' : 'Приглашение отклонено', status === 'accepted' ? 'success' : 'error');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

const visibility = {
  itemForm: false,
  noteForm: false,
  fileForm: false,
  spaceForm: false,
  memberForm: false,
  friendForm: false,
  profileForm: false
};

const commentState = {};

// общий запрос к серверу с токеном
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function daysDiff(dateStr) {
  if (!dateStr) return 0;
  const today = new Date();
  const d = new Date(dateStr + 'T00:00:00');
  const diffMs = d.setHours(0,0,0,0) - today.setHours(0,0,0,0);
  return Math.round(diffMs / 86400000);
}

function statusBadge(item) {
  if (item.kind === 'note' || item.kind === 'file') {
    return `<span class="status">${item.date ? fmtDate(item.date) : 'без даты'}</span>`;
  }
  if (item.kind === 'event') {
    return `<span class="status">${fmtDate(item.date)}</span>`;
  }
  if (item.status === 'Готово') {
    return `<span class="status ok">готово</span>`;
  }
  const d = daysDiff(item.date);
  if (d < 0) return `<span class="status bad">просрочено</span>`;
  if (d === 0) return `<span class="status warn">сегодня</span>`;
  if (d === 1) return `<span class="status warn">остался 1 день</span>`;
  return `<span class="status ok">${d} дн.</span>`;
}

function statusClass(item) {
  if (item.kind === 'task') {
    if (item.status === 'Готово') return 'ok';
    const d = daysDiff(item.date);
    if (d < 0) return 'bad';
    if (d <= 1) return 'warn';
    return '';
  }
  if (item.kind === 'file') return 'file';
  return '';
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

function showErr(text) {
  const el = document.getElementById('err');
  if (el) {
    el.style.display = 'block';
    el.textContent = text;
  }
}

function setAuthMode(mode) {
  authMode = mode;
  renderLogin();
}

async function login() {
  const loginVal = document.getElementById('login').value.trim();
  const passVal = document.getElementById('pass').value;
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: loginVal, password: passVal }) });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('klevin_token', token);
    await loadApp();
    tab = 'overview';
    renderApp();
  } catch (e) {
    showErr(e.message);
  }
}

async function register() {
  const name = (document.getElementById('regName')?.value || '').trim();
  const loginVal = document.getElementById('login').value.trim();
  const pass = document.getElementById('pass').value;
  const pass2 = (document.getElementById('pass2')?.value || '');
  if (!name) {
    showErr('Имя обязательно');
    return;
  }
  if (!/^[a-zA-Z]{5,}$/.test(loginVal)) {
    showErr('Логин должен содержать не менее 5 английских букв');
    return;
  }
  if (!pass) {
    showErr('Пароль обязателен');
    return;
  }
  if (pass !== pass2) {
    showErr('Пароли не совпадают');
    return;
  }
  const body = { name, login: loginVal, password: pass };
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('klevin_token', token);
    await loadApp();
    tab = 'overview';
    renderApp();
  } catch (e) {
    showErr(e.message);
  }
}

function logout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('klevin_token');
  renderLogin();
}

function setTab(t) {
  tab = t;
  renderApp();
}

async function setSpace(id) {
  activeSpaceId = Number(id);
  localStorage.setItem('klevin_space_id', String(activeSpaceId));
  await loadSpaceData();
  renderApp();
}

function activeSpace() {
  return spaces.find(s => s.id === activeSpaceId) || spaces[0];
}

async function loadApp() {
  const me = await api('/api/me');
  currentUser = me.user;
  spaces = await api('/api/spaces');
  if (!activeSpaceId || !spaces.some(s => s.id === activeSpaceId)) {
    activeSpaceId = spaces[0]?.id || 0;
  }
  localStorage.setItem('klevin_space_id', String(activeSpaceId));
  await loadInvitations();
  await loadFriendRequests();
  await loadSpaceData();
}

async function loadSpaceData() {
  if (!activeSpaceId) return;
  const [tasks, events, notes, attachments, members, friends] = await Promise.all([
    api(`/api/spaces/${activeSpaceId}/tasks`),
    api(`/api/spaces/${activeSpaceId}/events`),
    api(`/api/spaces/${activeSpaceId}/notes`),
    api(`/api/spaces/${activeSpaceId}/attachments`),
    api(`/api/spaces/${activeSpaceId}/members`),
    api('/api/friends')
  ]);
  cache = { tasks, events, notes, attachments, members, friends };
}

function normalizeItems() {
  const tasks = cache.tasks.map(t => ({
    id: t.id,
    kind: 'task',
    title: t.title,
    description: t.description,
    date: t.due_date,
    time: t.due_time,
    status: t.status,
    priority: t.priority,
    comments: t.comments
  }));
  const events = cache.events.map(e => ({
    id: e.id,
    kind: 'event',
    title: e.title,
    description: e.description,
    date: e.event_date,
    time: e.event_time,
    status: 'Событие',
    comments: e.comments
  }));
  const notes = cache.notes.map(n => ({
    id: n.id,
    kind: 'note',
    title: n.title,
    description: n.content,
    date: n.note_date,
    time: '',
    status: 'Заметка',
    comments: n.comments
  }));
  const files = cache.attachments.map(a => ({
    id: a.id,
    kind: 'file',
    title: a.file_name,
    description: a.description,
    date: a.created_at ? a.created_at.slice(0, 10) : '',
    time: '',
    status: 'Файл',
    comments: a.comments
  }));
  const items = [...tasks, ...events, ...notes, ...files];
  return items.sort((a, b) => {
    const da = a.date || '9999-99-99';
    const db = b.date || '9999-99-99';
    if (da < db) return -1;
    if (da > db) return 1;
    const ta = a.time || '99:99';
    const tb = b.time || '99:99';
    return ta.localeCompare(tb);
  });
}

// экран входа и регистрации
function renderLogin() {
  document.getElementById('root').innerHTML = `
    <section class="login">
      <div class="hero">
        <div class="brand">
          <div class="logo">KP</div>
          <div>KlevinPlan</div>
        </div>
        <div>
          <h1>Совместное пространство для дел, событий и задач</h1>
          <p>Удобное пространство для совместного планирования дел, событий и задач.</p>
        </div>
        <div class="hero-cards">
          <div class="hero-card">
            <div class="logo">1</div>
            <b>Пространства</b>
            <span>личные и совместные области работы</span>
          </div>
          <div class="hero-card">
            <div class="logo">2</div>
            <b>Задачи</b>
            <span>дата, время и визуальный статус срока</span>
          </div>
          <div class="hero-card">
            <div class="logo">3</div>
            <b>Совместность</b>
            <span>друзья, участники и комментарии</span>
          </div>
        </div>
      </div>
      <div class="login-panel">
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="${authMode === 'login' ? 'active' : ''}" onclick="setAuthMode('login')">Вход</button>
            <button class="${authMode === 'register' ? 'active' : ''}" onclick="setAuthMode('register')">Регистрация</button>
          </div>
          <h2>${authMode === 'login' ? 'Вход в систему' : 'Создание аккаунта'}</h2>
          <p>${authMode === 'login' ? 'Закрытые разделы доступны только после входа.' : 'После регистрации автоматически создаётся личное пространство.'}</p>
          <div id="err" class="error"></div>
          ${authMode === 'register' ? `
            <label class="field"><span>Имя</span><input id="regName" placeholder="Например: Андрей"></label>
          ` : ''}
          <label class="field"><span>Логин</span><input id="login" value="${authMode === 'login' ? 'klevin' : ''}" placeholder="login" autocomplete="username"></label>
          <label class="field"><span>Пароль</span><input id="pass" type="password" value="${authMode === 'login' ? '123321' : ''}" placeholder="password" autocomplete="current-password"></label>
          ${authMode === 'register' ? `
            <label class="field"><span>Повторите пароль</span><input id="pass2" type="password" placeholder="password" autocomplete="new-password"></label>
          ` : ''}
          <button class="btn full" onclick="${authMode === 'login' ? 'login()' : 'register()'}">${authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
          <div class="hint">
            Пользователь: <b>klevin / 123321</b><br>
            Друг: <b>karina / 123321</b><br>
            Администратор: <b>admin / 123321</b>
          </div>
        </div>
      </div>
    </section>
  `;
}

// сборка основного интерфейса приложения
function renderApp() {
  const s = activeSpace();
  if (!currentUser || !s) {
    renderLogin();
    return;
  }
  const nav = [
    ['overview', 'Обзор'],
    ['calendar', 'Календарь'],
    ['items', 'Задачи и события'],
    ['notes', 'Заметки'],
    ['files', 'Файлы'],
    ['friends', 'Друзья'],
    ['spaces', 'Пространства'],
    ['profile', 'Профиль']
  ];
  document.getElementById('root').innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="side-inner">
          <div class="side-brand">
            <div class="logo">KP</div>
            <div>
              <b>KlevinPlan</b>
              <small>пространства и задачи</small>
            </div>
          </div>
          <nav class="nav">
            ${nav.map(([k, title]) => {
              let label = title;
              if (k === 'profile' && invitations && invitations.length) {
                label += `<span class="badge">${invitations.length}</span>`;
              }
              if (k === 'friends' && friendRequests && friendRequests.length) {
                label += `<span class="badge">${friendRequests.length}</span>`;
              }
              return `<button class="${tab === k ? 'active' : ''}" onclick="setTab('${k}')">${label}</button>`;
            }).join('')}
          </nav>
          <div class="profile">
            <b>${esc(currentUser.name)}</b>
            <small>Логин: <b>${esc(currentUser.login)}</b></small>
            <small>${currentUser.global_role === 'admin' ? 'администратор' : 'пользователь'}</small>
            <button class="btn secondary" onclick="logout()">Выйти</button>
          </div>
        </div>
      </aside>
      <main class="main">
        <section class="top">
          <div>
            <span class="pill">${s.type === 'personal' ? 'личное пространство' : s.type === 'shared' ? 'совместное пространство' : 'пространство'}</span>
            <h2>${esc(s.title)}</h2>
            <p>${esc(s.description || '')} Переключить пространство можно в панели справа.</p>
          </div>
          <div class="toolbar">
            <select class="select-space" onchange="setSpace(this.value)">
              ${spaces.map(sp => `<option value="${sp.id}" ${sp.id === s.id ? 'selected' : ''}>${esc(sp.title)}</option>`).join('')}
            </select>
          </div>
        </section>
        ${content()}
      </main>
    </div>
  `;
}

// выбор страницы по активной вкладке
function content() {
  switch (tab) {
    case 'items': return itemsPage();
    case 'notes': return notesPage();
    case 'files': return filesPage();
    case 'friends': return friendsPage();
    case 'spaces': return spacesPage();
    case 'profile': return profilePage();
    case 'calendar': return calendarPage();
    default: return overview();
  }
}

// краткая сводка по задачам и событиям
function overview() {
  const all = normalizeItems();
  const tasksList = all.filter(i => i.kind === 'task');
  const events = all.filter(i => i.kind === 'event');
  const overdue = tasksList.filter(i => i.status !== 'Готово' && daysDiff(i.date) < 0).length;
  const soon = tasksList.filter(i => i.status !== 'Готово' && daysDiff(i.date) >= 0 && daysDiff(i.date) <= 1).length;
  const latest = all.slice(0, 6);
  return `
    <div class="grid3">
      <div class="card stat">
        <div class="n">${tasksList.length}</div>
        <b>Задачи</b>
        <small>создание, редактирование, статус срока</small>
      </div>
      <div class="card stat">
        <div class="n">${events.length}</div>
        <b>События</b>
        <small>дата, время и комментарии</small>
      </div>
      <div class="card stat">
        <div class="n">${overdue}/${soon}</div>
        <b>Просрочено / скоро</b>
        <small>красный — просрочено, жёлтый — срок близко</small>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Последние записи пространства</h3>
      <div class="list">
        ${latest.map(itemCard).join('') || `<div class="empty"><b>Пока пусто</b>Добавьте первую запись.</div>`}
      </div>
    </div>
  `;
}

function toggleItemForm() {
  visibility.itemForm = !visibility.itemForm;
  renderApp();
}

function itemsPage() {
  const all = normalizeItems().filter(i => ['task','event'].includes(i.kind));
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0">Задачи и события</h3>
        <button class="btn" onclick="toggleItemForm()">${visibility.itemForm ? 'Отмена' : 'Создать запись'}</button>
      </div>
      ${visibility.itemForm ? itemForm() : ''}
      <div class="list" style="margin-top:16px;">
        ${all.map(itemCard).join('') || `<div class="empty"><b>Пока нет записей</b>Создайте задачу или событие.</div>`}
      </div>
    </div>
  `;
}

// форма создания задачи или события
function itemForm() {
  return `
    <div class="card" style="margin-top:16px;background:#F9F6F1;">
      <h3 style="margin-top:0">Новая запись</h3>
      <label class="field"><span>Тип</span>
        <select id="itemType" onchange="togglePriorityField(this.value);">
          <option value="task">Задача</option>
          <option value="event">Событие</option>
        </select>
      </label>
      <label class="field"><span>Название</span><input id="itemTitle" placeholder="Например: купить продукты"></label>
      <label class="field"><span>Дата</span><input id="itemDate" type="date" value="${calendarSelectedDate || new Date().toISOString().slice(0,10)}"></label>
      <label class="field"><span>Время</span><input id="itemTime" type="time" value="${new Date().toTimeString().slice(0,5)}"></label>
      <label class="field"><span><input type="checkbox" id="itemAllDay" onchange="toggleTimeField(this.checked)"> Весь день</span></label>
      <div id="priorityField" class="field">
        <span>Приоритет</span>
        <select id="itemPriority">
          <option value="low">низкий</option>
          <option value="medium" selected>средний</option>
          <option value="high">высокий</option>
        </select>
      </div>
      <label class="field"><span>Описание</span><textarea id="itemDesc" placeholder="Детали записи"></textarea></label>
      <button class="btn full" onclick="addItem()">Добавить</button>
    </div>
  `;
}

function togglePriorityField(val) {
  const pf = document.getElementById('priorityField');
  if (pf) {
    pf.style.display = (val === 'task' ? 'block' : 'none');
  }
}

function toggleTimeField(checked) {
  const timeInput = document.getElementById('itemTime');
  if (!timeInput) return;
  if (checked) {
    timeInput.style.display = 'none';
    timeInput.value = '';
  } else {
    timeInput.style.display = 'block';
    if (!timeInput.value) {
      timeInput.value = new Date().toTimeString().slice(0,5);
    }
  }
}

async function addItem() {
  const type = document.getElementById('itemType').value;
  const title = document.getElementById('itemTitle').value.trim();
  if (!title) {
    showToast('Название обязательно', 'error');
    return;
  }
  const body = {
    title,
    description: document.getElementById('itemDesc').value.trim(),
  };
  const date = document.getElementById('itemDate').value;
  const allDay = document.getElementById('itemAllDay') && document.getElementById('itemAllDay').checked;
  const time = allDay ? '' : document.getElementById('itemTime').value;
  try {
    if (type === 'event') {
      body.event_date = date;
      body.event_time = time;
      await api(`/api/spaces/${activeSpaceId}/events`, { method:'POST', body: JSON.stringify(body) });
    } else {
      body.due_date = date;
      body.due_time = time;
      body.task_type = 'task';
      body.priority = document.getElementById('itemPriority').value;
      await api(`/api/spaces/${activeSpaceId}/tasks`, { method:'POST', body: JSON.stringify(body) });
    }
    await loadSpaceData();
    visibility.itemForm = false;
    showToast('Запись создана', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// карточка задачи или события
function itemCard(i) {
  const key = `${i.kind}_${i.id}`;
  const commentsVisible = commentState[key];
  const commentCount = i.comments ? i.comments.length : 0;
  return `
    <div class="item-card">
      <div class="item-head">
        <div style="flex:1;min-width:200px;">
        <b>${esc(i.kind === 'task' ? 'Задача' : i.kind === 'event' ? 'Событие' : i.kind === 'note' ? 'Заметка' : i.kind === 'file' ? 'Файл' : '')}: ${esc(i.title)}</b>
          <small>${i.date ? fmtDate(i.date) : ''}${i.time ? ' · ' + esc(i.time) : ''}${i.description ? ' · ' + esc(i.description) : ''}</small>
        </div>
        <div>${statusBadge(i)}</div>
      </div>
      <div class="meta">
        ${i.kind === 'task' ? `<span class="status ${statusClass(i)}">${esc(i.status)}</span>` : ''}
        ${i.kind === 'task' ? `<span class="status">приоритет: ${esc(i.priority)}</span>` : ''}
      </div>
      <div class="row-actions">
        ${i.kind === 'task' ? `<button class="btn secondary" onclick="toggleTaskStatus(${i.id}, '${i.status === 'Готово' ? 'В работе' : 'Готово'}')">${i.status === 'Готово' ? 'Вернуть' : 'Готово'}</button>` : ''}
        <button class="btn danger" onclick="deleteItem('${i.kind}', ${i.id})">Удалить</button>
      </div>
      <div style="margin-top:8px;font-size:13px;color:var(--muted);">
        <button class="btn secondary" style="padding:4px 8px;font-size:12px;" onclick="toggleComments('${i.kind}', ${i.id})">Комментарии (${commentCount}) ${commentsVisible ? '▲' : '▼'}</button>
      </div>
      <div class="comments ${commentsVisible ? '' : 'collapsed'}">
        ${i.comments && i.comments.length ? i.comments.map(c => `<div class="comment"><b>${esc(c.user_name)}:</b> ${esc(c.text)}</div>`).join('') : '<small style="color:var(--muted);">Пока нет комментариев</small>'}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input id="comment_${i.kind}_${i.id}" placeholder="Добавить комментарий" style="flex:1;min-width:0;">
          <button class="btn secondary" onclick="addComment('${i.kind}', ${i.id})">OK</button>
        </div>
      </div>
    </div>
  `;
}

function toggleComments(kind, id) {
  const key = `${kind}_${id}`;
  commentState[key] = !commentState[key];
  renderApp();
}

async function toggleTaskStatus(id, status) {
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  await loadSpaceData();
  renderApp();
}

async function deleteItem(kind, id) {
  let path;
  if (kind === 'event') path = `/api/events/${id}`;
  else if (kind === 'note') path = `/api/notes/${id}`;
  else if (kind === 'file') path = `/api/attachments/${id}`;
  else path = `/api/tasks/${id}`;
  if (!confirm('Вы уверены, что хотите удалить?')) return;
  await api(path, { method: 'DELETE' });
  await loadSpaceData();
  renderApp();
}

async function addComment(kind, id) {
  const input = document.getElementById(`comment_${kind}_${id}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const type = (kind === 'task') ? 'task' : kind;
  await api('/api/comments', { method: 'POST', body: JSON.stringify({ space_id: activeSpaceId, target_type: type, target_id: id, text }) });
  await loadSpaceData();
  commentState[`${kind}_${id}`] = true;
  renderApp();
}

function notesPage() {
  const notes = normalizeItems().filter(i => i.kind === 'note');
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0">Заметки</h3>
        <button class="btn" onclick="toggleNoteForm()">${visibility.noteForm ? 'Отмена' : 'Создать заметку'}</button>
      </div>
      ${visibility.noteForm ? noteForm() : ''}
      <div class="list" style="margin-top:16px;">
        ${notes.map(itemCard).join('') || `<div class="empty"><b>Заметок нет</b>Создайте первую заметку.</div>`}
      </div>
    </div>
  `;
}

// отображение календаря с записями по датам
function calendarPage() {
  const today = new Date();
  const isToday = (y,m,d) => (today.getFullYear() === y && today.getMonth() === m && today.getDate() === d);
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const weekdayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const countByDate = {};
  cache.tasks.forEach(t => {
    if (t.due_date) {
      countByDate[t.due_date] = (countByDate[t.due_date] || 0) + 1;
    }
  });
  cache.events.forEach(e => {
    if (e.event_date) {
      countByDate[e.event_date] = (countByDate[e.event_date] || 0) + 1;
    }
  });
  cache.notes.forEach(n => {
    if (n.note_date) {
      countByDate[n.note_date] = (countByDate[n.note_date] || 0) + 1;
    }
  });
  let headerHtml = '';
  let gridHtml = '';
  if (calendarView === 'week' && calendarSelectedDate) {
    const selected = new Date(calendarSelectedDate + 'T00:00:00');
    const dayOfWeek = (selected.getDay() + 6) % 7;
    const monday = new Date(selected);
    monday.setDate(selected.getDate() - dayOfWeek);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const y = d.getFullYear();
      const m = d.getMonth();
      const day = d.getDate();
      const dateStr = `${y}-${String(m + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const count = countByDate[dateStr] || 0;
      cells.push({ y, m, day, dateStr, count });
    }
    headerHtml = `<div class="calendar-header"><button class="cal-nav" onclick="prevWeek()">&lt;</button><b>Неделя ${fmtDate(cells[0].dateStr)} – ${fmtDate(cells[6].dateStr)}</b><button class="cal-nav" onclick="nextWeek()">&gt;</button><button class="cal-view" onclick="toggleCalendarView()">Месяц</button></div>`;
    gridHtml = `<div class="calendar-grid week-view">
      ${cells.map((cell, i) => {
        const classes = [];
        if (isToday(cell.y, cell.m, cell.day)) classes.push('today');
        if (calendarSelectedDate === cell.dateStr) classes.push('selected');
        if (cell.count > 0) classes.push('has-items');
        return `<div class="calendar-day ${classes.join(' ')}" onclick="selectDate('${cell.dateStr}')" oncontextmenu="contextMenuHandler(event, '${cell.dateStr}')"><span class="date">${weekdayNames[i]} ${cell.day}</span>${cell.count > 0 ? `<span class="count">${cell.count}</span>` : ''}</div>`;
      }).join('')}
    </div>`;
  } else {
    const year = calendarYear;
    const month = calendarMonth;
    const firstDay = new Date(year, month, 1);
    let startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const count = countByDate[dateStr] || 0;
      cells.push({ year, month, day: d, dateStr, count });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    headerHtml = `<div class="calendar-header"><button class="cal-nav" onclick="prevMonth()">&lt;</button><b>${monthNames[month]} ${year}</b><button class="cal-nav" onclick="nextMonth()">&gt;</button><button class="cal-view" onclick="toggleCalendarView()">Неделя</button></div>`;
    gridHtml = `<div class="calendar-grid">
      ${weekdayNames.map(n => `<div class="calendar-day"><span class="date"><b>${n}</b></span></div>`).join('')}
      ${cells.map(cell => {
        if (!cell) return '<div class="calendar-day"></div>';
        const classes = [];
        if (isToday(cell.year, cell.month, cell.day)) classes.push('today');
        if (calendarSelectedDate === cell.dateStr) classes.push('selected');
        if (cell.count > 0) classes.push('has-items');
        return `<div class="calendar-day ${classes.join(' ')}" onclick="selectDate('${cell.dateStr}')" oncontextmenu="contextMenuHandler(event, '${cell.dateStr}')"><span class="date">${cell.day}</span>${cell.count > 0 ? `<span class="count">${cell.count}</span>` : ''}</div>`;
      }).join('')}
    </div>`;
  }
  const detail = dayDetailPanel();
  return `
    <div class="card">
      <h3 style="margin-top:0">Календарь</h3>
      <div class="calendar-container">
        ${headerHtml}
        ${gridHtml}
        ${detail}
      </div>
    </div>
  `;
}

function toggleNoteForm() {
  visibility.noteForm = !visibility.noteForm;
  renderApp();
}

function noteForm() {
  return `
    <div class="card" style="margin-top:16px;background:#F9F6F1;">
      <h3 style="margin-top:0">Новая заметка</h3>
      <label class="field"><span>Заголовок</span><input id="noteTitle" placeholder="Например: список для дома"></label>
      <label class="field"><span>Дата</span><input id="noteDate" type="date" value="${calendarSelectedDate || new Date().toISOString().slice(0,10)}"></label>
      <label class="field"><span>Текст</span><textarea id="noteText"></textarea></label>
      <button class="btn full" onclick="addNote()">Создать заметку</button>
    </div>
  `;
}

async function addNote() {
  const title = document.getElementById('noteTitle').value.trim();
  if (!title) {
    showToast('Заголовок обязателен', 'error');
    return;
  }
  try {
    await api(`/api/spaces/${activeSpaceId}/notes`, { method:'POST', body: JSON.stringify({ title, content: document.getElementById('noteText').value.trim(), note_date: document.getElementById('noteDate').value }) });
    await loadSpaceData();
    visibility.noteForm = false;
    showToast('Заметка создана', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function filesPage() {
  const files = normalizeItems().filter(i => i.kind === 'file');
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0">Файлы</h3>
        <button class="btn" onclick="toggleFileForm()">${visibility.fileForm ? 'Отмена' : 'Загрузить файл'}</button>
      </div>
      ${visibility.fileForm ? fileForm() : ''}
      <div class="list" style="margin-top:16px;">
        ${files.map(itemCard).join('') || `<div class="empty"><b>Файлов нет</b>Добавьте первый файл.</div>`}
      </div>
    </div>
  `;
}

function toggleFileForm() {
  visibility.fileForm = !visibility.fileForm;
  renderApp();
}

function prevMonth() {
  calendarMonth -= 1;
  if (calendarMonth < 0) {
    calendarMonth = 11;
    calendarYear -= 1;
  }
  calendarSelectedDate = '';
  renderApp();
}

function nextMonth() {
  calendarMonth += 1;
  if (calendarMonth > 11) {
    calendarMonth = 0;
    calendarYear += 1;
  }
  calendarSelectedDate = '';
  renderApp();
}

function prevWeek() {
  let date = calendarSelectedDate ? new Date(calendarSelectedDate + 'T00:00:00') : new Date();
  date.setDate(date.getDate() - 7);
  calendarSelectedDate = date.toISOString().slice(0,10);
  renderApp();
}

function nextWeek() {
  let date = calendarSelectedDate ? new Date(calendarSelectedDate + 'T00:00:00') : new Date();
  date.setDate(date.getDate() + 7);
  calendarSelectedDate = date.toISOString().slice(0,10);
  renderApp();
}

function toggleCalendarView() {
  if (calendarView === 'month') {
    calendarView = 'week';
    if (!calendarSelectedDate) {
      const today = new Date();
      calendarSelectedDate = today.toISOString().slice(0,10);
    }
  } else {
    calendarView = 'month';
  }
  renderApp();
}

function selectDate(dateStr) {
  calendarSelectedDate = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  calendarYear = d.getFullYear();
  calendarMonth = d.getMonth();
  renderApp();
}

// панель записей выбранного дня
function dayDetailPanel() {
  if (!calendarSelectedDate) return '';
  const items = normalizeItems().filter(i => i.date === calendarSelectedDate);
  const listHtml = items.map(itemCard).join('') || `<div class="empty"><b>Нет записей</b>Добавьте новую запись для этой даты.</div>`;
  const actions = `<div class="day-actions" style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
    <button class="btn small" onclick="createDayItem('task')">Задача</button>
    <button class="btn small" onclick="createDayItem('event')">Событие</button>
    <button class="btn small" onclick="createDayItem('note')">Заметка</button>
  </div>`;
  return `<div class="day-details"><h4>${fmtDate(calendarSelectedDate)}</h4>${actions}<div class="list">${listHtml}</div></div>`;
}

function createDayItem(kind) {
  if (!calendarSelectedDate) return;
  if (kind === 'note') {
    if (!visibility.noteForm) toggleNoteForm();
    setTimeout(() => {
      const input = document.getElementById('noteDate');
      if (input) input.value = calendarSelectedDate;
    });
  } else {
    if (!visibility.itemForm) toggleItemForm();
    setTimeout(() => {
      const typeSel = document.getElementById('itemType');
      const dateInput = document.getElementById('itemDate');
      if (typeSel) {
        typeSel.value = kind;
        togglePriorityField(kind);
      }
      if (dateInput) dateInput.value = calendarSelectedDate;
      const allDay = document.getElementById('itemAllDay');
      if (allDay) {
        allDay.checked = false;
        toggleTimeField(false);
      }
    });
  }
}

function fileForm() {
  return `
    <div class="card" style="margin-top:16px;background:#F9F6F1;">
      <h3 style="margin-top:0">Новый файл</h3>
      <label class="field"><span>Имя файла</span><input id="fileName" placeholder="Например: договор.pdf"></label>
      <label class="field"><span>Описание</span><textarea id="fileDesc"></textarea></label>
      <button class="btn full" onclick="addFile()">Добавить</button>
      <p style="color:var(--muted);font-size:13px;margin-top:8px;">В демонстрации сохраняется только имя и описание.</p>
    </div>
  `;
}

async function addFile() {
  const name = document.getElementById('fileName').value.trim();
  if (!name) {
    showToast('Имя файла обязательно', 'error');
    return;
  }
  try {
    await api(`/api/spaces/${activeSpaceId}/attachments`, { method:'POST', body: JSON.stringify({ file_name: name, description: document.getElementById('fileDesc').value.trim() }) });
    await loadSpaceData();
    visibility.fileForm = false;
    showToast('Файл добавлен', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// страница друзей и входящих запросов
function friendsPage() {
  let requestsHtml = '';
  if (friendRequests && friendRequests.length) {
    requestsHtml = `<div style="margin-top:16px;"><h4>Заявки в друзья</h4>
      <div class="list">
        ${friendRequests.map(req => `<div class="item-card"><b>${esc(req.sender_name || req.sender_login)}</b><small>логин: ${esc(req.sender_login)}</small>
          <button class="btn small" onclick="respondFriendRequest(${req.id}, 'accepted')">Принять</button>
          <button class="btn small danger" onclick="respondFriendRequest(${req.id}, 'declined')">Отклонить</button>
        </div>`).join('')}</div>
    </div>`;
  }
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0">Друзья</h3>
        <button class="btn" onclick="toggleFriendForm()">${visibility.friendForm ? 'Отмена' : 'Добавить друга'}</button>
      </div>
      ${visibility.friendForm ? friendForm() : ''}
      ${requestsHtml}
      <div class="list" style="margin-top:16px;">
        ${cache.friends.map(f => `<div class="item-card"><b>${esc(f.friend_name)}</b><small>логин: ${esc(f.friend_login)}</small></div>`).join('') || `<div class="empty"><b>Друзей нет</b>Добавьте пользователя.</div>`}
      </div>
    </div>
  `;
}

function toggleFriendForm() {
  visibility.friendForm = !visibility.friendForm;
  renderApp();
}

function friendForm() {
  return `
    <div class="card" style="margin-top:16px;background:#F9F6F1;">
      <h3 style="margin-top:0">Добавить друга</h3>
      <label class="field"><span>Логин пользователя</span><input id="friendLogin" placeholder="например: ivanov"></label>
      <button class="btn full" onclick="addFriend()">Добавить</button>
    </div>
  `;
}

async function addFriend() {
  const login = document.getElementById('friendLogin').value.trim();
  if (!login) {
    showToast('Логин обязателен', 'error');
    return;
  }
  try {
    await api('/api/friend-requests', { method:'POST', body: JSON.stringify({ login }) });
    await loadApp();
    visibility.friendForm = false;
    showToast('Запрос отправлен', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// управление личными и общими пространствами
function spacesPage() {
  const s = activeSpace();
  const isOwner = cache.members.some(m => m.user_id === currentUser.id && m.role === 'owner');
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0">Пространства</h3>
        <button class="btn" onclick="toggleSpaceForm()">${visibility.spaceForm ? 'Отмена' : 'Создать пространство'}</button>
      </div>
      ${visibility.spaceForm ? spaceForm() : ''}
      <div style="margin-top:24px;">
        <h3>Доступные пространства</h3>
        <table>
          <thead><tr><th>Название</th><th>Тип</th><th></th></tr></thead>
        <tbody>
            ${spaces.map(sp => {
              const canManage = sp.type === 'shared' && sp.owner_id === currentUser.id;
              return `<tr><td><b>${esc(sp.title)}</b><br><small>${esc(sp.description || '')}</small></td><td>${esc(sp.type)}</td><td>
                <button class="btn secondary" onclick="setSpace(${sp.id})">Открыть</button>
                ${canManage ? `<button class="btn small" title="Изменить" onclick="editSpace(${sp.id})">✎</button> <button class="btn small danger" title="Удалить" onclick="deleteSpace(${sp.id})">✕</button>` : ''}
              </td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:32px;">
        <h3>Участники текущего пространства</h3>
        <div class="list">
          ${cache.members.map(m => {
            const removable = m.role !== 'owner' && cache.members.some(mm => mm.user_id === currentUser.id && mm.role === 'owner');
            return `<div class="item-card"><b>${esc(m.login)}</b><small>роль: ${esc(m.role)}</small>${removable ? `<button class="btn small danger" style="margin-left:8px;" title="Удалить" onclick="removeMember(${m.user_id})">×</button>` : ''}</div>`;
          }).join('') || `<div class="empty"><b>Нет участников</b></div>`}
        </div>
        ${isOwner ? `<button class="btn" style="margin-top:12px;" onclick="toggleMemberForm()">${visibility.memberForm ? 'Отмена' : 'Добавить участника'}</button>` : ''}
        ${visibility.memberForm && isOwner ? memberForm() : ''}
      </div>
    </div>
  `;
}

function toggleSpaceForm() {
  visibility.spaceForm = !visibility.spaceForm;
  renderApp();
}

function spaceForm() {
  return `
    <div class="card" style="margin-top:16px;background:#F9F6F1;">
      <h3 style="margin-top:0">Новое пространство</h3>
      <label class="field"><span>Название</span><input id="spaceTitle" placeholder="Например: Семейные дела"></label>
      <label class="field"><span>Описание</span><textarea id="spaceDesc"></textarea></label>
      <button class="btn full" onclick="createSpace()">Создать</button>
    </div>
  `;
}

async function createSpace() {
  const title = document.getElementById('spaceTitle').value.trim();
  if (!title) {
    showToast('Название обязательно', 'error');
    return;
  }
  const description = document.getElementById('spaceDesc').value.trim();
  try {
    const sp = await api('/api/spaces', { method:'POST', body: JSON.stringify({ title, description }) });
    await loadApp();
    activeSpaceId = sp.id;
    localStorage.setItem('klevin_space_id', String(activeSpaceId));
    visibility.spaceForm = false;
    showToast('Пространство создано', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function toggleMemberForm() {
  visibility.memberForm = !visibility.memberForm;
  renderApp();
}

function memberForm() {
  return `
    <div class="card" style="margin-top:16px;background:#F9F6F1;">
      <h3 style="margin-top:0">Добавить участника</h3>
      <label class="field"><span>Логин пользователя</span><input id="memberLogin" placeholder="например: karina"></label>
      <label class="field"><span>Роль</span><select id="memberRole"><option value="viewer">наблюдатель</option><option value="editor">участник</option><option value="owner">владелец</option></select></label>
      <button class="btn full" onclick="addMember()">Добавить</button>
    </div>
  `;
}

async function addMember() {
  const login = document.getElementById('memberLogin').value.trim();
  if (!login) {
    showToast('Логин обязателен', 'error');
    return;
  }
  const role = document.getElementById('memberRole').value;
  try {
    await api(`/api/spaces/${activeSpaceId}/members`, { method:'POST', body: JSON.stringify({ login, role }) });
    await loadSpaceData();
    visibility.memberForm = false;
    showToast('Приглашение отправлено', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// страница профиля пользователя
function profilePage() {
  const invitesHtml = (invitations && invitations.length) ? `
    <div style="margin-top:24px;">
      <h4>Приглашения</h4>
      <div class="list">
        ${invitations.map(inv => {
          return `<div class="item-card">
            <div class="item-head" style="display:flex;justify-content:space-between;align-items:center;">
              <div><b>${esc(inv.space_title)}</b><small> от ${esc(inv.inviter)} · роль: ${esc(inv.role)}</small></div>
              <div>
                <button class="btn" onclick="respondInvite(${inv.id}, 'accepted')">Принять</button>
                <button class="btn danger" onclick="respondInvite(${inv.id}, 'declined')">Отклонить</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  ` : '';
  return `
    <div class="card">
      <h3>Профиль</h3>
      <div class="list" style="max-width:480px;">
        <label class="field"><span>Логин</span><input value="${esc(currentUser.login)}" disabled></label>
        <label class="field"><span>Имя</span><input id="profName" value="${esc(currentUser.name)}"></label>
        <label class="field"><span>Фамилия (необязательно)</span><input id="profSurname" value="${esc(currentUser.surname || '')}"></label>
        <label class="field"><span>Отчество (необязательно)</span><input id="profPatronymic" value="${esc(currentUser.patronymic || '')}"></label>
        <label class="field"><span>Email (необязательно)</span><input id="profEmail" value="${esc(currentUser.email || '')}" type="email"></label>
        <label class="field"><span>Телефон (необязательно)</span><input id="profPhone" value="${esc(currentUser.phone || '')}" type="tel" placeholder="+7 ___-___-__-__"></label>
        <label class="field"><span>О себе (необязательно)</span><textarea id="profAbout">${esc(currentUser.about || '')}</textarea></label>
        <button class="btn full" onclick="saveProfile()">Сохранить</button>
      </div>
      ${invitesHtml}
    </div>
  `;
}

async function saveProfile() {
  const data = {
    name: document.getElementById('profName').value.trim(),
    surname: document.getElementById('profSurname').value.trim(),
    patronymic: document.getElementById('profPatronymic').value.trim(),
    email: document.getElementById('profEmail').value.trim(),
    phone: document.getElementById('profPhone').value.trim(),
    about: document.getElementById('profAbout').value.trim()
  };
  try {
    const res = await api('/api/me', { method:'PUT', body: JSON.stringify(data) });
    currentUser = res.user;
    showToast('Профиль обновлён', 'success');
    await loadInvitations();
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editSpace(id) {
  const sp = spaces.find(s => s.id === id);
  if (!sp) return;
  const newTitle = prompt('Новое название пространства', sp.title);
  if (newTitle === null) return;
  const newDesc = prompt('Новое описание пространства', sp.description || '');
  if (newDesc === null) return;
  try {
    await api(`/api/spaces/${id}`, { method:'PATCH', body: JSON.stringify({ title: newTitle.trim(), description: newDesc.trim() }) });
    await loadApp();
    showToast('Пространство обновлено', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteSpace(id) {
  if (!confirm('Удалить пространство и все записи в нём?')) return;
  try {
    await api(`/api/spaces/${id}`, { method:'DELETE' });
    await loadApp();
    if (activeSpaceId === id && spaces.length) {
      activeSpaceId = spaces[0].id;
      localStorage.setItem('klevin_space_id', String(activeSpaceId));
    }
    showToast('Пространство удалено', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function removeMember(memberId) {
  if (!confirm('Удалить участника из пространства?')) return;
  try {
    await api(`/api/spaces/${activeSpaceId}/members/${memberId}`, { method:'DELETE' });
    await loadSpaceData();
    showToast('Участник удалён', 'success');
    renderApp();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

window.toggleComments = toggleComments;
window.toggleTaskStatus = toggleTaskStatus;
window.deleteItem = deleteItem;
window.addComment = addComment;
window.toggleItemForm = toggleItemForm;
window.toggleNoteForm = toggleNoteForm;
window.toggleFileForm = toggleFileForm;
window.toggleFriendForm = toggleFriendForm;
window.toggleSpaceForm = toggleSpaceForm;
window.toggleMemberForm = toggleMemberForm;
window.login = login;
window.register = register;
window.setAuthMode = setAuthMode;
window.setTab = setTab;
window.logout = logout;
window.setSpace = setSpace;
window.addItem = addItem;
window.addNote = addNote;
window.addFile = addFile;
window.addFriend = addFriend;
window.createSpace = createSpace;
window.addMember = addMember;
window.saveProfile = saveProfile;
window.respondInvite = respondInvite;
window.respondFriendRequest = respondFriendRequest;
window.toggleTimeField = toggleTimeField;
window.showToast = showToast;

window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.prevWeek = prevWeek;
window.nextWeek = nextWeek;
window.toggleCalendarView = toggleCalendarView;
window.selectDate = selectDate;
window.createDayItem = createDayItem;

window.contextMenuHandler = contextMenuHandler;
window.contextAction = contextAction;

window.editSpace = editSpace;
window.deleteSpace = deleteSpace;
window.removeMember = removeMember;

// начальная загрузка приложения
async function boot() {
  if (!token) {
    renderLogin();
    return;
  }
  try {
    await loadApp();
    renderApp();
  } catch (e) {
    console.warn('Token invalid, forcing logout');
    logout();
  }
}
boot();