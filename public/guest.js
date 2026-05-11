// ============ State ============
let tableNumber = null;
let seatNumber = null;
let sessionId = null;
let uploadedCount = 0;
let maxUploads = 5;
let isUploading = false;
let seatsPerZone = 10;
let appConfig = null;

// ============ Init ============
document.addEventListener('DOMContentLoaded', async () => {
  // Get zone number from URL (/masa/:number)
  const pathParts = window.location.pathname.split('/');
  const masaIdx = pathParts.indexOf('masa');
  if (masaIdx !== -1 && pathParts[masaIdx + 1]) {
    tableNumber = parseInt(pathParts[masaIdx + 1]);
  }
  if (!tableNumber || isNaN(tableNumber)) {
    tableNumber = 1;
  }
  document.getElementById('table-number').textContent = tableNumber;
  document.getElementById('seat-table-num').textContent = tableNumber;

  // Fetch config from server
  try {
    const res = await fetch('/api/config');
    appConfig = await res.json();
    applyConfig(appConfig);
  } catch (e) {
    console.error('Config fetch error:', e);
  }

  // Build seat grid
  buildSeatGrid();

  // Create particles
  createParticles();

  // Setup drag & drop
  setupDragDrop();

  // Setup file inputs
  document.getElementById('input-camera').addEventListener('change', handleFiles);
  document.getElementById('input-gallery').addEventListener('change', handleFiles);

  // Message char counter
  const msgInput = document.getElementById('guest-message');
  if (msgInput) {
    msgInput.addEventListener('input', () => {
      document.getElementById('msg-count').textContent = msgInput.value.length;
    });
  }
});

// ============ Apply Config ============
function applyConfig(cfg) {
  if (!cfg) return;

  const labels = cfg.labels || {};
  maxUploads = cfg.maxUploads || 5;
  seatsPerZone = cfg.seatsPerZone || 10;

  // Page title
  document.title = `${labels.icon || ''} ${cfg.eventName}`.trim();

  // Welcome screen
  const eventIcon = document.getElementById('event-icon');
  if (eventIcon) eventIcon.textContent = labels.emoji || labels.icon || '';

  const eventName = document.getElementById('event-name');
  if (eventName) eventName.textContent = cfg.eventName;

  const welcomeText = document.getElementById('welcome-text');
  if (welcomeText) welcomeText.textContent = labels.welcome || 'Hoş geldiniz!';

  const welcomeDesc = document.getElementById('welcome-desc');
  if (welcomeDesc) {
    welcomeDesc.innerHTML = `Anılarınızı bizimle paylaşın!<br>📸 ${maxUploads} adet fotoğraf veya video yükleyebilirsiniz.`;
  }

  // Zone/seat labels
  const zoneLabels = document.querySelectorAll('#zone-label, #zone-label-2');
  zoneLabels.forEach(el => { el.textContent = labels.zone || 'Masa'; });

  // Seat screen
  const seatTitle = document.getElementById('seat-title');
  if (seatTitle) seatTitle.textContent = `${labels.seat || 'Yer'}inizi Seçin`;

  const seatPrompt = document.getElementById('seat-prompt');
  if (seatPrompt) seatPrompt.textContent = `Hangi ${(labels.seat || 'yer').toLowerCase()}te oturuyorsunuz?`;

  const seatEmoji = document.getElementById('seat-emoji');
  if (seatEmoji) seatEmoji.textContent = labels.zone === 'Bölge' ? '📍' : '🪑';

  // Thanks screen
  const thanksEmoji = document.getElementById('thanks-emoji');
  if (thanksEmoji) thanksEmoji.textContent = labels.emoji || '✨';

  const thanksText = document.getElementById('thanks-text');
  if (thanksText) thanksText.textContent = labels.thanks || 'Paylaştığınız anılar bizim için çok değerli.';

  // Remaining count
  document.getElementById('remaining-count').textContent = maxUploads;

  // Branding colors
  if (cfg.primaryColor) {
    document.documentElement.style.setProperty('--gold', cfg.primaryColor);
  }
  if (cfg.secondaryColor) {
    document.documentElement.style.setProperty('--bg-primary', cfg.secondaryColor);
  }

  // Rebuild seat grid with correct count
  buildSeatGrid();
}

