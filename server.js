const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// ---- Middleware ----

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'troop731-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname
      .replace(ext, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 50);
    cb(null, `${Date.now()}-${safeName}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
    }
  },
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ============================================
//  PUBLIC API
// ============================================

app.get('/api/announcements', (req, res) => {
  res.json(DB.all('SELECT * FROM announcements ORDER BY created_at DESC'));
});

app.get('/api/events', (req, res) => {
  res.json(DB.all('SELECT * FROM events ORDER BY date ASC'));
});

app.get('/api/fb-groups', (req, res) => {
  res.json(DB.all('SELECT * FROM fb_groups ORDER BY sort_order ASC'));
});

app.get('/api/links', (req, res) => {
  res.json(DB.all('SELECT * FROM links ORDER BY sort_order ASC'));
});

app.get('/api/documents', (req, res) => {
  res.json(DB.all('SELECT * FROM documents ORDER BY sort_order ASC'));
});

app.get('/api/gallery', (req, res) => {
  res.json(DB.all('SELECT * FROM gallery ORDER BY sort_order ASC, created_at DESC'));
});

app.get('/api/settings', (req, res) => {
  const rows = DB.all('SELECT * FROM settings');
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required' });
  }
  DB.run('INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
    [name, email, subject || 'General', message]);
  res.json({ success: true });
});

// ============================================
//  AUTH API
// ============================================

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = DB.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, displayName: user.display_name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.userId) {
    const user = DB.get('SELECT username, display_name, role FROM users WHERE id = ?', [req.session.userId]);
    return res.json({ authenticated: true, user });
  }
  res.json({ authenticated: false });
});

// ============================================
//  ADMIN API
// ============================================

// Announcements
app.post('/api/admin/announcements', requireAuth, (req, res) => {
  const { title, content, priority, category } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const result = DB.run(
    'INSERT INTO announcements (title, content, priority, category) VALUES (?, ?, ?, ?)',
    [title, content, priority || 'normal', category || 'info']);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/admin/announcements/:id', requireAuth, (req, res) => {
  const { title, content, priority, category } = req.body;
  DB.run('UPDATE announcements SET title=?, content=?, priority=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [title, content, priority, category, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/announcements/:id', requireAuth, (req, res) => {
  DB.run('DELETE FROM announcements WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Events
app.post('/api/admin/events', requireAuth, (req, res) => {
  const { title, date, end_date, time, type, location, description } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
  const result = DB.run(
    'INSERT INTO events (title, date, end_date, time, type, location, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title, date, end_date || null, time, type || 'meeting', location, description]);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/admin/events/:id', requireAuth, (req, res) => {
  const { title, date, end_date, time, type, location, description } = req.body;
  DB.run('UPDATE events SET title=?, date=?, end_date=?, time=?, type=?, location=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [title, date, end_date || null, time, type, location, description, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/events/:id', requireAuth, (req, res) => {
  DB.run('DELETE FROM events WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Facebook Groups
app.post('/api/admin/fb-groups', requireAuth, (req, res) => {
  const { name, url, description } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM fb_groups') || {}).m || 0;
  const result = DB.run('INSERT INTO fb_groups (name, url, description, sort_order) VALUES (?, ?, ?, ?)',
    [name, url, description, maxOrder + 1]);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/fb-groups/:id', requireAuth, (req, res) => {
  DB.run('DELETE FROM fb_groups WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Links
app.post('/api/admin/links', requireAuth, (req, res) => {
  const { name, url, icon } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM links') || {}).m || 0;
  const result = DB.run('INSERT INTO links (name, url, icon, sort_order) VALUES (?, ?, ?, ?)',
    [name, url, icon || '🔗', maxOrder + 1]);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/links/:id', requireAuth, (req, res) => {
  DB.run('DELETE FROM links WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Documents
app.post('/api/admin/documents', requireAuth, (req, res) => {
  const { name, url, icon } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM documents') || {}).m || 0;
  const result = DB.run('INSERT INTO documents (name, url, icon, sort_order) VALUES (?, ?, ?, ?)',
    [name, url, icon || '📄', maxOrder + 1]);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/documents/:id', requireAuth, (req, res) => {
  DB.run('DELETE FROM documents WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Gallery (with file upload)
app.post('/api/admin/gallery', requireAuth, upload.single('photo'), (req, res) => {
  const caption = req.body.caption || '';
  let filename = null;
  let url = null;

  if (req.file) {
    filename = req.file.filename;
    url = `/uploads/${req.file.filename}`;
  } else if (req.body.url) {
    url = req.body.url;
  }

  const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM gallery') || {}).m || 0;
  const result = DB.run('INSERT INTO gallery (caption, filename, url, sort_order) VALUES (?, ?, ?, ?)',
    [caption, filename, url, maxOrder + 1]);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/gallery/:id', requireAuth, (req, res) => {
  const photo = DB.get('SELECT * FROM gallery WHERE id=?', [req.params.id]);
  if (photo && photo.filename) {
    const filePath = path.join(UPLOADS_DIR, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  DB.run('DELETE FROM gallery WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Messages
app.get('/api/admin/messages', requireAuth, (req, res) => {
  res.json(DB.all('SELECT * FROM messages ORDER BY created_at DESC'));
});

app.put('/api/admin/messages/:id/read', requireAuth, (req, res) => {
  DB.run('UPDATE messages SET is_read=1 WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/messages/:id', requireAuth, (req, res) => {
  DB.run('DELETE FROM messages WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Settings
app.put('/api/admin/settings', requireAuth, (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    DB.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]);
  }
  res.json({ success: true });
});

// Change password
app.put('/api/admin/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = DB.get('SELECT * FROM users WHERE id=?', [req.session.userId]);
  const match = await bcrypt.compare(current_password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 10);
  DB.run('UPDATE users SET password_hash=? WHERE id=?', [hash, user.id]);
  res.json({ success: true });
});

// SPA fallback
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---- Start (async for DB init) ----

async function start() {
  await DB.init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Troop 731 website running on http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
