/* Troop 731 — Admin Panel */

const api = {
  get: (url) => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  put: (url, data) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  del: (url) => fetch(url, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  upload: (url, formData) => fetch(url, { method: 'POST', body: formData }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
};

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showToast(msg, isError = false) {
  const old = document.querySelector('.toast'); if (old) old.remove();
  const t = document.createElement('div');
  t.className = `toast${isError ? ' error' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
}

function fmtDate(str) {
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---- Init ---- */

document.addEventListener('DOMContentLoaded', async () => {
  const auth = await api.get('/api/auth/check');
  if (auth.authenticated) {
    showAdmin();
  } else {
    initLogin();
  }
});

function initLogin() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUser').value;
    const password = document.getElementById('loginPass').value;
    try {
      const res = await api.post('/api/login', { username, password });
      if (res.success) {
        showAdmin();
      } else {
        document.getElementById('loginError').style.display = 'block';
      }
    } catch {
      document.getElementById('loginError').style.display = 'block';
    }
  });
}

function showAdmin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'block';
  initSidebar();
  loadAll();

  document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await api.post('/api/logout', {});
    location.reload();
  });
}

/* ---- Sidebar ---- */

function initSidebar() {
  const navLinks = document.querySelectorAll('.admin-nav a');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      document.getElementById(`sec-${link.dataset.section}`).classList.add('active');
    });
  });
}

/* ---- Load All ---- */

async function loadAll() {
  await Promise.all([
    loadAnnouncements(),
    loadEvents(),
    loadFBGroups(),
    loadLinks(),
    loadDocs(),
    loadGallery(),
    loadMessages(),
    loadSettings(),
  ]);
  updateDashboard();
  initForms();
}

/* ---- Dashboard ---- */

async function updateDashboard() {
  const [ann, evt, fb, msgs] = await Promise.all([
    api.get('/api/announcements'),
    api.get('/api/events'),
    api.get('/api/fb-groups'),
    api.get('/api/admin/messages'),
  ]);
  document.getElementById('statAnn').textContent = ann.length;
  document.getElementById('statEvt').textContent = evt.length;
  document.getElementById('statFB').textContent = fb.length;
  document.getElementById('statMsg').textContent = msgs.filter(m => !m.is_read).length;
}

/* ---- Announcements ---- */

async function loadAnnouncements() {
  const items = await api.get('/api/announcements');
  const c = document.getElementById('listAnn');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No announcements.</p>'; return; }
  c.innerHTML = items.map(a => `<div class="admin-item">
    <div class="admin-item-info"><h4>${esc(a.title)}</h4><p>${fmtDate(a.created_at)} · ${a.priority === 'high' ? 'Important' : 'Normal'}</p></div>
    <div class="admin-item-actions"><button class="btn-icon delete" data-del-ann="${a.id}" title="Delete">✕</button></div>
  </div>`).join('');
  c.querySelectorAll('[data-del-ann]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this announcement?')) return;
      await api.del(`/api/admin/announcements/${btn.dataset.delAnn}`);
      loadAnnouncements();
      showToast('Deleted.');
    });
  });
}

/* ---- Events ---- */

async function loadEvents() {
  const items = await api.get('/api/events');
  const c = document.getElementById('listEvt');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No events.</p>'; return; }
  c.innerHTML = items.map(e => `<div class="admin-item">
    <div class="admin-item-info"><h4>${esc(e.title)}</h4><p>${fmtDate(e.date)} · ${e.type} · ${esc(e.location || 'TBD')}</p></div>
    <div class="admin-item-actions"><button class="btn-icon delete" data-del-evt="${e.id}" title="Delete">✕</button></div>
  </div>`).join('');
  c.querySelectorAll('[data-del-evt]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this event?')) return;
      await api.del(`/api/admin/events/${btn.dataset.delEvt}`);
      loadEvents();
      showToast('Deleted.');
    });
  });
}

/* ---- FB Groups ---- */

async function loadFBGroups() {
  const items = await api.get('/api/fb-groups');
  const c = document.getElementById('listFB');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No groups.</p>'; return; }
  c.innerHTML = items.map(g => `<div class="admin-item">
    <div class="admin-item-info"><h4>${esc(g.name)}</h4><p>${esc(g.description || 'No description')}</p></div>
    <div class="admin-item-actions"><button class="btn-icon delete" data-del-fb="${g.id}" title="Delete">✕</button></div>
  </div>`).join('');
  c.querySelectorAll('[data-del-fb]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this group?')) return;
      await api.del(`/api/admin/fb-groups/${btn.dataset.delFb}`);
      loadFBGroups();
      showToast('Removed.');
    });
  });
}

/* ---- Links ---- */

async function loadLinks() {
  const items = await api.get('/api/links');
  const c = document.getElementById('listLinks');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No links.</p>'; return; }
  c.innerHTML = items.map(l => `<div class="admin-item">
    <div class="admin-item-info"><h4>${l.icon || '🔗'} ${esc(l.name)}</h4><p>${esc(l.url)}</p></div>
    <div class="admin-item-actions"><button class="btn-icon delete" data-del-link="${l.id}" title="Delete">✕</button></div>
  </div>`).join('');
  c.querySelectorAll('[data-del-link]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this link?')) return;
      await api.del(`/api/admin/links/${btn.dataset.delLink}`);
      loadLinks();
      showToast('Removed.');
    });
  });
}

/* ---- Docs ---- */

async function loadDocs() {
  const items = await api.get('/api/documents');
  const c = document.getElementById('listDocs');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No documents.</p>'; return; }
  c.innerHTML = items.map(d => `<div class="admin-item">
    <div class="admin-item-info"><h4>${d.icon || '📄'} ${esc(d.name)}</h4><p>${esc(d.url)}</p></div>
    <div class="admin-item-actions"><button class="btn-icon delete" data-del-doc="${d.id}" title="Delete">✕</button></div>
  </div>`).join('');
  c.querySelectorAll('[data-del-doc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this document?')) return;
      await api.del(`/api/admin/documents/${btn.dataset.delDoc}`);
      loadDocs();
      showToast('Removed.');
    });
  });
}

/* ---- Gallery ---- */

async function loadGallery() {
  const items = await api.get('/api/gallery');
  const c = document.getElementById('listGallery');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No photos.</p>'; return; }
  c.innerHTML = items.map(g => `<div class="admin-item">
    <div class="admin-item-info"><h4>📸 ${esc(g.caption)}</h4><p>${g.url ? (g.filename ? 'Uploaded' : 'External URL') : 'No image'}</p></div>
    <div class="admin-item-actions"><button class="btn-icon delete" data-del-photo="${g.id}" title="Delete">✕</button></div>
  </div>`).join('');
  c.querySelectorAll('[data-del-photo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this photo?')) return;
      await api.del(`/api/admin/gallery/${btn.dataset.delPhoto}`);
      loadGallery();
      showToast('Removed.');
    });
  });
}

/* ---- Messages ---- */

async function loadMessages() {
  const items = await api.get('/api/admin/messages');
  const c = document.getElementById('listMessages');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No messages yet.</p>'; return; }
  c.innerHTML = items.map(m => {
    const date = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const unread = m.is_read ? '' : 'border-left:4px solid var(--scout-gold);';
    return `<div class="admin-item" style="${unread}">
      <div class="admin-item-info" style="flex:1">
        <h4>${esc(m.name)} — ${esc(m.subject || 'No subject')}</h4>
        <p>${esc(m.email)} · ${date}</p>
        <p style="margin-top:6px;color:var(--text-dark)">${esc(m.message)}</p>
      </div>
      <div class="admin-item-actions" style="flex-direction:column">
        ${!m.is_read ? `<button class="btn-icon" data-read-msg="${m.id}" title="Mark Read">✓</button>` : ''}
        <button class="btn-icon delete" data-del-msg="${m.id}" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');
  c.querySelectorAll('[data-read-msg]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.put(`/api/admin/messages/${btn.dataset.readMsg}/read`, {});
      loadMessages();
      updateDashboard();
    });
  });
  c.querySelectorAll('[data-del-msg]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      await api.del(`/api/admin/messages/${btn.dataset.delMsg}`);
      loadMessages();
      updateDashboard();
      showToast('Deleted.');
    });
  });
}