// ============ Seat Grid ============
function buildSeatGrid() {
  const grid = document.getElementById('seat-grid');
  grid.innerHTML = '';

  const seatLabel = (appConfig && appConfig.labels && appConfig.labels.seat) || 'Koltuk';

  for (let i = 1; i <= seatsPerZone; i++) {
    const btn = document.createElement('button');
    btn.className = 'seat-btn';
    btn.dataset.seat = i;
    btn.innerHTML = `
      <span class="seat-num">${i}</span>
      <span class="seat-label">${seatLabel}</span>
    `;

    // Check if this seat is already taken (in localStorage)
    const existingSession = localStorage.getItem(`event_t${tableNumber}_s${i}`);
    if (existingSession) {
      btn.classList.add('taken');
    }

    btn.addEventListener('click', () => selectSeat(i, btn));
    grid.appendChild(btn);
  }
}

function selectSeat(num, btn) {
  if (btn.classList.contains('taken')) {
    // If this seat was taken by the current device, allow re-entry
    const existingSession = localStorage.getItem(`event_t${tableNumber}_s${num}`);
    if (existingSession) {
      seatNumber = num;
      sessionId = existingSession;
      initSession();
      goToInfo();
    }
    return;
  }

  // Select this seat
  document.querySelectorAll('.seat-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  seatNumber = num;

  // Create session for this seat
  sessionId = generateUUID();
  localStorage.setItem(`event_t${tableNumber}_s${num}`, sessionId);

  // Short delay then go to info
  setTimeout(() => goToInfo(), 300);
}

async function initSession() {
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, tableNumber, seatNumber })
    });
    const data = await res.json();
    uploadedCount = data.uploadCount || 0;
    maxUploads = data.maxUploads || 5;
    updateRemaining();

    if (uploadedCount >= maxUploads) {
      showScreen('screen-thanks');
      document.getElementById('final-count').textContent = uploadedCount;
    }
  } catch (e) {
    console.error('Session init error:', e);
  }
}

// ============ Navigation ============
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  if (screenId === 'screen-thanks') {
    launchConfetti();
  }
}

function goToWelcome() { showScreen('screen-welcome'); }

function goToSeatSelect() {
  buildSeatGrid();
  showScreen('screen-seat');
}

function goToInfo() {
  if (!seatNumber) return;

  const zoneLabel = (appConfig && appConfig.labels && appConfig.labels.zone) || 'Masa';
  const seatLabel = (appConfig && appConfig.labels && appConfig.labels.seat) || 'Koltuk';

  document.getElementById('selected-seat-badge').textContent =
    `${zoneLabel} ${tableNumber} — ${seatLabel} ${seatNumber}`;

  initSession();
  showScreen('screen-info');
}

async function goToUpload() {
  const nameInput = document.getElementById('guest-name');
  const name = nameInput.value.trim();
  const message = document.getElementById('guest-message').value.trim();

  if (!name) {
    nameInput.classList.add('error');
    document.getElementById('name-error').classList.add('visible');
    nameInput.focus();
    return;
  }
  nameInput.classList.remove('error');
  document.getElementById('name-error').classList.remove('visible');

  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId, tableNumber, seatNumber,
        guestName: name, guestMessage: message
      })
    });
  } catch (e) {
    console.error('Session update error:', e);
  }

  showScreen('screen-upload');
}

function finishUploading() {
  document.getElementById('final-count').textContent = uploadedCount;
  showScreen('screen-thanks');
}

