const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('./db');
const sanitizeHtml = require('sanitize-html');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// ---- Fix #9: Refuse to start with default session secret ----
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET env var is not set. A random secret has been generated. Sessions will not persist across restarts.');
}

// ---- Middleware ----

// Fix #1: Helmet security headers
app.use(require('helmet')());

app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));

// Fix #2: Rate limiters
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const contactLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Fix #4: Sanitize HTML helper for about_content
const sanitizeOptions = {
  allowedTags: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'h3', 'h4', 'a'],
  allowedAttributes: {
    'a': ['href'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
};

function sanitizeAboutContent(value) {
  return sanitizeHtml(value, sanitizeOptions);
}

// Fix #3: Settings key whitelist
const ALLOWED_SETTINGS_KEYS = new Set([
  'meeting_day', 'meeting_time', 'location', 'scoutmaster_name',
  'troop_email', 'charter_info', 'eagle_info', 'about_content',
]);

// Fix #6: DB call helper with try/catch
function dbSafe(res, fn) {
  try {
    return fn();
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Internal server error' });
    return undefined;
  }
}

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

// Fix #11: MIME type check in multer fileFilter
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowedExt.test(file.originalname) && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) {
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
  const result = dbSafe(res, () => DB.all('SELECT * FROM announcements ORDER BY created_at DESC'));
  if (result !== undefined) res.json(result);
});

app.get('/api/events', (req, res) => {
  const result = dbSafe(res, () => DB.all('SELECT * FROM events ORDER BY date ASC'));
  if (result !== undefined) res.json(result);
});

app.get('/api/fb-groups', (req, res) => {
  const result = dbSafe(res, () => DB.all('SELECT * FROM fb_groups ORDER BY sort_order ASC'));
  if (result !== undefined) res.json(result);
});

app.get('/api/links', (req, res) => {
  const result = dbSafe(res, () => DB.all('SELECT * FROM links ORDER BY sort_order ASC'));
  if (result !== undefined) res.json(result);
});

app.get('/api/documents', (req, res) => {
  const result = dbSafe(res, () => DB.all('SELECT * FROM documents ORDER BY sort_order ASC'));
  if (result !== undefined) res.json(result);
});

app.get('/api/gallery', (req, res) => {
  const result = dbSafe(res, () => DB.all('SELECT * FROM gallery ORDER BY sort_order ASC, created_at DESC'));
  if (result !== undefined) res.json(result);
});

// Fix #4: Sanitize about_content when serving settings
app.get('/api/settings', (req, res) => {
  const rows = dbSafe(res, () => DB.all('SELECT * FROM settings'));
  if (rows === undefined) return;
  const settings = {};
  rows.forEach(r => {
    settings[r.key] = r.key === 'about_content' ? sanitizeAboutContent(r.value) : r.value;
  });
  res.json(settings);
});

// Fix #2: Rate limiter on contact
app.post('/api/contact', contactLimiter, (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  const result = dbSafe(res, () => DB.run('INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)',
    [name, email, subject || 'General', message]));
  if (result !== undefined) res.json({ success: true });
});

// ============================================
//  AUTH API
// ============================================

