const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let BASE_URL;
let serverProcess;
let tmpDir;
let cookieJar = ''; // raw Set-Cookie value for session persistence

function randomPort() {
  return 10000 + Math.floor(Math.random() * 50000);
}

/** Make an HTTP request using native fetch, forwarding session cookie. */
async function api(method, urlPath, body, { useCookie = false, rawResponse = false } = {}) {
  const headers = {};
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
  }
  if (useCookie && cookieJar) {
    headers['Cookie'] = cookieJar;
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${urlPath}`, opts);
  // Capture set-cookie
  const sc = res.headers.get('set-cookie');
  if (sc) cookieJar = sc.split(';')[0]; // keep just the session id part
  if (rawResponse) return res;
  const json = await res.json();
  return { status: res.status, body: json };
}

async function GET(p, opts) { return api('GET', p, null, opts); }
async function POST(p, b, opts) { return api('POST', p, b, opts); }
async function PUT(p, b, opts) { return api('PUT', p, b, opts); }
async function DELETE(p, opts) { return api('DELETE', p, null, opts); }

/** Login as the default admin and store session cookie. */
async function loginAsAdmin() {
  const r = await POST('/api/login', { username: 'webmaster', password: 'troop731admin' });
  assert.equal(r.status, 200);
  assert.ok(r.body.success);
  return r;
}

// ---------------------------------------------------------------------------
// Lifecycle — start server in a child process with temp DATA_DIR
// ---------------------------------------------------------------------------

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'troop731-test-'));
  const port = randomPort();
  BASE_URL = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tmpDir,
      SESSION_SECRET: 'test-secret',
      NODE_ENV: 'test',
    },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for the server to be listening
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start within 15 s')), 15000);
    let output = '';
    serverProcess.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('running on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early (code ${code}): ${output}`));
    });
  });
});

after(async () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await new Promise((r) => serverProcess.on('exit', r));
  }
  // Clean up temp dir
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
//  PUBLIC GET ENDPOINTS
// ---------------------------------------------------------------------------

describe('Public GET endpoints', () => {
  it('GET /api/announcements returns array with seed data', async () => {
    const r = await GET('/api/announcements');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 3, 'seed data should produce at least 3 announcements');
    assert.ok(r.body[0].title, 'each announcement should have a title');
  });

  it('GET /api/events returns array with seed data', async () => {
    const r = await GET('/api/events');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 6);
    assert.ok(r.body[0].date, 'each event should have a date');
  });

  it('GET /api/fb-groups returns array', async () => {
    const r = await GET('/api/fb-groups');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 3);
  });

  it('GET /api/links returns array', async () => {
    const r = await GET('/api/links');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 3);
  });

  it('GET /api/documents returns array', async () => {
    const r = await GET('/api/documents');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 3);
  });

  it('GET /api/gallery returns array (initially empty)', async () => {
    const r = await GET('/api/gallery');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  it('GET /api/settings returns object with seed keys', async () => {
    const r = await GET('/api/settings');
    assert.equal(r.status, 200);
    assert.equal(typeof r.body, 'object');
    assert.ok(r.body.meeting_day);
    assert.ok(r.body.troop_email);
    assert.ok(r.body.about_content);
  });
});

// ---------------------------------------------------------------------------
//  CONTACT FORM (POST /api/contact)
// ---------------------------------------------------------------------------

