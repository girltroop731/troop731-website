/* Troop 731 — Public Site */

const API = {
  get: (url) => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
  post: (url, data) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
};

let allEvents = [];

document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initModal();
  document.getElementById('footerYear').textContent = new Date().getFullYear();

  // Load all sections in parallel
  const [announcements, events, fbGroups, links, docs, gallery, settings] = await Promise.all([
    API.get('/api/announcements'),
    API.get('/api/events'),
    API.get('/api/fb-groups'),
    API.get('/api/links'),
    API.get('/api/documents'),
    API.get('/api/gallery'),
    API.get('/api/settings'),
  ]);

  allEvents = events;
  renderAnnouncements(announcements);
  renderCalendar();
  renderEvents(events);
  renderFBGroups(fbGroups);
  renderLinks(links);
  renderDocuments(docs);
  renderGallery(gallery);
  applySettings(settings);
  initContactForm();
});

/* ---- Navigation ---- */

function initNav() {
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  toggle.addEventListener('click', () => {
    links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', links.classList.contains('open'));
  });
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));

  const sections = document.querySelectorAll('section[id]');
  window.addEventListener('scroll', () => {
    const y = window.scrollY + 100;
    sections.forEach(s => {
      const link = links.querySelector(`a[href="#${s.id}"]`);
      if (link) link.classList.toggle('active', y >= s.offsetTop && y < s.offsetTop + s.offsetHeight);
    });
  });
}

/* ---- Announcements ---- */

function renderAnnouncements(items) {
  const c = document.getElementById('announcementsContainer');
  if (!items.length) { hide(c); show('noAnnouncements'); return; }

  c.innerHTML = items.map(a => {
    const prioClass = a.priority === 'high' ? 'priority-high' : 'priority-normal';
    const badge = a.priority === 'high' ? 'badge-important' : (a.category === 'event' ? 'badge-event' : 'badge-info');
    const label = a.priority === 'high' ? 'Important' : (a.category === 'event' ? 'Event' : 'Info');
    return `<div class="announcement-card ${prioClass}">
      <span class="announcement-badge ${badge}">${label}</span>
      <div class="announcement-date">${fmtDate(a.created_at)}</div>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.content)}</p>
    </div>`;
  }).join('');
}

/* ---- Calendar ---- */

let calDate = new Date();

function renderCalendar() {
  const year = calDate.getFullYear(), month = calDate.getMonth();
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthYear').textContent = `${names[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const today = new Date();

  const eventDays = new Set();
  allEvents.forEach(e => {
    const d = new Date(e.date + 'T00:00:00');
    if (d.getMonth() === month && d.getFullYear() === year) eventDays.add(d.getDate());
  });

  let html = '';
  for (let i = firstDay - 1; i >= 0; i--) html += `<div class="cal-day other-month">${prevDays - i}</div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const has = eventDays.has(d);
    const cls = `cal-day${isToday ? ' today' : ''}${has ? ' has-event' : ''}`;
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const attr = has ? ` data-date="${dateStr}" tabindex="0" role="button" aria-label="${names[month]} ${d}, has event"` : '';
    html += `<div class="${cls}"${attr}>${d}</div>`;
  }
  const total = firstDay + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= rem; i++) html += `<div class="cal-day other-month">${i}</div>`;

  document.getElementById('calendarDays').innerHTML = html;

  document.querySelectorAll('.cal-day.has-event').forEach(el => {
    const scrollToEvent = () => {
      const card = document.querySelector(`.event-card[data-date="${el.dataset.date}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.outline = '3px solid var(--scout-gold)';
        setTimeout(() => card.style.outline = '', 2000);
      }
    };
    el.addEventListener('click', scrollToEvent);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToEvent(); }
    });
  });

  document.getElementById('calPrev').onclick = () => { calDate.setMonth(calDate.getMonth() - 1); renderCalendar(); };
  document.getElementById('calNext').onclick = () => { calDate.setMonth(calDate.getMonth() + 1); renderCalendar(); };
}

/* ---- Events ---- */