// Fix #2: Rate limiter on login
// Fix #8: Regenerate session after login
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = DB.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      const responseData = { success: true, displayName: user.display_name };
      if (user.force_password_change) responseData.forcePasswordChange = true;
      res.json(responseData);
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fix #7: Fix session.destroy callback in logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.userId) {
    const user = dbSafe(res, () => DB.get('SELECT username, display_name, role, force_password_change FROM users WHERE id = ?', [req.session.userId]));
    if (user !== undefined) {
      const responseData = { authenticated: true, user };
      if (user.force_password_change) responseData.forcePasswordChange = true;
      return res.json(responseData);
    }
    return;
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
  const result = dbSafe(res, () => DB.run(
    'INSERT INTO announcements (title, content, priority, category) VALUES (?, ?, ?, ?)',
    [title, content, priority || 'normal', category || 'info']));
  if (result !== undefined) res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/admin/announcements/:id', requireAuth, (req, res) => {
  const { title, content, priority, category } = req.body;
  const result = dbSafe(res, () => DB.run('UPDATE announcements SET title=?, content=?, priority=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [title, content, priority, category, req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

app.delete('/api/admin/announcements/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('DELETE FROM announcements WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

// Events
app.post('/api/admin/events', requireAuth, (req, res) => {
  const { title, date, end_date, time, type, location, description } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Title and date required' });
  const result = dbSafe(res, () => DB.run(
    'INSERT INTO events (title, date, end_date, time, type, location, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title, date, end_date || null, time, type || 'meeting', location, description]));
  if (result !== undefined) res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/admin/events/:id', requireAuth, (req, res) => {
  const { title, date, end_date, time, type, location, description } = req.body;
  const result = dbSafe(res, () => DB.run('UPDATE events SET title=?, date=?, end_date=?, time=?, type=?, location=?, description=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    [title, date, end_date || null, time, type, location, description, req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

app.delete('/api/admin/events/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('DELETE FROM events WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

// Facebook Groups
app.post('/api/admin/fb-groups', requireAuth, (req, res) => {
  const { name, url, description } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const result = dbSafe(res, () => {
    const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM fb_groups') || {}).m || 0;
    return DB.run('INSERT INTO fb_groups (name, url, description, sort_order) VALUES (?, ?, ?, ?)',
      [name, url, description, maxOrder + 1]);
  });
  if (result !== undefined) res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/fb-groups/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('DELETE FROM fb_groups WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

// Links
app.post('/api/admin/links', requireAuth, (req, res) => {
  const { name, url } = req.body;
  let icon = req.body.icon;
  if (typeof icon !== 'string' || icon.length > 10) icon = '';
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const result = dbSafe(res, () => {
    const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM links') || {}).m || 0;
    return DB.run('INSERT INTO links (name, url, icon, sort_order) VALUES (?, ?, ?, ?)',
      [name, url, icon || '\u{1F517}', maxOrder + 1]);
  });
  if (result !== undefined) res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/links/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('DELETE FROM links WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

// Documents
app.post('/api/admin/documents', requireAuth, (req, res) => {
  const { name, url } = req.body;
  let icon = req.body.icon;
  if (typeof icon !== 'string' || icon.length > 10) icon = '';
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  const result = dbSafe(res, () => {
    const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM documents') || {}).m || 0;
    return DB.run('INSERT INTO documents (name, url, icon, sort_order) VALUES (?, ?, ?, ?)',
      [name, url, icon || '\u{1F4C4}', maxOrder + 1]);
  });
  if (result !== undefined) res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/documents/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('DELETE FROM documents WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
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
    if (!req.body.url.startsWith('http://') && !req.body.url.startsWith('https://')) {
      return res.status(400).json({ error: 'Gallery URL must start with http:// or https://' });
    }
    url = req.body.url;
  }

  const result = dbSafe(res, () => {
    const maxOrder = (DB.get('SELECT MAX(sort_order) as m FROM gallery') || {}).m || 0;
    return DB.run('INSERT INTO gallery (caption, filename, url, sort_order) VALUES (?, ?, ?, ?)',
      [caption, filename, url, maxOrder + 1]);
  });
  if (result !== undefined) res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/admin/gallery/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => {
    const photo = DB.get('SELECT * FROM gallery WHERE id=?', [req.params.id]);
    if (photo && photo.filename) {
      const filePath = path.resolve(path.join(UPLOADS_DIR, photo.filename));
      if (filePath.startsWith(path.resolve(UPLOADS_DIR)) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    return DB.run('DELETE FROM gallery WHERE id=?', [req.params.id]);
  });
  if (result !== undefined) res.json({ success: true });
});

// Messages
app.get('/api/admin/messages', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.all('SELECT * FROM messages ORDER BY created_at DESC'));
  if (result !== undefined) res.json(result);
});

app.put('/api/admin/messages/:id/read', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('UPDATE messages SET is_read=1 WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

app.delete('/api/admin/messages/:id', requireAuth, (req, res) => {
  const result = dbSafe(res, () => DB.run('DELETE FROM messages WHERE id=?', [req.params.id]));
  if (result !== undefined) res.json({ success: true });
});

// Fix #3: Settings whitelist + Fix #4: Sanitize about_content on store
app.put('/api/admin/settings', requireAuth, (req, res) => {
  const unknownKeys = Object.keys(req.body).filter(k => !ALLOWED_SETTINGS_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return res.status(400).json({ error: `Unknown settings keys: ${unknownKeys.join(', ')}` });
  }
  const result = dbSafe(res, () => {
    for (const [k, v] of Object.entries(req.body)) {
      const value = k === 'about_content' ? sanitizeAboutContent(v) : v;
      DB.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, value]);
    }
    return true;
  });
  if (result !== undefined) res.json({ success: true });
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password change attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// Fix #10: Validate current_password presence in password change route
app.put('/api/admin/password', requireAuth, passwordLimiter, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = DB.get('SELECT * FROM users WHERE id=?', [req.session.userId]);
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    DB.run('UPDATE users SET password_hash=?, force_password_change=0 WHERE id=?', [hash, user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SPA fallback
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Fix #5: Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
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
