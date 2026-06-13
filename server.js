const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { loadDb, saveDb } = require('./database');

// приведение телефона к единому формату
function normalizePhone(phone) {
  if (!phone) return '';
  const trimmed = String(phone).trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  let num = digits;
  if (num.length >= 10 && num[0] === '8') {
    num = num.slice(1);
  }
  if (num.length === 10) {
    num = '7' + num;
  }
  if (num.length === 11 && num[0] !== '7') {
    num = '7' + num.slice(1);
  }
  const groups = [num.slice(1,4), num.slice(4,7), num.slice(7,9), num.slice(9,11)].filter(Boolean);
  return '+7 ' + groups.join('-');
}

// получение нового id для массива
function nextId(collection) {
  let max = 0;
  collection.forEach(item => {
    if (item.id > max) max = item.id;
  });
  return max + 1;
}

// простой токен по id пользователя
function createToken(user) {
  return String(user.id);
}
function parseToken(token) {
  const id = Number(token);
  return isNaN(id) ? null : id;
}

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// проверка авторизации перед api-запросом
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const db = loadDb();
  const userId = parseToken(token);
  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'Неверный токен' });
  }
  req.currentUser = user;
  req.db = db;
  next();
}

// регистрация пользователя
app.post('/api/auth/register', (req, res) => {
  const db = loadDb();
  let { login, password, name, surname = '', patronymic = '', email = '', phone = '', about = '' } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }
  if (!/^[a-zA-Z]{5,}$/.test(login)) {
    return res.status(400).json({ error: 'Логин должен содержать не менее 5 английских букв' });
  }
  if (db.users.some(u => u.login === login)) {
    return res.status(400).json({ error: 'Логин уже используется' });
  }
  if (email && db.users.some(u => u.email === email)) {
    return res.status(400).json({ error: 'Email уже используется' });
  }
  const normalisedPhone = normalizePhone(phone);
  if (normalisedPhone && db.users.some(u => u.phone === normalisedPhone)) {
    return res.status(400).json({ error: 'Телефон уже используется' });
  }
  const userId = nextId(db.users);
  const newUser = {
    id: userId,
    login,
    password,
    name: name || login,
    surname,
    patronymic,
    email,
    phone: normalisedPhone,
    about,
    global_role: 'user'
  };
  db.users.push(newUser);
  const spaceId = nextId(db.spaces);
  db.spaces.push({
    id: spaceId,
    title: 'Личное пространство',
    description: '',
    type: 'personal',
    owner_id: userId
  });
  db.spaceMembers.push({ id: nextId(db.spaceMembers), space_id: spaceId, user_id: userId, role: 'owner' });
  saveDb(db);
  res.json({ token: createToken(newUser), user: newUser });
});

// вход пользователя
app.post('/api/auth/login', (req, res) => {
  const db = loadDb();
  const { login, password } = req.body;
  const user = db.users.find(u => u.login === login && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  res.json({ token: createToken(user), user });
});

// профиль текущего пользователя
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.currentUser });
});

app.put('/api/me', authMiddleware, (req, res) => {
  const db = req.db;
  let { name, surname, patronymic, email, phone, about } = req.body;
  if (email && db.users.some(u => u.email === email && u.id !== req.currentUser.id)) {
    return res.status(400).json({ error: 'Email уже используется' });
  }
  const normalisedPhone = phone ? normalizePhone(phone) : '';
  if (normalisedPhone && db.users.some(u => u.phone === normalisedPhone && u.id !== req.currentUser.id)) {
    return res.status(400).json({ error: 'Телефон уже используется' });
  }
  const userIndex = db.users.findIndex(u => u.id === req.currentUser.id);
  const updatedUser = { ...db.users[userIndex] };
  if (name !== undefined) updatedUser.name = name;
  if (surname !== undefined) updatedUser.surname = surname;
  if (patronymic !== undefined) updatedUser.patronymic = patronymic;
  if (email !== undefined) updatedUser.email = email;
  if (phone !== undefined) updatedUser.phone = normalisedPhone;
  if (about !== undefined) updatedUser.about = about;
  db.users[userIndex] = updatedUser;
  saveDb(db);
  res.json({ user: updatedUser });
});

