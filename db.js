const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

// Persistent data directory — mount a Docker volume here
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'troop731.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'webmaster',
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

// ---- Seed default data if empty ----

function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const hash = bcrypt.hashSync('troop731admin', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
      .run('webmaster', hash, 'Troop Webmaster', 'webmaster');
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  if (settingsCount === 0) {
    const defaults = {
      meeting_day: 'Every Tuesday',
      meeting_time: '7:00 PM',
      location: 'Community Center, Main Hall',
      scoutmaster_name: 'Ms. Smith',
      troop_email: 'troop731@example.com',
      charter_info: 'Serving Scouts Since 1985',
      eagle_info: 'Proud history of Eagle Scout achievements',
      about_content: `<p>Troop 731 is a youth-led, all-girls Scouts BSA troop dedicated to building character, leadership, and personal fitness in young women ages 11–17.</p>
<p>Our Scouts participate in a wide range of outdoor activities including camping, hiking, canoeing, and community service projects. We emphasize the Scout Oath and Scout Law in everything we do.</p>
<p>Whether your Scout is just crossing over from Cub Scouts or joining for the first time, Troop 731 offers a welcoming and empowering environment to learn, grow, and have fun.</p>`,
    };
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) {
      stmt.run(k, v);
    }
  }

  const annCount = db.prepare('SELECT COUNT(*) as c FROM announcements').get().c;
  if (annCount === 0) {
    const stmt = db.prepare('INSERT INTO announcements (title, content, priority, category, created_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run('Summer Camp Registration Open',
      'Registration for summer camp is now open! Please submit your forms and deposit by April 15. See the Scoutmaster for details.',
      'high', 'event', '2026-03-05');
    stmt.run('Spring Service Project',
      'Our spring community service project will be at Riverside Park on March 28. We will be planting trees and cleaning up trails. Wear work clothes and bring gloves!',
      'normal', 'info', '2026-03-03');
    stmt.run('Merit Badge Day — March 21',
      'The district is hosting a Merit Badge Day at the council office. Badges offered include First Aid, Citizenship in the Community, and Environmental Science. Sign up with your patrol leader.',
      'normal', 'event', '2026-03-01');
  }

  const evtCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
  if (evtCount === 0) {
    const stmt = db.prepare('INSERT INTO events (title, date, end_date, time, type, location, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmt.run('Troop Meeting', '2026-03-10', null, '7:00 PM', 'meeting', 'Community Center, Main Hall',
      'Regular weekly troop meeting. Patrol corners, skills instruction, and planning for upcoming campout.');
    stmt.run('Spring Campout — Lake Hartwell', '2026-03-21', '2026-03-22', 'Depart 6:00 PM Friday', 'campout', 'Lake Hartwell State Park',
      'Overnight camping trip featuring fishing, hiking, and cooking merit badge work. Bring all personal camping gear.');
    stmt.run('Community Service — Riverside Park', '2026-03-28', null, '9:00 AM – 1:00 PM', 'service', 'Riverside Park',
      'Tree planting and trail cleanup. Wear work clothes and bring work gloves. Community service hours will be recorded.');
    stmt.run('Troop Committee Meeting', '2026-04-01', null, '7:30 PM', 'meeting', 'Community Center, Room 102',
      'Monthly committee meeting. All parents welcome. Agenda includes summer camp planning and fundraiser updates.');
    stmt.run('Eagle Scout Court of Honor', '2026-04-12', null, '2:00 PM', 'special', 'First United Methodist Church',
      'Please join us to celebrate our newest Eagle Scout! Reception to follow. Class A uniform required.');
    stmt.run('Fundraiser — Car Wash', '2026-04-18', null, '9:00 AM – 2:00 PM', 'fundraiser', 'Hometown Hardware Parking Lot',
      'Annual car wash fundraiser to support summer camp scholarships. All Scouts expected to participate.');
  }

  const fbCount = db.prepare('SELECT COUNT(*) as c FROM fb_groups').get().c;
  if (fbCount === 0) {
    const stmt = db.prepare('INSERT INTO fb_groups (name, url, description, sort_order) VALUES (?, ?, ?, ?)');
    stmt.run('Troop 731 Families', 'https://www.facebook.com/groups/', 'Private group for parents and guardians of active Scouts', 1);
    stmt.run('Troop 731 Scouts', 'https://www.facebook.com/groups/', 'Private group for registered Scouts only', 2);
    stmt.run('Troop 731 Alumni', 'https://www.facebook.com/groups/', 'Connect with former Scouts and leaders', 3);
  }

  const linkCount = db.prepare('SELECT COUNT(*) as c FROM links').get().c;
  if (linkCount === 0) {
    const stmt = db.prepare('INSERT INTO links (name, url, icon, sort_order) VALUES (?, ?, ?, ?)');
    stmt.run('Scoutbook', 'https://www.scoutbook.scouting.org', '📘', 1);
    stmt.run('BSA National', 'https://www.scouting.org', '⚜️', 2);
    stmt.run('Merit Badge List', 'https://meritbadge.org', '🏅', 3);
  }

  const docCount = db.prepare('SELECT COUNT(*) as c FROM documents').get().c;
  if (docCount === 0) {
    const stmt = db.prepare('INSERT INTO documents (name, url, icon, sort_order) VALUES (?, ?, ?, ?)');
    stmt.run('Medical Form (Parts A&B)', '#', '📋', 1);
    stmt.run('Permission Slip Template', '#', '📝', 2);
    stmt.run('Troop Bylaws', '#', '📄', 3);
  }
}

seedIfEmpty();

module.exports = db;