function renderEvents(items) {
  const c = document.getElementById('eventsContainer');
  const now = new Date(); now.setHours(0,0,0,0);
  const upcoming = items.filter(e => new Date(e.date + 'T23:59:59') >= now).sort((a,b) => new Date(a.date) - new Date(b.date));

  if (!upcoming.length) { hide(c); show('noEvents'); return; }

  c.innerHTML = upcoming.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    const mon = d.toLocaleDateString('en-US', { month: 'short' });
    const typeClass = `type-${e.type || 'meeting'}`;
    const typeLabel = (e.type || 'meeting').charAt(0).toUpperCase() + (e.type || 'meeting').slice(1);
    return `<div class="event-card" data-date="${e.date}" data-id="${e.id}" tabindex="0" role="button">
      <div class="event-date-badge"><div class="month">${mon}</div><div class="day">${d.getDate()}</div></div>
      <div class="event-details">
        <h4>${esc(e.title)}</h4>
        <div class="event-meta"><span>${esc(e.time || '')}</span><span>${esc(e.location || '')}</span></div>
        <span class="event-type-badge ${typeClass}">${typeLabel}</span>
      </div>
    </div>`;
  }).join('');

  c.querySelectorAll('.event-card').forEach(card => {
    const openModal = () => {
      const ev = items.find(e => String(e.id) === card.dataset.id);
      if (ev) showEventModal(ev);
    };
    card.addEventListener('click', openModal);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); }
    });
  });
}

/* ---- Modal ---- */

let modalTriggerElement = null;

function initModal() {
  const overlay = document.getElementById('eventModal');
  const closeBtn = document.getElementById('modalClose');
  const modal = overlay.querySelector('.modal');

  const closeModal = () => {
    overlay.classList.remove('active');
    if (modalTriggerElement) { modalTriggerElement.focus(); modalTriggerElement = null; }
  };

  closeBtn.onclick = closeModal;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('active')) closeModal();
  });

  // Focus trap
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !overlay.classList.contains('active')) return;
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