// список доступных пространств
app.get('/api/spaces', authMiddleware, (req, res) => {
  const db = req.db;
  const memberships = db.spaceMembers.filter(m => m.user_id === req.currentUser.id);
  const userSpaces = memberships.map(m => db.spaces.find(s => s.id === m.space_id)).filter(Boolean);
  res.json(userSpaces);
});

// создание общего пространства
app.post('/api/spaces', authMiddleware, (req, res) => {
  const db = req.db;
  const { title, description = '' } = req.body;
  if (!title) return res.status(400).json({ error: 'Название обязательно' });
  const spaceId = nextId(db.spaces);
  const newSpace = { id: spaceId, title, description, type: 'shared', owner_id: req.currentUser.id };
  db.spaces.push(newSpace);
  db.spaceMembers.push({ id: nextId(db.spaceMembers), space_id: spaceId, user_id: req.currentUser.id, role: 'owner' });
  saveDb(db);
  res.json(newSpace);
});

// изменение общего пространства
app.patch('/api/spaces/:spaceId', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  const { title, description } = req.body;
  const space = db.spaces.find(s => s.id === spaceId);
  if (!space) return res.status(404).json({ error: 'Пространство не найдено' });
  if (space.type === 'personal') {
    return res.status(400).json({ error: 'Личное пространство нельзя изменить' });
  }
  if (space.owner_id !== req.currentUser.id) {
    return res.status(403).json({ error: 'Только владелец может изменять пространство' });
  }
  if (title) space.title = title;
  if (description !== undefined) space.description = description;
  saveDb(db);
  res.json(space);
});

// удаление общего пространства
app.delete('/api/spaces/:spaceId', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  const spaceIndex = db.spaces.findIndex(s => s.id === spaceId);
  if (spaceIndex === -1) return res.status(404).json({ error: 'Пространство не найдено' });
  const space = db.spaces[spaceIndex];
  if (space.type === 'personal') {
    return res.status(400).json({ error: 'Личное пространство нельзя удалить' });
  }
  if (space.owner_id !== req.currentUser.id) {
    return res.status(403).json({ error: 'Только владелец может удалить пространство' });
  }
  db.spaces.splice(spaceIndex, 1);
  db.spaceMembers = db.spaceMembers.filter(m => m.space_id !== spaceId);
  db.tasks = db.tasks.filter(t => t.space_id !== spaceId);
  db.events = db.events.filter(e => e.space_id !== spaceId);
  db.notes = db.notes.filter(n => n.space_id !== spaceId);
  db.attachments = db.attachments.filter(a => a.space_id !== spaceId);
  db.comments = db.comments.filter(c => c.space_id !== spaceId);
  db.invitations = db.invitations.filter(inv => inv.space_id !== spaceId);
  saveDb(db);
  res.json({ success: true });
});

// удаление участника из пространства
app.delete('/api/spaces/:spaceId/members/:memberId', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  const memberId = Number(req.params.memberId);
  const space = db.spaces.find(s => s.id === spaceId);
  if (!space) return res.status(404).json({ error: 'Пространство не найдено' });
  if (space.type === 'personal') {
    return res.status(400).json({ error: 'Из личного пространства нельзя удалить участников' });
  }
  if (space.owner_id !== req.currentUser.id) {
    return res.status(403).json({ error: 'Только владелец может удалять участников' });
  }
  const membershipIndex = db.spaceMembers.findIndex(m => m.space_id === spaceId && m.user_id === memberId);
  if (membershipIndex === -1) return res.status(404).json({ error: 'Участник не найден' });
  if (db.spaceMembers[membershipIndex].role === 'owner') {
    return res.status(400).json({ error: 'Нельзя удалить владельца пространства' });
  }
  db.spaceMembers.splice(membershipIndex, 1);
  saveDb(db);
  res.json({ success: true });
});

