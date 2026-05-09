let isAuthenticated = false;
let allUploads = [];
let currentFilter = 'all';
let pollInterval = null;

// ============ Auth ============
document.getElementById('admin-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

async function login() {
  const password = document.getElementById('admin-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      isAuthenticated = true;
      sessionStorage.setItem('admin_auth', 'true');
      document.getElementById('login-overlay').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      loadDashboard();
      startPolling();
    } else {
      errorEl.textContent = 'Yanlış şifre!';
      document.getElementById('admin-password').value = '';
    }
  } catch (e) {
    errorEl.textContent = 'Bağlantı hatası!';
  }
}

function logout() {
  sessionStorage.removeItem('admin_auth');
  stopPolling();
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('admin-password').value = '';
}

// Auto-login if previously authenticated
if (sessionStorage.getItem('admin_auth') === 'true') {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  isAuthenticated = true;
  loadDashboard();
  startPolling();
}

// ============ Dashboard ============
async function loadDashboard() {
  await Promise.all([loadStats(), loadUploads()]);
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    const stats = await res.json();
    document.getElementById('stat-photos').textContent = stats.totalPhotos;
    document.getElementById('stat-videos').textContent = stats.totalVideos;
    document.getElementById('stat-total').textContent = stats.totalUploads;
    document.getElementById('stat-tables').textContent = stats.activeTables;
    document.getElementById('stat-guests').textContent = stats.totalSessions;

    // Update table filter buttons
    buildTableFilters(stats.perTable);
  } catch (e) {
    console.error('Stats error:', e);
  }
}

function buildTableFilters(perTable) {
  const scroll = document.getElementById('filter-scroll');
  scroll.innerHTML = '';
  for (let i = 1; i <= 40; i++) {
    const tableData = perTable.find(t => t.table_number === i);
    const count = tableData ? tableData.count : 0;
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (currentFilter === String(i) ? ' active' : '');
    btn.dataset.table = i;
    btn.textContent = `Masa ${i}` + (count > 0 ? ` (${count})` : '');
    btn.onclick = () => filterTable(String(i), btn);
    if (count > 0) {
      btn.style.borderColor = 'rgba(212,168,83,0.2)';
    }
    scroll.appendChild(btn);
  }
}

async function loadUploads() {
  try {
    const res = await fetch('/api/admin/uploads');
    allUploads = await res.json();
    renderGallery();
  } catch (e) {
    console.error('Uploads error:', e);
  }
}

function filterTable(table, btn) {
  currentFilter = table;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderGallery();
}

function renderGallery() {
  const gallery = document.getElementById('gallery');
  const emptyEl = document.getElementById('gallery-empty');

  const filtered = currentFilter === 'all'
    ? allUploads
    : allUploads.filter(u => u.table_number === parseInt(currentFilter));

  if (filtered.length === 0) {
    gallery.innerHTML = '';
    gallery.appendChild(emptyEl);
    emptyEl.style.display = 'block';
    return;
  }

  // Group by table
  const grouped = {};
  filtered.forEach(u => {
    if (!grouped[u.table_number]) grouped[u.table_number] = [];
    grouped[u.table_number].push(u);
  });

  gallery.innerHTML = '';
  Object.keys(grouped).sort((a, b) => a - b).forEach(tableNum => {
    const section = document.createElement('div');
    section.className = 'table-section';

    const header = document.createElement('div');
    header.className = 'table-section-header';
    header.innerHTML = `
      <span class="table-section-title">Masa ${tableNum}</span>
      <span class="table-section-count">${grouped[tableNum].length} dosya</span>
    `;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'media-grid';

    grouped[tableNum].forEach(upload => {
      const item = document.createElement('div');
      item.className = 'media-item';
      item.onclick = (e) => {
        if (e.target.closest('.media-delete')) return;
        openLightbox(upload);
      };

      const url = `/uploads/masa-${upload.table_number}/${upload.file_name}`;
      if (upload.file_type.startsWith('image/')) {
        item.innerHTML = `<img src="${url}" loading="lazy" alt="Fotoğraf">`;
      } else {
        item.innerHTML = `<video src="${url}" preload="metadata"></video>
          <div class="media-badge">🎬 Video</div>`;
      }

      // Guest info overlay
      const guestInfo = [];
      if (upload.seat_number) guestInfo.push(`K${upload.seat_number}`);
      if (upload.guest_name) guestInfo.push(escapeHtml(upload.guest_name));
      if (guestInfo.length > 0) {
        item.innerHTML += `<div class="media-guest">${guestInfo.join(' • ')}</div>`;
      }

      item.innerHTML += `<button class="media-delete" onclick="deleteUpload(event, ${upload.id})" title="Sil">✕</button>`;
      grid.appendChild(item);
    });

    section.appendChild(grid);
    gallery.appendChild(section);
  });
}

// ============ Lightbox ============
function openLightbox(upload) {
  const lightbox = document.getElementById('lightbox');
  const content = document.getElementById('lightbox-content');
  const info = document.getElementById('lightbox-info');
  const url = `/uploads/masa-${upload.table_number}/${upload.file_name}`;

  if (upload.file_type.startsWith('image/')) {
    content.innerHTML = `<img src="${url}" alt="Fotoğraf">`;
  } else {
    content.innerHTML = `<video src="${url}" controls autoplay></video>`;
  }

  let infoText = `Masa ${upload.table_number}`;
  if (upload.seat_number) infoText += ` — Koltuk ${upload.seat_number}`;
  if (upload.guest_name) infoText += ` • ${escapeHtml(upload.guest_name)}`;
  if (upload.guest_message) infoText += `<br>"${escapeHtml(upload.guest_message)}"`;
  infoText += `<br><small>${new Date(upload.created_at).toLocaleString('tr-TR')}</small>`;
  info.innerHTML = infoText;

  lightbox.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLightbox(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('lightbox-close')) return;
  document.getElementById('lightbox').style.display = 'none';
  document.body.style.overflow = '';
  // Stop any playing videos
  const vid = document.querySelector('.lightbox-content video');
  if (vid) vid.pause();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ============ Delete ============
async function deleteUpload(e, id) {
  e.stopPropagation();
  if (!confirm('Bu dosyayı silmek istediğinize emin misiniz?')) return;

  try {
    const res = await fetch(`/api/admin/uploads/${id}`, { method: 'DELETE' });
    if (res.ok) {
      allUploads = allUploads.filter(u => u.id !== id);
      renderGallery();
      loadStats();
    }
  } catch (e) {
    console.error('Delete error:', e);
  }
}

// ============ Download ============
function downloadAll() {
  window.location.href = '/api/admin/download-all';
}

// ============ Polling ============
function startPolling() {
  pollInterval = setInterval(() => {
    if (isAuthenticated) loadDashboard();
  }, 10000); // 10 second refresh
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
}

// ============ Helpers ============
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
