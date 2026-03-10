const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'troop731.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

let db;

// Wrapper that gives a synchronous-looking API over sql.js
// so server.js doesn't need massive refactoring
const DB = {
  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON');
    this._createSchema();
    this._migrate();
    this._seedIfEmpty();
    this.save();
    return this;
  },

  // Persist to disk
  save() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  },

  // Run a statement (INSERT/UPDATE/DELETE)
  run(sql, params = []) {
    db.run(sql, params);
    this.save();
    return { lastInsertRowid: this._lastId() };
  },

  // Get all rows
  all(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  // Get one row
  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows[0] || null;
  },

  // Execute raw SQL (multi-statement)
  exec(sql) {
    db.exec(sql);
    this.save();
  },

  _lastId() {
    const r = this.all('SELECT last_insert_rowid() as id');
    return r[0] ? r[0].id : 0;
  },

  _createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        role TEXT DEFAULT 'webmaster',
        force_password_change INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        priority TEXT DEFAULT 'normal',
        category TEXT DEFAULT 'info',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        end_date TEXT,
        time TEXT,
        type TEXT DEFAULT 'meeting',
        location TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS fb_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT DEFAULT '🔗',
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT DEFAULT '📄',
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS gallery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caption TEXT,
        filename TEXT,
        url TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  },

  _migrate() {
    // Add force_password_change column if missing (for databases created before this feature)
    const cols = this.all("PRAGMA table_info(users)").map(c => c.name);
    if (!cols.includes('force_password_change')) {
      this.run('ALTER TABLE users ADD COLUMN force_password_change INTEGER DEFAULT 0');
    }
  },

  _seedIfEmpty() {
    const userCount = this.get('SELECT COUNT(*) as c FROM users').c;
    if (userCount === 0) {
      const hash = bcrypt.hashSync('troop731admin', 10);
      this.run('INSERT INTO users (username, password_hash, display_name, role, force_password_change) VALUES (?, ?, ?, ?, ?)',
        ['webmaster', hash, 'Troop Webmaster', 'webmaster', 1]);
    }

    const settingsCount = this.get('SELECT COUNT(*) as c FROM settings').c;
    if (settingsCount === 0) {
      const defaults = {
        meeting_day: 'Every Tuesday',
        meeting_time: '7:00 PM',
        location: 'Community Center, Main Hall',
        scoutmaster_name: 'Ms. Smith',
        troop_email: 'troop731@example.com',
        charter_info: 'Serving Scouts Since 1985',
        eagle_info: 'Proud history of Eagle Scout achievements',
        about_content: `<p>Troop 731 is a youth-led, all-girls Scouting America troop dedicated to building character, leadership, and personal fitness in young women ages 11\u201317.</p>
<p>Our Scouts participate in a wide range of outdoor activities including camping, hiking, canoeing, and community service projects. We emphasize the Scout Oath and Scout Law in everything we do.</p>
<p>Whether your Scout is just crossing over from Cub Scouts or joining for the first time, Troop 731 offers a welcoming and empowering environment to learn, grow, and have fun.</p>`,
      };
      for (const [k, v] of Object.entries(defaults)) {
        db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
      }
    }

    const annCount = this.get('SELECT COUNT(*) as c FROM announcements').c;
    if (annCount === 0) {
      const ins = 'INSERT INTO announcements (title, content, priority, category, created_at) VALUES (?, ?, ?, ?, ?)';
      db.run(ins, ['Summer Camp Registration Open',
        'Registration for summer camp is now open! Please submit your forms and deposit by April 15. See the Scoutmaster for details.',
        'high', 'event', '2026-03-05']);
      db.run(ins, ['Spring Service Project',
        'Our spring community service project will be at Riverside Park on March 28. We will be planting trees and cleaning up trails. Wear work clothes and bring gloves!',
        'normal', 'info', '2026-03-03']);
      db.run(ins, ['Merit Badge Day \u2014 March 21',
        'The district is hosting a Merit Badge Day at the council office. Badges offered include First Aid, Citizenship in the Community, and Environmental Science. Sign up with your patrol leader.',
        'normal', 'event', '2026-03-01']);
    }

    const evtCount = this.get('SELECT COUNT(*) as c FROM events').c;
    if (evtCount === 0) {
      const ins = 'INSERT INTO events (title, date, end_date, time, type, location, description) VALUES (?, ?, ?, ?, ?, ?, ?)';
      db.run(ins, ['Troop Meeting', '2026-03-10', null, '7:00 PM', 'meeting', 'Community Center, Main Hall',
        'Regular weekly troop meeting. Patrol corners, skills instruction, and planning for upcoming campout.']);
      db.run(ins, ['Spring Campout \u2014 Lake Hartwell', '2026-03-21', '2026-03-22', 'Depart 6:00 PM Friday', 'campout', 'Lake Hartwell State Park',
        'Overnight camping trip featuring fishing, hiking, and cooking merit badge work. Bring all personal camping gear.']);
      db.run(ins, ['Community Service \u2014 Riverside Park', '2026-03-28', null, '9:00 AM \u2013 1:00 PM', 'service', 'Riverside Park',
        'Tree planting and trail cleanup. Wear work clothes and bring work gloves. Community service hours will be recorded.']);
      db.run(ins, ['Troop Committee Meeting', '2026-04-01', null, '7:30 PM', 'meeting', 'Community Center, Room 102',
        'Monthly committee meeting. All parents welcome. Agenda includes summer camp planning and fundraiser updates.']);
      db.run(ins, ['Eagle Scout Court of Honor', '2026-04-12', null, '2:00 PM', 'special', 'First United Methodist Church',
        'Please join us to celebrate our newest Eagle Scout! Reception to follow. Class A uniform required.']);
      db.run(ins, ['Fundraiser \u2014 Car Wash', '2026-04-18', null, '9:00 AM \u2013 2:00 PM', 'fundraiser', 'Hometown Hardware Parking Lot',
        'Annual car wash fundraiser to support summer camp scholarships. All Scouts expected to participate.']);
    }

    const fbCount = this.get('SELECT COUNT(*) as c FROM fb_groups').c;
    if (fbCount === 0) {
      const ins = 'INSERT INTO fb_groups (name, url, description, sort_order) VALUES (?, ?, ?, ?)';
      db.run(ins, ['Troop 731 Families', 'https://www.facebook.com/groups/', 'Private group for parents and guardians of active Scouts', 1]);
      db.run(ins, ['Troop 731 Scouts', 'https://www.facebook.com/groups/', 'Private group for registered Scouts only', 2]);
      db.run(ins, ['Troop 731 Alumni', 'https://www.facebook.com/groups/', 'Connect with former Scouts and leaders', 3]);
      db.run(ins, ['Troop 731 Instagram', 'https://instagram.com/clemmons_nc_troop731_girls', 'Follow us for photos and updates', 4]);
    }

    const linkCount = this.get('SELECT COUNT(*) as c FROM links').c;
    if (linkCount === 0) {
      const ins = 'INSERT INTO links (name, url, icon, sort_order) VALUES (?, ?, ?, ?)';
      db.run(ins, ['Scoutbook', 'https://www.scoutbook.scouting.org', '📘', 1]);
      db.run(ins, ['BSA National', 'https://www.scouting.org', '⚜️', 2]);
      db.run(ins, ['Merit Badge List', 'https://www.scouting.org/skills/merit-badges/all/', '🏅', 3]);
    }

    const docCount = this.get('SELECT COUNT(*) as c FROM documents').c;
    if (docCount === 0) {
      const ins = 'INSERT INTO documents (name, url, icon, sort_order) VALUES (?, ?, ?, ?)';
      db.run(ins, ['Medical Form (Parts A & B)', 'https://filestore.scouting.org/filestore/HealthSafety/pdf/680-001_AB.pdf', '📋', 1]);
      db.run(ins, ['Medical Form (Parts A, B & C) — Trips over 72 hrs', 'https://filestore.scouting.org/filestore/HealthSafety/pdf/680-001_ABC.pdf', '📋', 2]);
      db.run(ins, ['Permission Slip Template', '#', '📝', 3]);
      db.run(ins, ['Troop Bylaws', '#', '📄', 4]);
    }
  },
};

module.exports = DB;
