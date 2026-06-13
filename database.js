const path = require('path');
const Database = require('better-sqlite3');

// соединение с базой данных
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'database.sqlite');
const sqlite = new Database(DB_FILE);
sqlite.pragma('foreign_keys = ON');

// создание таблиц
function initSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      surname TEXT DEFAULT '',
      patronymic TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      about TEXT DEFAULT '',
      global_role TEXT DEFAULT 'user'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(email) WHERE email <> '';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
      ON users(phone) WHERE phone <> '';

    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'shared',
      owner_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS space_members (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      due_time TEXT DEFAULT '',
      task_type TEXT DEFAULT 'task',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'В работе',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      event_date TEXT DEFAULT '',
      event_time TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      note_date TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      uploaded_by INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      original_name TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      mime_type TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY,
      space_id INTEGER NOT NULL,
      inviter_id INTEGER NOT NULL,
      invitee_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
      FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invitee_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function rowValue(row, key, fallback = '') {
  return row[key] === undefined || row[key] === null ? fallback : row[key];
}

function selectAll(tableName) {
  return sqlite.prepare(`SELECT * FROM ${tableName} ORDER BY id`).all();
}

// чтение данных
function loadDb() {
  return {
    users: selectAll('users'),
    spaces: selectAll('spaces'),
    spaceMembers: selectAll('space_members'),
    tasks: selectAll('tasks'),
    events: selectAll('events'),
    notes: selectAll('notes'),
    attachments: selectAll('attachments'),
    comments: selectAll('comments'),
    friendships: selectAll('friendships'),
    invitations: selectAll('invitations'),
    friendRequests: selectAll('friend_requests')
  };
}

const insertUsers = sqlite.prepare(`
  INSERT INTO users (id, login, password, name, surname, patronymic, email, phone, about, global_role)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertSpaces = sqlite.prepare(`
  INSERT INTO spaces (id, title, description, type, owner_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertSpaceMembers = sqlite.prepare(`
  INSERT INTO space_members (id, space_id, user_id, role, joined_at)
  VALUES (?, ?, ?, ?, ?)
`);

const insertTasks = sqlite.prepare(`
  INSERT INTO tasks (id, space_id, created_by, title, description, due_date, due_time, task_type, priority, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertEvents = sqlite.prepare(`
  INSERT INTO events (id, space_id, created_by, title, description, event_date, event_time, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertNotes = sqlite.prepare(`
  INSERT INTO notes (id, space_id, created_by, title, content, note_date, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAttachments = sqlite.prepare(`
  INSERT INTO attachments (id, space_id, uploaded_by, file_name, description, original_name, file_path, mime_type, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertComments = sqlite.prepare(`
  INSERT INTO comments (id, space_id, target_type, target_id, user_id, text, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertFriendships = sqlite.prepare(`
  INSERT INTO friendships (id, user_id, friend_id)
  VALUES (?, ?, ?)
`);

const insertInvitations = sqlite.prepare(`
  INSERT INTO invitations (id, space_id, inviter_id, invitee_id, role, status)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertFriendRequests = sqlite.prepare(`
  INSERT INTO friend_requests (id, sender_id, recipient_id, status)
  VALUES (?, ?, ?, ?)
`);

// сохранение данных
const saveDb = sqlite.transaction((db) => {
  sqlite.prepare('DELETE FROM comments').run();
  sqlite.prepare('DELETE FROM attachments').run();
  sqlite.prepare('DELETE FROM notes').run();
  sqlite.prepare('DELETE FROM events').run();
  sqlite.prepare('DELETE FROM tasks').run();
  sqlite.prepare('DELETE FROM invitations').run();
  sqlite.prepare('DELETE FROM friend_requests').run();
  sqlite.prepare('DELETE FROM friendships').run();
  sqlite.prepare('DELETE FROM space_members').run();
  sqlite.prepare('DELETE FROM spaces').run();
  sqlite.prepare('DELETE FROM users').run();

  (db.users || []).forEach(user => insertUsers.run(
    user.id,
    user.login,
    user.password,
    rowValue(user, 'name', user.login),
    rowValue(user, 'surname'),
    rowValue(user, 'patronymic'),
    rowValue(user, 'email'),
    rowValue(user, 'phone'),
    rowValue(user, 'about'),
    rowValue(user, 'global_role', 'user')
  ));

  (db.spaces || []).forEach(space => insertSpaces.run(
    space.id,
    space.title,
    rowValue(space, 'description'),
    rowValue(space, 'type', 'shared'),
    space.owner_id,
    rowValue(space, 'created_at', new Date().toISOString()),
    rowValue(space, 'updated_at', new Date().toISOString())
  ));

  (db.spaceMembers || []).forEach(member => insertSpaceMembers.run(
    member.id,
    member.space_id,
    member.user_id,
    rowValue(member, 'role', 'viewer'),
    rowValue(member, 'joined_at', new Date().toISOString())
  ));

  (db.tasks || []).forEach(task => insertTasks.run(
    task.id,
    task.space_id,
    task.created_by,
    task.title,
    rowValue(task, 'description'),
    rowValue(task, 'due_date'),
    rowValue(task, 'due_time'),
    rowValue(task, 'task_type', 'task'),
    rowValue(task, 'priority', 'medium'),
    rowValue(task, 'status', 'В работе'),
    rowValue(task, 'created_at', new Date().toISOString()),
    rowValue(task, 'updated_at', rowValue(task, 'created_at', new Date().toISOString()))
  ));

  (db.events || []).forEach(event => insertEvents.run(
    event.id,
    event.space_id,
    event.created_by,
    event.title,
    rowValue(event, 'description'),
    rowValue(event, 'event_date'),
    rowValue(event, 'event_time'),
    rowValue(event, 'created_at', new Date().toISOString()),
    rowValue(event, 'updated_at', rowValue(event, 'created_at', new Date().toISOString()))
  ));

  (db.notes || []).forEach(note => insertNotes.run(
    note.id,
    note.space_id,
    note.created_by,
    note.title,
    rowValue(note, 'content'),
    rowValue(note, 'note_date'),
    rowValue(note, 'created_at', new Date().toISOString()),
    rowValue(note, 'updated_at', rowValue(note, 'created_at', new Date().toISOString()))
  ));

  (db.attachments || []).forEach(attachment => insertAttachments.run(
    attachment.id,
    attachment.space_id,
    attachment.uploaded_by,
    rowValue(attachment, 'file_name', rowValue(attachment, 'original_name')),
    rowValue(attachment, 'description'),
    rowValue(attachment, 'original_name', rowValue(attachment, 'file_name')),
    rowValue(attachment, 'file_path'),
    rowValue(attachment, 'mime_type'),
    rowValue(attachment, 'created_at', new Date().toISOString())
  ));

  (db.comments || []).forEach(comment => insertComments.run(
    comment.id,
    comment.space_id,
    comment.target_type,
    comment.target_id,
    rowValue(comment, 'user_id', rowValue(comment, 'author_id')),
    rowValue(comment, 'text', rowValue(comment, 'content')),
    rowValue(comment, 'created_at', new Date().toISOString())
  ));

  (db.friendships || []).forEach(friendship => insertFriendships.run(
    friendship.id,
    friendship.user_id,
    friendship.friend_id
  ));

  (db.invitations || []).forEach(invitation => insertInvitations.run(
    invitation.id,
    invitation.space_id,
    invitation.inviter_id,
    invitation.invitee_id,
    rowValue(invitation, 'role', 'viewer'),
    rowValue(invitation, 'status', 'pending')
  ));

  (db.friendRequests || []).forEach(request => insertFriendRequests.run(
    request.id,
    request.sender_id,
    request.recipient_id,
    rowValue(request, 'status', 'pending')
  ));
});

// начальные данные
function seedDb() {
  const count = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const defaultData = {
    users: [
      { id: 1, login: 'klevin', password: '123321', name: 'Klevin', surname: '', patronymic: '', email: 'klevin@example.local', phone: '', about: '', global_role: 'user' },
      { id: 2, login: 'karina', password: '123321', name: 'Karina', surname: '', patronymic: '', email: 'karina@example.local', phone: '', about: '', global_role: 'user' },
      { id: 3, login: 'admin', password: '123321', name: 'Administrator', surname: '', patronymic: '', email: 'admin@example.local', phone: '', about: '', global_role: 'admin' }
    ],
    spaces: [],
    spaceMembers: [],
    tasks: [],
    events: [],
    notes: [],
    attachments: [],
    comments: [],
    friendships: [],
    invitations: [],
    friendRequests: []
  };

  defaultData.users.forEach(user => {
    const spaceId = defaultData.spaces.length + 1;
    defaultData.spaces.push({ id: spaceId, title: 'Личное пространство', description: '', type: 'personal', owner_id: user.id });
    defaultData.spaceMembers.push({ id: defaultData.spaceMembers.length + 1, space_id: spaceId, user_id: user.id, role: 'owner' });
  });

  saveDb(defaultData);
}

initSchema();
seedDb();

module.exports = {
  loadDb,
  saveDb,
  DB_FILE
};