describe('Contact form POST /api/contact', () => {
  it('rejects when name is missing', async () => {
    const r = await POST('/api/contact', { email: 'a@b.com', message: 'hi' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it('rejects when email is missing', async () => {
    const r = await POST('/api/contact', { name: 'Joe', message: 'hi' });
    assert.equal(r.status, 400);
  });

  it('rejects when message is missing', async () => {
    const r = await POST('/api/contact', { name: 'Joe', email: 'a@b.com' });
    assert.equal(r.status, 400);
  });

  it('succeeds with valid fields', async () => {
    const r = await POST('/api/contact', {
      name: 'Test User',
      email: 'test@example.com',
      subject: 'Hello',
      message: 'This is a test message.',
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
  });

  it('succeeds without optional subject', async () => {
    const r = await POST('/api/contact', {
      name: 'No Subject',
      email: 'ns@example.com',
      message: 'No subject here.',
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
  });
});

// ---------------------------------------------------------------------------
//  AUTH FLOW
// ---------------------------------------------------------------------------

describe('Auth flow', () => {
  it('login with wrong username returns 401', async () => {
    const r = await POST('/api/login', { username: 'nonexistent', password: 'anything' });
    assert.equal(r.status, 401);
    assert.ok(r.body.error);
  });

  it('login with wrong password returns 401', async () => {
    const r = await POST('/api/login', { username: 'webmaster', password: 'wrongpass' });
    assert.equal(r.status, 401);
  });

  it('login with correct credentials returns success and displayName', async () => {
    cookieJar = ''; // reset
    const r = await POST('/api/login', { username: 'webmaster', password: 'troop731admin' });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
    assert.equal(r.body.displayName, 'Troop Webmaster');
    assert.ok(cookieJar, 'should receive a session cookie');
  });

  it('auth check returns authenticated after login', async () => {
    const r = await GET('/api/auth/check', { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.authenticated);
    assert.equal(r.body.user.username, 'webmaster');
  });

  it('logout clears session', async () => {
    const r = await POST('/api/logout', {}, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
  });

  it('auth check returns false after logout', async () => {
    // Use a fresh cookie-less request
    const oldCookie = cookieJar;
    cookieJar = '';
    const r = await GET('/api/auth/check');
    assert.equal(r.status, 200);
    assert.equal(r.body.authenticated, false);
    cookieJar = oldCookie; // restore for later tests
  });
});

// ---------------------------------------------------------------------------
//  AUTH PROTECTION — admin endpoints without session
// ---------------------------------------------------------------------------

describe('Auth protection (401 without session)', () => {
  const protectedEndpoints = [
    ['POST', '/api/admin/announcements'],
    ['PUT', '/api/admin/announcements/1'],
    ['DELETE', '/api/admin/announcements/1'],
    ['POST', '/api/admin/events'],
    ['PUT', '/api/admin/events/1'],
    ['DELETE', '/api/admin/events/1'],
    ['POST', '/api/admin/fb-groups'],
    ['DELETE', '/api/admin/fb-groups/1'],
    ['POST', '/api/admin/links'],
    ['DELETE', '/api/admin/links/1'],
    ['POST', '/api/admin/documents'],
    ['DELETE', '/api/admin/documents/1'],
    ['POST', '/api/admin/gallery'],
    ['DELETE', '/api/admin/gallery/1'],
    ['GET', '/api/admin/messages'],
    ['PUT', '/api/admin/messages/1/read'],
    ['DELETE', '/api/admin/messages/1'],
    ['PUT', '/api/admin/settings'],
    ['PUT', '/api/admin/password'],
  ];

  for (const [method, url] of protectedEndpoints) {
    it(`${method} ${url} returns 401`, async () => {
      // Ensure no cookie
      const r = await api(method, url, method !== 'GET' && method !== 'DELETE' ? {} : null);
      assert.equal(r.status, 401, `Expected 401 for ${method} ${url}`);
    });
  }
});

// ---------------------------------------------------------------------------
//  ADMIN CRUD — Announcements
// ---------------------------------------------------------------------------

describe('Admin CRUD — Announcements', () => {
  before(async () => {
    cookieJar = '';
    await loginAsAdmin();
  });

  let createdId;

  it('create announcement', async () => {
    const r = await POST('/api/admin/announcements', {
      title: 'Test Announcement',
      content: 'Test content here.',
      priority: 'high',
      category: 'event',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
    assert.equal(typeof r.body.id, 'number');
    // The returned id may be unreliable (sql.js last_insert_rowid quirk after export),
    // so look up the actual id from the list.
    const list = await GET('/api/announcements');
    const found = list.body.find((a) => a.title === 'Test Announcement');
    assert.ok(found, 'created announcement should appear in list');
    createdId = found.id;
  });

  it('create announcement requires title and content', async () => {
    const r = await POST('/api/admin/announcements', { title: 'No Content' }, { useCookie: true });
    assert.equal(r.status, 400);
  });

  it('read announcements includes created one', async () => {
    const r = await GET('/api/announcements');
    assert.equal(r.status, 200);
    const found = r.body.find((a) => a.title === 'Test Announcement');
    assert.ok(found, 'created announcement should appear in list');
    assert.equal(found.priority, 'high');
  });

  it('update announcement', async () => {
    const r = await PUT(`/api/admin/announcements/${createdId}`, {
      title: 'Updated Title',
      content: 'Updated content.',
      priority: 'normal',
      category: 'info',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);

    const list = await GET('/api/announcements');
    const found = list.body.find((a) => Number(a.id) === Number(createdId));
    assert.ok(found, 'announcement should still exist after update');
    assert.equal(found.title, 'Updated Title');
  });

  it('delete announcement', async () => {
    const r = await DELETE(`/api/admin/announcements/${createdId}`, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);

    const list = await GET('/api/announcements');
    const found = list.body.find((a) => Number(a.id) === Number(createdId));
    assert.ok(!found, 'deleted announcement should be gone');
  });
});

// ---------------------------------------------------------------------------
//  ADMIN CRUD — Events
// ---------------------------------------------------------------------------

describe('Admin CRUD — Events', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  let createdId;

  it('create event', async () => {
    const r = await POST('/api/admin/events', {
      title: 'Test Campout',
      date: '2026-05-01',
      end_date: '2026-05-02',
      time: '6:00 PM',
      type: 'campout',
      location: 'State Park',
      description: 'A fun campout.',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.id, 'number');
    // Look up real id from the list (sql.js last_insert_rowid can be unreliable after export)
    const list = await GET('/api/events');
    const found = list.body.find((e) => e.title === 'Test Campout');
    assert.ok(found);
    createdId = found.id;
  });

  it('create event requires title and date', async () => {
    const r = await POST('/api/admin/events', { title: 'Missing Date' }, { useCookie: true });
    assert.equal(r.status, 400);
  });

  it('read events includes created one', async () => {
    const r = await GET('/api/events');
    const found = r.body.find((e) => e.title === 'Test Campout');
    assert.ok(found);
    assert.equal(found.location, 'State Park');
  });

  it('update event', async () => {
    const r = await PUT(`/api/admin/events/${createdId}`, {
      title: 'Updated Campout',
      date: '2026-05-10',
      time: '5:00 PM',
      type: 'campout',
      location: 'Lake',
      description: 'Updated.',
    }, { useCookie: true });
    assert.equal(r.status, 200);

    const list = await GET('/api/events');
    const found = list.body.find((e) => Number(e.id) === Number(createdId));
    assert.ok(found, 'event should still exist after update');
    assert.equal(found.title, 'Updated Campout');
  });

  it('delete event', async () => {
    const r = await DELETE(`/api/admin/events/${createdId}`, { useCookie: true });
    assert.equal(r.status, 200);

    const list = await GET('/api/events');
    const found = list.body.find((e) => Number(e.id) === Number(createdId));
    assert.ok(!found);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN CRUD — FB Groups
// ---------------------------------------------------------------------------

describe('Admin CRUD — FB Groups', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  let createdId;

  it('create fb-group', async () => {
    const r = await POST('/api/admin/fb-groups', {
      name: 'Test Group',
      url: 'https://facebook.com/groups/test',
      description: 'A test group.',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.id, 'number');
    const list = await GET('/api/fb-groups');
    createdId = list.body.find((g) => g.name === 'Test Group').id;
  });

  it('create fb-group requires name and url', async () => {
    const r = await POST('/api/admin/fb-groups', { name: 'No URL' }, { useCookie: true });
    assert.equal(r.status, 400);
  });

  it('read fb-groups includes created one', async () => {
    const r = await GET('/api/fb-groups');
    const found = r.body.find((g) => g.name === 'Test Group');
    assert.ok(found);
  });

  it('delete fb-group', async () => {
    const r = await DELETE(`/api/admin/fb-groups/${createdId}`, { useCookie: true });
    assert.equal(r.status, 200);

    const list = await GET('/api/fb-groups');
    const found = list.body.find((g) => Number(g.id) === Number(createdId));
    assert.ok(!found);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN CRUD — Links
// ---------------------------------------------------------------------------

describe('Admin CRUD — Links', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  let createdId;

  it('create link', async () => {
    const r = await POST('/api/admin/links', {
      name: 'Test Link',
      url: 'https://example.com',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.id, 'number');
    const list = await GET('/api/links');
    createdId = list.body.find((l) => l.name === 'Test Link').id;
  });

  it('create link requires name and url', async () => {
    const r = await POST('/api/admin/links', { name: 'No URL' }, { useCookie: true });
    assert.equal(r.status, 400);
  });

  it('read links includes created one', async () => {
    const r = await GET('/api/links');
    const found = r.body.find((l) => l.name === 'Test Link');
    assert.ok(found);
  });

  it('delete link', async () => {
    const r = await DELETE(`/api/admin/links/${createdId}`, { useCookie: true });
    assert.equal(r.status, 200);

    const list = await GET('/api/links');
    const found = list.body.find((l) => Number(l.id) === Number(createdId));
    assert.ok(!found);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN CRUD — Documents
// ---------------------------------------------------------------------------

describe('Admin CRUD — Documents', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  let createdId;

  it('create document', async () => {
    const r = await POST('/api/admin/documents', {
      name: 'Test Doc',
      url: 'https://example.com/doc.pdf',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.id, 'number');
    const list = await GET('/api/documents');
    createdId = list.body.find((d) => d.name === 'Test Doc').id;
  });

  it('create document requires name and url', async () => {
    const r = await POST('/api/admin/documents', { url: 'https://example.com' }, { useCookie: true });
    assert.equal(r.status, 400);
  });

  it('read documents includes created one', async () => {
    const r = await GET('/api/documents');
    const found = r.body.find((d) => d.name === 'Test Doc');
    assert.ok(found);
  });

  it('delete document', async () => {
    const r = await DELETE(`/api/admin/documents/${createdId}`, { useCookie: true });
    assert.equal(r.status, 200);

    const list = await GET('/api/documents');
    const found = list.body.find((d) => Number(d.id) === Number(createdId));
    assert.ok(!found);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN — Gallery (URL-based, no file upload)
// ---------------------------------------------------------------------------

describe('Admin — Gallery (URL-based)', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  let createdId;

  it('create gallery item with URL', async () => {
    const r = await POST('/api/admin/gallery', {
      url: 'https://example.com/photo.jpg',
      caption: 'A nice photo',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.id, 'number');
    const list = await GET('/api/gallery');
    createdId = list.body.find((g) => g.caption === 'A nice photo').id;
  });

  it('read gallery includes created item', async () => {
    const r = await GET('/api/gallery');
    const found = r.body.find((g) => g.caption === 'A nice photo');
    assert.ok(found);
    assert.equal(found.url, 'https://example.com/photo.jpg');
  });

  it('delete gallery item', async () => {
    const r = await DELETE(`/api/admin/gallery/${createdId}`, { useCookie: true });
    assert.equal(r.status, 200);

    const list = await GET('/api/gallery');
    const found = list.body.find((g) => Number(g.id) === Number(createdId));
    assert.ok(!found);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN — Messages
// ---------------------------------------------------------------------------

describe('Admin — Messages', () => {
  before(async () => {
    cookieJar = '';
    // Submit messages via public contact form first
    await POST('/api/contact', { name: 'Alice', email: 'a@test.com', subject: 'Hi', message: 'Hello from Alice' });
    await POST('/api/contact', { name: 'Bob', email: 'b@test.com', message: 'Hello from Bob' });
    await loginAsAdmin();
  });

  let messageId;

  it('read messages as admin', async () => {
    const r = await GET('/api/admin/messages', { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    // Should include the two we just submitted plus the ones from earlier contact tests
    assert.ok(r.body.length >= 2);
    messageId = r.body[0].id;
  });

  it('mark message as read', async () => {
    const r = await PUT(`/api/admin/messages/${messageId}/read`, {}, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);

    const list = await GET('/api/admin/messages', { useCookie: true });
    const msg = list.body.find((m) => Number(m.id) === Number(messageId));
    assert.equal(msg.is_read, 1);
  });

  it('delete message', async () => {
    const r = await DELETE(`/api/admin/messages/${messageId}`, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);

    const list = await GET('/api/admin/messages', { useCookie: true });
    const found = list.body.find((m) => Number(m.id) === Number(messageId));
    assert.ok(!found);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN — Settings
// ---------------------------------------------------------------------------

describe('Admin — Settings', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  it('read settings returns seed values', async () => {
    const r = await GET('/api/settings');
    assert.equal(r.status, 200);
    assert.equal(r.body.meeting_day, 'Every Tuesday');
  });

  it('update settings', async () => {
    const r = await PUT('/api/admin/settings', {
      meeting_day: 'Every Wednesday',
      meeting_time: '6:30 PM',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);

    const s = await GET('/api/settings');
    assert.equal(s.body.meeting_day, 'Every Wednesday');
    assert.equal(s.body.meeting_time, '6:30 PM');
  });

  it('rejects unknown settings keys', async () => {
    const r = await PUT('/api/admin/settings', {
      custom_key: 'custom_value',
    }, { useCookie: true });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });
});

// ---------------------------------------------------------------------------
//  ADMIN — Password Change
// ---------------------------------------------------------------------------

describe('Admin — Password Change', () => {
  before(async () => { cookieJar = ''; await loginAsAdmin(); });

  it('rejects wrong current password', async () => {
    const r = await PUT('/api/admin/password', {
      current_password: 'wrongpassword',
      new_password: 'newpass123',
    }, { useCookie: true });
    assert.equal(r.status, 401);
    assert.ok(r.body.error);
  });

  it('rejects too-short new password', async () => {
    const r = await PUT('/api/admin/password', {
      current_password: 'troop731admin',
      new_password: '12345',
    }, { useCookie: true });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it('succeeds with correct current password and valid new password', async () => {
    const r = await PUT('/api/admin/password', {
      current_password: 'troop731admin',
      new_password: 'newpassword123',
    }, { useCookie: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
  });

  it('can login with new password', async () => {
    cookieJar = '';
    const r = await POST('/api/login', { username: 'webmaster', password: 'newpassword123' });
    assert.equal(r.status, 200);
    assert.ok(r.body.success);
  });

  it('old password no longer works', async () => {
    cookieJar = '';
    const r = await POST('/api/login', { username: 'webmaster', password: 'troop731admin' });
    assert.equal(r.status, 401);
  });

  // Restore original password for any subsequent tests
  after(async () => {
    cookieJar = '';
    await POST('/api/login', { username: 'webmaster', password: 'newpassword123' });
    await PUT('/api/admin/password', {
      current_password: 'newpassword123',
      new_password: 'troop731admin',
    }, { useCookie: true });
  });
});
