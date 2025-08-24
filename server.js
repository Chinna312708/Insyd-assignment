import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 4000;
const DB_FILE = process.env.DB_FILE || './data.sqlite';

// init DB
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS follows(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      followed_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, followed_id)
    );
    CREATE TABLE IF NOT EXISTS posts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS likes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS comments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,        -- recipient
      actor_id INTEGER NOT NULL,       -- who did the action
      verb TEXT NOT NULL,              -- POSTED | LIKED | COMMENTED | DISCOVERED
      entity_type TEXT NOT NULL,       -- post | comment | like
      entity_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
  `);

  // seed three users
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO users(name) VALUES (?)');
    ['Alice','Bob','Cara'].forEach(n => ins.run(n));
  }
}
init();

// helpers
const insertNotification = db.prepare(`
  INSERT INTO notifications(user_id, actor_id, verb, entity_type, entity_id, message)
  VALUES (@user_id, @actor_id, @verb, @entity_type, @entity_id, @message)
`);

function notifyFollowersOnPost(post) {
  const followers = db.prepare('SELECT follower_id FROM follows WHERE followed_id = ?').all(post.user_id);
  const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(post.user_id);
  const msgBase = `${actor.name} posted: "${post.content.slice(0, 60)}"`;
  const insertMany = db.transaction((rows) => {
    rows.forEach(fid => insertNotification.run({
      user_id: fid.follower_id,
      actor_id: post.user_id,
      verb: 'POSTED',
      entity_type: 'post',
      entity_id: post.id,
      message: msgBase
    }));
  });
  insertMany(followers);
}

function notifyAuthorOnLike(userId, postId) {
  const post = db.prepare('SELECT p.id, p.user_id as author_id FROM posts p WHERE p.id = ?').get(postId);
  if (!post) return;
  if (post.author_id === userId) return; // no self notify
  const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  insertNotification.run({
    user_id: post.author_id,
    actor_id: userId,
    verb: 'LIKED',
    entity_type: 'post',
    entity_id: postId,
    message: `${actor.name} liked your post`
  });
}

function notifyAuthorOnComment(userId, postId, content) {
  const post = db.prepare('SELECT p.id, p.user_id as author_id FROM posts p WHERE p.id = ?').get(postId);
  if (!post) return;
  if (post.author_id === userId) return;
  const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  insertNotification.run({
    user_id: post.author_id,
    actor_id: userId,
    verb: 'COMMENTED',
    entity_type: 'comment',
    entity_id: postId,
    message: `${actor.name} commented: "${content.slice(0,60)}"`
  });
}

function notifyAuthorOnDiscovery(viewerId, postId) {
  const post = db.prepare('SELECT p.id, p.user_id as author_id FROM posts p WHERE p.id = ?').get(postId);
  if (!post) return;
  if (post.author_id === viewerId) return;
  const actor = db.prepare('SELECT name FROM users WHERE id = ?').get(viewerId);
  insertNotification.run({
    user_id: post.author_id,
    actor_id: viewerId,
    verb: 'DISCOVERED',
    entity_type: 'post',
    entity_id: postId,
    message: `${actor.name} discovered your post`
  });
}

// routes
app.get('/', (req, res) => res.json({ ok: true, service: 'insyd-backend' }));

app.get('/users', (req, res) => {
  const rows = db.prepare('SELECT * FROM users').all();
  res.json(rows);
});

app.post('/users', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO users(name) VALUES (?)').run(name);
  res.json({ id: info.lastInsertRowid, name });
});

app.post('/follow', (req, res) => {
  const { followerId, followedId } = req.body;
  if (!followerId || !followedId) return res.status(400).json({ error: 'followerId & followedId required' });
  try {
    db.prepare('INSERT INTO follows(follower_id, followed_id) VALUES (?, ?)').run(followerId, followedId);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'already following or invalid ids' });
  }
});

app.post('/posts', (req, res) => {
  const { userId, content } = req.body;
  if (!userId || !content) return res.status(400).json({ error: 'userId & content required' });
  const info = db.prepare('INSERT INTO posts(user_id, content) VALUES (?, ?)').run(userId, content);
  const post = { id: info.lastInsertRowid, user_id: userId, content };
  notifyFollowersOnPost(post);
  res.json(post);
});

app.post('/likes', (req, res) => {
  const { userId, postId } = req.body;
  if (!userId || !postId) return res.status(400).json({ error: 'userId & postId required' });
  try {
    db.prepare('INSERT INTO likes(user_id, post_id) VALUES (?, ?)').run(userId, postId);
    notifyAuthorOnLike(userId, postId);
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'already liked or invalid ids' });
  }
});

app.post('/comments', (req, res) => {
  const { userId, postId, content } = req.body;
  if (!userId || !postId || !content) return res.status(400).json({ error: 'userId, postId & content required' });
  const info = db.prepare('INSERT INTO comments(user_id, post_id, content) VALUES (?, ?, ?)').run(userId, postId, content);
  notifyAuthorOnComment(userId, postId, content);
  res.json({ id: info.lastInsertRowid });
});

app.post('/discover', (req, res) => {
  const { viewerId, postId } = req.body;
  if (!viewerId || !postId) return res.status(400).json({ error: 'viewerId & postId required' });
  notifyAuthorOnDiscovery(viewerId, postId);
  res.json({ ok: true });
});

app.get('/notifications', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const sinceId = Number(req.query.sinceId || 0);
  const rows = sinceId
    ? db.prepare('SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC').all(userId, sinceId)
    : db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(userId);
  res.json(rows);
});

app.post('/notifications/read', (req, res) => {
  const { userId, ids } = req.body;
  if (!userId || !Array.isArray(ids)) return res.status(400).json({ error: 'userId & ids[] required' });
  const mark = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
  const tx = db.transaction(() => {
    ids.forEach(id => mark.run(userId, id));
  });
  tx();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});