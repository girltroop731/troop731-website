const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

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
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
    }
  },
});

// ---- Auth middleware ----

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// ============================================
//  PUBLIC API — no auth required
// ============================================

// Announcements
app.get('/api/announcements', (req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.json(rows);
});

// Events
app.get('/api/events', (req, res) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY date ASC').all();
  res.json(rows);
});

// Facebook groups
app.get('/api/fb-groups', (req, res) => {
  const rows = db.prepare('SELECT * FROM fb_groups ORDER BY sort_order ASC').all();
  res.json(rows);
});

// Links
app.get('/api/links', (req, res) => {
  const rows = db.prepare('SELECT * FROM links ORDER BY sort_order ASC').all();
  res.json(rows);
});

// Documents
app.get('/api/documents', (req, res) => {
  const rows = db.prepare('SELECT * FROM documents ORDER BY sort_order ASC').all();
  res.json(rows);
});

// Gallery
app.get('/api/gallery', (req, res) => {
  const rows = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, created_at DESC').all();
  res.json(rows);
});

// Settings (public subset)
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

// Contact form submission
app.post('/api/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required' });
  }
  db.prepare('INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .run(name, email, subject || 'General', message);
  res.json({ success: true });
});

// ============================================
//  AUTH API
// ============================================

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
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
    const user = db.prepare('SELECT username, display_name, role FROM users WHERE id = ?').get(req.session.userId);
    return res.json({ authenticated: true, user });
  }
  res.json({ authenticated: false });
});

// ============================================
//  ADMIN API — auth required
// ============================================

// ---- Announcements CRUD ----

app.post('/api/admin/announcements', requireAuth, (req, res) => {
  const { title, content, priority, category } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const result = db.prepare(
    'INSERT INTO announcements (title, content, priority, category) VALUES (?, ?, ?, ?)'
  ).run(title, content, priority || 'normal', category || 'info');
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/admin/announcements/:id', requireAuth, (req, res) => {
  const { title, content, priority, category } = req.body;
  db.prepare(
    'UPDATE announcements SET title=?, content=?, priority=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(title, content, priority, category, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/announcements/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Events CRUD ----

app.post('/api/admin/events', requireAuth, (req, res) => {
  const { title, date, end_date, time, type, location, description } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
  const result = db.prepare(
    'INSERT INTO events (title, date, end_date, time, type, location, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(title, date, end_date || null, time, type || 'meeting', location, description);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/admin/events/:id', requireAuth, (req, res) => {
  const { title, date, end_date, time, type, location, description } = req.body;
  db.prepare(
    'UPDATE events SET title=?, date=?, end_date=?, time=?, type=?, location=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(title, date, end_date || null, time, type, location, description, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/events/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Facebook Groups CRUD ----

app.post('/api/admin/fb-groups', requireAuth, (req, res) => {
  const { name, url, description } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM fb_groups').get().m || 0;
  const result = db.prepare(
    'INSERT INTO fb_groups (name, url, description, sort_order) VALUES (?, ?, ?, ?)'
  ).run(name, url, description, maxOrder + 1);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/fb-groups/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM fb_groups WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Links CRUD ----

app.post('/api/admin/links', requireAuth, (req, res) => {
  const { name, url, icon } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM links').get().m || 0;
  const result = db.prepare(
    'INSERT INTO links (name, url, icon, sort_order) VALUES (?, ?, ?, ?)'
  ).run(name, url, icon || '🔗', maxOrder + 1);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/links/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM links WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Documents CRUD ----

app.post('/api/admin/documents', requireAuth, (req, res) => {
  const { name, url, icon } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM documents').get().m || 0;
  const result = db.prepare(
    'INSERT INTO documents (name, url, icon, sort_order) VALUES (?, ?, ?, ?)'
  ).run(name, url, icon || '📄', maxOrder + 1);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/documents/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Gallery CRUD (with file upload) ----

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

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM gallery').get().m || 0;
  const result = db.prepare(
    'INSERT INTO gallery (caption, filename, url, sort_order) VALUES (?, ?, ?, ?)'
  ).run(caption, filename, url, maxOrder + 1);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/gallery/:id', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM gallery WHERE id=?').get(req.params.id);
  if (photo && photo.filename) {
    const filePath = path.join(UPLOADS_DIR, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Messages ----

app.get('/api/admin/messages', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
  res.json(rows);
});

app.put('/api/admin/messages/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE messages SET is_read=1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/messages/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ---- Settings ----

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const transaction = db.transaction((settings) => {
    for (const [k, v] of Object.entries(settings)) {
      upsert.run(k, v);
    }
  });
  transaction(req.body);
  res.json({ success: true });
});

// ---- Change password ----

app.put('/api/admin/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  const match = await bcrypt.compare(current_password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
  res.json({ success: true });
});

// ---- SPA fallback ----

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---- Start ----

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Troop 731 website running on http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