/* ---- Settings ---- */

async function loadSettings() {
  const s = await api.get('/api/settings');
  document.getElementById('setDay').value = s.meeting_day || '';
  document.getElementById('setTime').value = s.meeting_time || '';
  document.getElementById('setLoc').value = s.location || '';
  document.getElementById('setSM').value = s.scoutmaster_name || '';
  document.getElementById('setEmail').value = s.troop_email || '';
  document.getElementById('setCharter').value = s.charter_info || '';
  document.getElementById('setEagle').value = s.eagle_info || '';
  document.getElementById('setAbout').value = s.about_content || '';
}

/* ---- Forms ---- */

function initForms() {
  // Announcements
  document.getElementById('annForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.post('/api/admin/announcements', {
      title: document.getElementById('annTitle').value,
      content: document.getElementById('annContent').value,
      priority: document.getElementById('annPriority').value,
      category: document.getElementById('annCategory').value,
    });
    e.target.reset();
    loadAnnouncements();
    updateDashboard();
    showToast('Announcement posted!');
  });

  // Events
  document.getElementById('evtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.post('/api/admin/events', {
      title: document.getElementById('evtTitle').value,
      date: document.getElementById('evtDate').value,
      end_date: document.getElementById('evtEndDate').value || null,
      time: document.getElementById('evtTime').value,
      type: document.getElementById('evtType').value,
      location: document.getElementById('evtLocation').value,
      description: document.getElementById('evtDesc').value,
    });
    e.target.reset();
    loadEvents();
    updateDashboard();
    showToast('Event added!');
  });

  // FB Groups
  document.getElementById('fbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.post('/api/admin/fb-groups', {
      name: document.getElementById('fbName').value,
      url: document.getElementById('fbUrl').value,
      description: document.getElementById('fbDesc').value,
    });
    e.target.reset();
    loadFBGroups();
    updateDashboard();
    showToast('Group added!');
  });

  // Links
  document.getElementById('linkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.post('/api/admin/links', {
      name: document.getElementById('linkName').value,
      url: document.getElementById('linkUrl').value,
      icon: document.getElementById('linkIcon').value || '🔗',
    });
    e.target.reset();
    loadLinks();
    showToast('Link added!');
  });

  // Docs
  document.getElementById('docForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.post('/api/admin/documents', {
      name: document.getElementById('docName').value,
      url: document.getElementById('docUrl').value,
      icon: document.getElementById('docIcon').value || '📄',
    });
    e.target.reset();
    loadDocs();
    showToast('Document added!');
  });

  // Gallery (file upload)
  document.getElementById('galleryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('photoFile');
    const urlInput = document.getElementById('photoUrl');
    const caption = document.getElementById('photoCaption').value;

    if (fileInput.files.length > 0) {
      const fd = new FormData();
      fd.append('photo', fileInput.files[0]);
      fd.append('caption', caption);
      await api.upload('/api/admin/gallery', fd);
    } else {
      await api.post('/api/admin/gallery', { caption, url: urlInput.value || null });
    }
    e.target.reset();
    loadGallery();
    showToast('Photo added!');
  });

  // Settings
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.put('/api/admin/settings', {
      meeting_day: document.getElementById('setDay').value,
      meeting_time: document.getElementById('setTime').value,
      location: document.getElementById('setLoc').value,
      scoutmaster_name: document.getElementById('setSM').value,
      troop_email: document.getElementById('setEmail').value,
      charter_info: document.getElementById('setCharter').value,
      eagle_info: document.getElementById('setEagle').value,
      about_content: document.getElementById('setAbout').value,
    });
    showToast('Settings saved!');
  });

  // Password
  document.getElementById('passForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('passNew').value;
    const confirm = document.getElementById('passConfirm').value;
    if (newPass !== confirm) { showToast('Passwords do not match.', true); return; }
    const res = await api.put('/api/admin/password', {
      current_password: document.getElementById('passCur').value,
      new_password: newPass,
    });
    if (res.error) { showToast(res.error, true); return; }
    e.target.reset();
    showToast('Password changed!');
  });
}