// работа с задачами
app.get('/api/spaces/:spaceId/tasks', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) {
    return res.status(403).json({ error: 'Нет доступа к пространству' });
  }
  const tasks = db.tasks.filter(t => t.space_id === spaceId);
  const enriched = tasks.map(t => {
    const comments = db.comments.filter(c => c.target_type === 'task' && c.target_id === t.id && c.space_id === spaceId).map(c => {
      const u = db.users.find(u => u.id === c.user_id);
      return { ...c, user_name: u ? u.name : 'Пользователь' };
    });
    return { ...t, comments };
  });
  res.json(enriched);
});

app.post('/api/spaces/:spaceId/tasks', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) {
    return res.status(403).json({ error: 'Нет доступа к пространству' });
  }
  const { title, description = '', due_date = '', due_time = '', task_type = 'task', priority = 'medium' } = req.body;
  if (!title) return res.status(400).json({ error: 'Название обязательно' });
  const id = nextId(db.tasks);
  const newTask = {
    id,
    space_id: spaceId,
    created_by: req.currentUser.id,
    title,
    description,
    due_date,
    due_time,
    task_type,
    priority,
    status: 'В работе',
    created_at: new Date().toISOString()
  };
  db.tasks.push(newTask);
  saveDb(db);
  res.json(newTask);
});

app.patch('/api/tasks/:taskId', authMiddleware, (req, res) => {
  const db = req.db;
  const taskId = Number(req.params.taskId);
  const taskIndex = db.tasks.findIndex(t => t.id === taskId);
  if (taskIndex < 0) return res.status(404).json({ error: 'Задача не найдена' });
  const task = db.tasks[taskIndex];
  if (!db.spaceMembers.some(m => m.space_id === task.space_id && m.user_id === req.currentUser.id)) {
    return res.status(403).json({ error: 'Нет доступа к пространству' });
  }
  const fields = ['status', 'title', 'description', 'priority', 'due_date', 'due_time'];
  fields.forEach(f => {
    if (req.body[f] !== undefined) task[f] = req.body[f];
  });
  db.tasks[taskIndex] = task;
  saveDb(db);
  res.json(task);
});

app.delete('/api/tasks/:taskId', authMiddleware, (req, res) => {
  const db = req.db;
  const taskId = Number(req.params.taskId);
  const idx = db.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return res.status(404).json({ error: 'Задача не найдена' });
  const task = db.tasks[idx];
  if (!db.spaceMembers.some(m => m.space_id === task.space_id && m.user_id === req.currentUser.id)) {
    return res.status(403).json({ error: 'Нет доступа к пространству' });
  }
  db.tasks.splice(idx, 1);
  db.comments = db.comments.filter(c => !(c.target_type === 'task' && c.target_id === taskId && c.space_id === task.space_id));
  saveDb(db);
  res.json({ success: true });
});