// ============ File Handling ============
function setupDragDrop() {
  const zone = document.getElementById('upload-zone');
  ['dragenter', 'dragover'].forEach(e => {
    zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(e => {
    zone.addEventListener(e, (ev) => { ev.preventDefault(); zone.classList.remove('drag-over'); });
  });
  zone.addEventListener('drop', (ev) => {
    const files = Array.from(ev.dataTransfer.files);
    processFiles(files);
  });
}

function handleFiles(e) {
  const files = Array.from(e.target.files);
  processFiles(files);
  e.target.value = '';
}

async function processFiles(files) {
  if (isUploading) return;

  const remaining = maxUploads - uploadedCount;
  if (remaining <= 0) {
    alert('Yükleme limitinize ulaştınız!');
    return;
  }

  const filesToUpload = files.slice(0, remaining);
  const validFiles = filesToUpload.filter(f =>
    f.type.startsWith('image/') || f.type.startsWith('video/')
  );

  if (validFiles.length === 0) {
    alert('Lütfen fotoğraf veya video dosyası seçin.');
    return;
  }

  isUploading = true;
  const progressEl = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  progressEl.style.display = 'block';

  const guestName = document.getElementById('guest-name').value.trim();
  const guestMessage = document.getElementById('guest-message').value.trim();

  for (let i = 0; i < validFiles.length; i++) {
    const file = validFiles[i];
    const previewId = addPreview(file);

    progressText.textContent = `Yükleniyor ${i + 1}/${validFiles.length}...`;
    progressFill.style.width = `${((i) / validFiles.length) * 100}%`;

    try {
      const formData = new FormData();
      formData.append('media', file);
      formData.append('sessionId', sessionId);
      formData.append('seatNumber', seatNumber);
      formData.append('guestName', guestName);
      formData.append('guestMessage', guestMessage);

      const res = await fetch(`/api/upload/${tableNumber}`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        uploadedCount = data.uploadCount;
        updatePreviewStatus(previewId, 'done');
        updateRemaining();
      } else {
        updatePreviewStatus(previewId, 'error');
        if (data.error) {
          progressText.textContent = data.error;
        }
      }
    } catch (e) {
      updatePreviewStatus(previewId, 'error');
      console.error('Upload failed:', e);
    }

    progressFill.style.width = `${((i + 1) / validFiles.length) * 100}%`;
  }

  progressText.textContent = 'Tamamlandı!';
  isUploading = false;

  const remaining2 = maxUploads - uploadedCount;
  if (remaining2 <= 0) {
    setTimeout(() => finishUploading(), 1500);
  } else {
    document.getElementById('btn-finish').style.display = 'flex';
  }

  setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
}

function addPreview(file) {
  const area = document.getElementById('preview-area');
  const id = 'preview-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const item = document.createElement('div');
  item.className = 'preview-item';
  item.id = id;

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    item.appendChild(img);
  } else {
    const vid = document.createElement('video');
    vid.src = URL.createObjectURL(file);
    vid.muted = true;
    item.appendChild(vid);
  }

  const overlay = document.createElement('div');
  overlay.className = 'status-overlay uploading';
  overlay.innerHTML = '<div class="spinner"></div>';
  item.appendChild(overlay);

  area.appendChild(item);
  return id;
}

function updatePreviewStatus(previewId, status) {
  const item = document.getElementById(previewId);
  if (!item) return;
  const overlay = item.querySelector('.status-overlay');
  if (!overlay) return;
  overlay.className = 'status-overlay ' + status;
  overlay.innerHTML = status === 'done' ? '✅' : '❌';
  if (status === 'done') {
    setTimeout(() => { overlay.style.opacity = '0'; }, 1500);
  }
}

function updateRemaining() {
  const remaining = maxUploads - uploadedCount;
  const el = document.getElementById('remaining-count');
  if (el) el.textContent = remaining;

  if (remaining <= 0) {
    const zone = document.getElementById('upload-zone');
    if (zone) zone.style.display = 'none';
  }
}

// ============ Particles ============
function createParticles() {
  const container = document.getElementById('particles');
  const count = window.innerWidth < 480 ? 15 : 30;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 6 + 's';
    p.style.animationDuration = (4 + Math.random() * 4) + 's';
    p.style.width = (2 + Math.random() * 3) + 'px';
    p.style.height = p.style.width;
    container.appendChild(p);
  }
}

// ============ Confetti ============
function launchConfetti() {
  const container = document.getElementById('confetti');
  container.innerHTML = '';
  const primaryColor = (appConfig && appConfig.primaryColor) || '#d4a853';
  const colors = [primaryColor, '#f0d48a', '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff8fab'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 2 + 's';
    piece.style.animationDuration = (2 + Math.random() * 2) + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    container.appendChild(piece);
  }
}

// ============ UUID Generator ============
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