function showEventModal(e) {
  modalTriggerElement = document.activeElement;
  document.getElementById('modalTitle').textContent = e.title;
  const d = new Date(e.date + 'T00:00:00');
  let ds = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (e.end_date) {
    const ed = new Date(e.end_date + 'T00:00:00');
    ds += ` – ${ed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
  }
  if (e.time) ds += ` | ${e.time}`;
  document.getElementById('modalDate').textContent = ds;
  document.getElementById('modalLocation').textContent = e.location ? `Location: ${e.location}` : '';
  document.getElementById('modalDescription').innerHTML = `<p>${esc(e.description || 'No additional details.')}</p>`;
  document.getElementById('eventModal').classList.add('active');
  document.getElementById('modalClose').focus();
}

/* ---- Facebook Groups ---- */

function renderFBGroups(items) {
  const c = document.getElementById('fbGroupsContainer');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No groups configured.</p>'; return; }
  c.innerHTML = items.map(g => `<a href="${escAttr(g.url)}" target="_blank" rel="noopener" class="fb-group-card">
    <div class="fb-icon">f</div>
    <div class="fb-group-info"><h4>${esc(g.name)}</h4><p>${esc(g.description || '')}</p></div>
    <span class="arrow">→</span>
  </a>`).join('');
}

/* ---- Links ---- */

function renderLinks(items) {
  const c = document.getElementById('linksContainer');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No links.</p>'; return; }
  c.innerHTML = items.map(l => `<a href="${escAttr(l.url)}" target="_blank" rel="noopener" class="link-card">
    <span class="link-icon">${esc(l.icon || '🔗')}</span><span>${esc(l.name)}</span>
  </a>`).join('');
}

/* ---- Documents ---- */

function renderDocuments(items) {
  const c = document.getElementById('documentsContainer');
  if (!items.length) { c.innerHTML = '<p class="empty-state">No documents yet.</p>'; return; }
  c.innerHTML = items.map(d => `<a href="${escAttr(d.url)}" target="_blank" rel="noopener" class="document-item">
    <span class="doc-icon">${esc(d.icon || '📄')}</span><span>${esc(d.name)}</span>
  </a>`).join('');
}

/* ---- Gallery Carousel ---- */

function renderGallery(items) {
  const container = document.getElementById('galleryContainer');
  const track = document.getElementById('carouselTrack');
  const dots = document.getElementById('carouselDots');
  const photos = items.filter(g => g.url).slice(0, 10);
  if (!photos.length) { hide(container); show('noPhotos'); return; }

  let current = 0;

  track.innerHTML = photos.map((g, i) =>
    `<div class="carousel-slide${i === 0 ? ' active' : ''}" data-index="${i}">
      <img src="${escAttr(g.url)}" alt="${escAttr(g.caption || 'Troop photo')}" loading="lazy">
    </div>`
  ).join('');

  dots.innerHTML = photos.map((_, i) =>
    `<button class="carousel-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Go to photo ${i + 1}"></button>`
  ).join('');

  function goTo(idx) {
    current = (idx + photos.length) % photos.length;
    track.querySelectorAll('.carousel-slide').forEach((s, i) => s.classList.toggle('active', i === current));
    dots.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === current));
  }

  document.getElementById('carouselPrev').addEventListener('click', () => goTo(current - 1));
  document.getElementById('carouselNext').addEventListener('click', () => goTo(current + 1));
  dots.addEventListener('click', (e) => {
    if (e.target.dataset.index != null) goTo(+e.target.dataset.index);
  });

  // Auto-rotate every 8 seconds when visible
  let autoTimer = null;
  function startAuto() { if (!autoTimer) autoTimer = setInterval(() => goTo(current + 1), 8000); }
  function stopAuto() { clearInterval(autoTimer); autoTimer = null; }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { entry.isIntersecting ? startAuto() : stopAuto(); }, { threshold: 0.3 }).observe(container);
  } else {
    startAuto();
  }

  // Pause on hover/focus
  container.addEventListener('mouseenter', stopAuto);
  container.addEventListener('mouseleave', startAuto);
  container.addEventListener('focusin', stopAuto);
  container.addEventListener('focusout', startAuto);

  // Lightbox — always open the currently visible photo
  const lightbox = document.getElementById('photoLightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');

  track.addEventListener('click', () => {
    const photo = photos[current];
    lightboxImg.src = photo.url;
    lightboxImg.alt = photo.caption || 'Troop photo';
    lightboxCaption.textContent = photo.caption || '';
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    stopAuto();
  });

  function closeLightbox() {
    lightbox.style.display = 'none';
    document.body.style.overflow = '';
    startAuto();
  }

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (lightbox.style.display === 'flex' && e.key === 'Escape') closeLightbox();
  });
}

/* ---- Settings ---- */

function applySettings(s) {
  const meeting = `${s.meeting_day || ''}, ${s.meeting_time || ''}`;
  setText('meetingInfo', meeting);
  setText('contactMeetingInfo', meeting);
  setText('locationInfo', s.location);
  setText('contactLocation', s.location);
  setText('charteredInfo', s.charter_info);
  setText('scoutmasterName', s.scoutmaster_name);
  setText('eagleCount', s.eagle_info);
  if (s.about_content) document.getElementById('aboutContent').innerHTML = s.about_content;
  const email = document.getElementById('troopEmail');
  if (email && s.troop_email) { email.textContent = s.troop_email; email.href = `mailto:${s.troop_email}`; }
}

/* ---- Contact Form ---- */

function initContactForm() {
  document.getElementById('contactForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await API.post('/api/contact', data);
      form.reset();
      showToast('Message sent! We\'ll get back to you soon.');
    } catch {
      showToast('Failed to send. Please try again.', true);
    }
  });
}

/* ---- Helpers ---- */

function fmtDate(str) {
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function escAttr(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setText(id, t) { const el = document.getElementById(id); if (el && t) el.textContent = t; }
function show(id) { document.getElementById(id).style.display = 'block'; }
function hide(el) { if (typeof el === 'string') el = document.getElementById(el); el.style.display = 'none'; }

function showToast(msg, isError = false) {
  const old = document.querySelector('.toast'); if (old) old.remove();
  const t = document.createElement('div');
  t.className = `toast${isError ? ' error' : ''}`;
  t.setAttribute('role', 'alert');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
}