// работа с событиями
app.get('/api/spaces/:spaceId/events', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const events = db.events.filter(e => e.space_id === spaceId);
  const enriched = events.map(e => {
    const comments = db.comments.filter(c => c.target_type === 'event' && c.target_id === e.id && c.space_id === spaceId).map(c => {
      const u = db.users.find(u => u.id === c.user_id);
      return { ...c, user_name: u ? u.name : 'Пользователь' };
    });
    return { ...e, comments };
  });
  res.json(enriched);
});
app.post('/api/spaces/:spaceId/events', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const { title, description = '', event_date = '', event_time = '' } = req.body;
  if (!title) return res.status(400).json({ error: 'Название обязательно' });
  const id = nextId(db.events);
  const newEvent = {
    id,
    space_id: spaceId,
    created_by: req.currentUser.id,
    title,
    description,
    event_date,
    event_time,
    created_at: new Date().toISOString()
  };
  db.events.push(newEvent);
  saveDb(db);
  res.json(newEvent);
});
app.delete('/api/events/:id', authMiddleware, (req, res) => {
  const db = req.db;
  const id = Number(req.params.id);
  const idx = db.events.findIndex(e => e.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Событие не найдено' });
  const ev = db.events[idx];
  if (!db.spaceMembers.some(m => m.space_id === ev.space_id && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  db.events.splice(idx, 1);
  db.comments = db.comments.filter(c => !(c.target_type === 'event' && c.target_id === id && c.space_id === ev.space_id));
  saveDb(db);
  res.json({ success: true });
});

// работа с заметками
app.get('/api/spaces/:spaceId/notes', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const notes = db.notes.filter(n => n.space_id === spaceId);
  const enriched = notes.map(n => {
    const comments = db.comments.filter(c => c.target_type === 'note' && c.target_id === n.id && c.space_id === spaceId).map(c => {
      const u = db.users.find(u => u.id === c.user_id);
      return { ...c, user_name: u ? u.name : 'Пользователь' };
    });
    return { ...n, comments };
  });
  res.json(enriched);
});
app.post('/api/spaces/:spaceId/notes', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const { title, content = '', note_date = '' } = req.body;
  if (!title) return res.status(400).json({ error: 'Заголовок обязателен' });
  const id = nextId(db.notes);
  const newNote = {
    id,
    space_id: spaceId,
    created_by: req.currentUser.id,
    title,
    content,
    note_date,
    created_at: new Date().toISOString()
  };
  db.notes.push(newNote);
  saveDb(db);
  res.json(newNote);
});
app.delete('/api/notes/:id', authMiddleware, (req, res) => {
  const db = req.db;
  const id = Number(req.params.id);
  const idx = db.notes.findIndex(n => n.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Заметка не найдена' });
  const note = db.notes[idx];
  if (!db.spaceMembers.some(m => m.space_id === note.space_id && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  db.notes.splice(idx, 1);
  db.comments = db.comments.filter(c => !(c.target_type === 'note' && c.target_id === id && c.space_id === note.space_id));
  saveDb(db);
  res.json({ success: true });
});

// работа с файлами
app.get('/api/spaces/:spaceId/attachments', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const attachments = db.attachments.filter(a => a.space_id === spaceId);
  const enriched = attachments.map(a => {
    const comments = db.comments.filter(c => c.target_type === 'file' && c.target_id === a.id && c.space_id === spaceId).map(c => {
      const u = db.users.find(u => u.id === c.user_id);
      return { ...c, user_name: u ? u.name : 'Пользователь' };
    });
    return { ...a, comments };
  });
  res.json(enriched);
});
app.post('/api/spaces/:spaceId/attachments', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const { file_name, description = '' } = req.body;
  if (!file_name) return res.status(400).json({ error: 'Имя файла обязательно' });
  const id = nextId(db.attachments);
  const att = {
    id,
    space_id: spaceId,
    uploaded_by: req.currentUser.id,
    file_name,
    description,
    created_at: new Date().toISOString()
  };
  db.attachments.push(att);
  saveDb(db);
  res.json(att);
});
app.delete('/api/attachments/:id', authMiddleware, (req, res) => {
  const db = req.db;
  const id = Number(req.params.id);
  const idx = db.attachments.findIndex(a => a.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Файл не найден' });
  const att = db.attachments[idx];
  if (!db.spaceMembers.some(m => m.space_id === att.space_id && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  db.attachments.splice(idx, 1);
  db.comments = db.comments.filter(c => !(c.target_type === 'file' && c.target_id === id && c.space_id === att.space_id));
  saveDb(db);
  res.json({ success: true });
});

// добавление комментария
app.post('/api/comments', authMiddleware, (req, res) => {
  const db = req.db;
  const { space_id, target_type, target_id, text } = req.body;
  if (!space_id || !target_type || !target_id || !text) return res.status(400).json({ error: 'Некорректные данные' });
  if (!db.spaceMembers.some(m => m.space_id === space_id && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const id = nextId(db.comments);
  const comment = { id, space_id, target_type, target_id, user_id: req.currentUser.id, text, created_at: new Date().toISOString() };
  db.comments.push(comment);
  saveDb(db);
  res.json(comment);
});

// работа с приглашениями в пространства
app.get('/api/invitations', authMiddleware, (req, res) => {
  const db = req.db;
  const userId = req.currentUser.id;
  const invites = db.invitations.filter(inv => inv.invitee_id === userId && inv.status === 'pending').map(inv => {
    const space = db.spaces.find(s => s.id === inv.space_id);
    const inviter = db.users.find(u => u.id === inv.inviter_id);
    return {
      id: inv.id,
      space_id: inv.space_id,
      space_title: space ? space.title : '—',
      inviter: inviter ? inviter.login : '—',
      role: inv.role,
      status: inv.status
    };
  });
  res.json(invites);
});

app.patch('/api/invitations/:invId', authMiddleware, (req, res) => {
  const db = req.db;
  const invId = Number(req.params.invId);
  const { status } = req.body;
  if (!status || !['accepted','declined'].includes(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }
  const invIndex = db.invitations.findIndex(i => i.id === invId);
  if (invIndex < 0) return res.status(404).json({ error: 'Приглашение не найдено' });
  const inv = db.invitations[invIndex];
  if (inv.invitee_id !== req.currentUser.id) {
    return res.status(403).json({ error: 'Нет доступа к приглашению' });
  }
  if (inv.status !== 'pending') {
    return res.status(400).json({ error: 'Приглашение уже обработано' });
  }
  inv.status = status;
  db.invitations[invIndex] = inv;
  if (status === 'accepted') {
    if (!db.spaceMembers.some(m => m.space_id === inv.space_id && m.user_id === inv.invitee_id)) {
      db.spaceMembers.push({ id: nextId(db.spaceMembers), space_id: inv.space_id, user_id: inv.invitee_id, role: inv.role });
    }
  }
  saveDb(db);
  res.json({ success: true });
});

// участники пространства
app.get('/api/spaces/:spaceId/members', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id)) return res.status(403).json({ error: 'Нет доступа к пространству' });
  const members = db.spaceMembers.filter(m => m.space_id === spaceId).map(m => {
    const u = db.users.find(u => u.id === m.user_id);
    return { id: m.id, user_id: m.user_id, login: u ? u.login : '', name: u ? u.name : '', role: m.role };
  });
  res.json(members);
});

app.post('/api/spaces/:spaceId/members', authMiddleware, (req, res) => {
  const db = req.db;
  const spaceId = Number(req.params.spaceId);
  const { login, role = 'viewer' } = req.body;
  if (!login) return res.status(400).json({ error: 'Логин обязателен' });
  const space = db.spaces.find(s => s.id === spaceId);
  if (!space) return res.status(404).json({ error: 'Пространство не найдено' });
  if (!db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === req.currentUser.id && m.role === 'owner')) {
    return res.status(403).json({ error: 'Только владелец пространства может приглашать участников' });
  }
  const user = db.users.find(u => u.login === login);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
  if (db.spaceMembers.some(m => m.space_id === spaceId && m.user_id === user.id)) {
    return res.status(400).json({ error: 'Пользователь уже состоит в пространстве' });
  }
  const inv = {
    id: nextId(db.invitations),
    space_id: spaceId,
    inviter_id: req.currentUser.id,
    invitee_id: user.id,
    role,
    status: 'pending'
  };
  db.invitations.push(inv);
  saveDb(db);
  res.json({ id: inv.id, pending: true });
});

// друзья пользователя
app.get('/api/friends', authMiddleware, (req, res) => {
  const db = req.db;
  const userId = req.currentUser.id;
  const friends = db.friendships.filter(f => f.user_id === userId).map(f => {
    const friend = db.users.find(u => u.id === f.friend_id);
    return { friend_id: friend.id, friend_login: friend.login, friend_name: friend.name };
  });
  res.json(friends);
});

app.post('/api/friends', authMiddleware, (req, res) => {
  res.status(400).json({ error: 'Добавление друзей выполняется через запрос подтверждения' });
});

// запросы в друзья
app.get('/api/friend-requests', authMiddleware, (req, res) => {
  const db = req.db;
  const userId = req.currentUser.id;
  const requests = db.friendRequests
    .filter(fr => fr.recipient_id === userId && fr.status === 'pending')
    .map(fr => {
      const sender = db.users.find(u => u.id === fr.sender_id);
      return {
        id: fr.id,
        sender_id: sender.id,
        sender_login: sender.login,
        sender_name: sender.name
      };
    });
  res.json(requests);
});

app.post('/api/friend-requests', authMiddleware, (req, res) => {
  const db = req.db;
  const { login } = req.body;
  if (!login) {
    return res.status(400).json({ error: 'Логин обязателен' });
  }
  const target = db.users.find(u => u.login === login);
  if (!target) {
    return res.status(400).json({ error: 'Пользователь не найден' });
  }
  if (target.id === req.currentUser.id) {
    return res.status(400).json({ error: 'Нельзя добавить себя' });
  }
  if (db.friendships.some(f => f.user_id === req.currentUser.id && f.friend_id === target.id)) {
    return res.status(400).json({ error: 'Пользователь уже в друзьях' });
  }
  if (db.friendRequests.some(fr => fr.sender_id === req.currentUser.id && fr.recipient_id === target.id && fr.status === 'pending')) {
    return res.status(400).json({ error: 'Запрос уже отправлен' });
  }
  const reciprocal = db.friendRequests.find(fr => fr.sender_id === target.id && fr.recipient_id === req.currentUser.id && fr.status === 'pending');
  if (reciprocal) {
    reciprocal.status = 'accepted';
    const rel1 = { id: nextId(db.friendships), user_id: req.currentUser.id, friend_id: target.id };
    const rel2 = { id: nextId(db.friendships) + 1, user_id: target.id, friend_id: req.currentUser.id };
    db.friendships.push(rel1);
    db.friendships.push(rel2);
    saveDb(db);
    return res.json({ id: reciprocal.id, accepted: true });
  }
  const fr = {
    id: nextId(db.friendRequests),
    sender_id: req.currentUser.id,
    recipient_id: target.id,
    status: 'pending'
  };
  db.friendRequests.push(fr);
  saveDb(db);
  res.json(fr);
});

app.patch('/api/friend-requests/:id', authMiddleware, (req, res) => {
  const db = req.db;
  const frId = Number(req.params.id);
  const { status } = req.body || {};
  const fr = db.friendRequests.find(fr => fr.id === frId);
  if (!fr) {
    return res.status(404).json({ error: 'Запрос не найден' });
  }
  if (fr.recipient_id !== req.currentUser.id) {
    return res.status(403).json({ error: 'Нельзя отвечать на этот запрос' });
  }
  if (fr.status !== 'pending') {
    return res.status(400).json({ error: 'Запрос уже обработан' });
  }
  if (status !== 'accepted' && status !== 'declined') {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  fr.status = status;
  if (status === 'accepted') {
    const rel1 = { id: nextId(db.friendships), user_id: fr.sender_id, friend_id: fr.recipient_id };
    const rel2 = { id: nextId(db.friendships) + 1, user_id: fr.recipient_id, friend_id: fr.sender_id };
    db.friendships.push(rel1);
    db.friendships.push(rel2);
  }
  saveDb(db);
  res.json(fr);
});

// поиск пользователей по логину
app.get('/api/users/search', authMiddleware, (req, res) => {
  const db = req.db;
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const results = db.users.filter(u => u.login.toLowerCase().includes(q) && u.id !== req.currentUser.id).slice(0, 10).map(u => ({ login: u.login, name: u.name, id: u.id }));
  res.json(results);
});

// ответ для неизвестных api-маршрутов
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
// запуск сервера
app.listen(PORT, () => {
  console.log(`KlevinPlan server running on port ${PORT}`);
});