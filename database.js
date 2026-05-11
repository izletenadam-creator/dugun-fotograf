const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const DB_PATH = config.dbPath;

let data = {
  sessions: {},
  uploads: [],
  nextId: 1,
};

function loadData() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      data = JSON.parse(raw);
    } else {
      // Migration: check for old wedding-data.json
      const oldPath = path.join(path.dirname(DB_PATH), 'wedding-data.json');
      if (fs.existsSync(oldPath)) {
        console.log('📦 wedding-data.json bulundu, event-data.json olarak taşınıyor...');
        const raw = fs.readFileSync(oldPath, 'utf8');
        data = JSON.parse(raw);
        saveData(); // Write to new path
      }
    }
  } catch (e) {
    console.error('Failed to load data:', e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save data:', e.message);
  }
}

loadData();

// ============ Session Operations ============
function getOrCreateSession(sessionId, tableNumber, seatNumber, maxUploads) {
  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      session_id: sessionId,
      table_number: tableNumber,
      seat_number: seatNumber || null,
      guest_name: '',
      guest_message: '',
      upload_count: 0,
      max_uploads: maxUploads || 5,
      created_at: new Date().toISOString(),
    };
    saveData();
  }
  return data.sessions[sessionId];
}

function updateSessionInfo(sessionId, guestName, guestMessage, seatNumber) {
  if (data.sessions[sessionId]) {
    data.sessions[sessionId].guest_name = guestName || '';
    data.sessions[sessionId].guest_message = guestMessage || '';
    if (seatNumber) data.sessions[sessionId].seat_number = seatNumber;
    saveData();
  }
}

function incrementUploadCount(sessionId) {
  if (data.sessions[sessionId]) {
    data.sessions[sessionId].upload_count++;
    saveData();
  }
}

function getSessionUploadCount(sessionId, maxUploads) {
  const session = data.sessions[sessionId];
  return session
    ? { upload_count: session.upload_count, max_uploads: session.max_uploads }
    : { upload_count: 0, max_uploads: maxUploads || 5 };
}

function getTakenSeats(tableNumber) {
  const seats = [];
  Object.values(data.sessions).forEach((s) => {
    if (s.table_number === tableNumber && s.seat_number && s.upload_count > 0) {
      seats.push(s.seat_number);
    }
  });
  return [...new Set(seats)];
}

// ============ Upload Operations ============
function addUpload(uploadData) {
  const upload = {
    id: data.nextId++,
    session_id: uploadData.sessionId,
    table_number: uploadData.tableNumber,
    seat_number: uploadData.seatNumber || null,
    file_name: uploadData.fileName,
    original_name: uploadData.originalName,
    file_type: uploadData.fileType,
    file_size: uploadData.fileSize,
    guest_name: uploadData.guestName || '',
    guest_message: uploadData.guestMessage || '',
    created_at: new Date().toISOString(),
  };
  data.uploads.push(upload);
  saveData();
  return upload;
}

function getUploadsByTable(tableNumber) {
  return data.uploads
    .filter((u) => u.table_number === tableNumber)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getAllUploads() {
  return [...data.uploads].sort((a, b) => {
    if (a.table_number !== b.table_number) return a.table_number - b.table_number;
    if ((a.seat_number || 0) !== (b.seat_number || 0)) return (a.seat_number || 0) - (b.seat_number || 0);
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function getStats() {
  const totalUploads = data.uploads.length;
  const totalPhotos = data.uploads.filter((u) => u.file_type.startsWith('image')).length;
  const totalVideos = data.uploads.filter((u) => u.file_type.startsWith('video')).length;
  const tableSet = new Set(data.uploads.map((u) => u.table_number));
  const activeTables = tableSet.size;
  const totalSessions = Object.keys(data.sessions).length;

  const tableMap = {};
  data.uploads.forEach((u) => {
    tableMap[u.table_number] = (tableMap[u.table_number] || 0) + 1;
  });
  const perTable = Object.entries(tableMap)
    .map(([tn, count]) => ({ table_number: parseInt(tn), count }))
    .sort((a, b) => a.table_number - b.table_number);

  return { totalUploads, totalPhotos, totalVideos, activeTables, totalSessions, perTable };
}

function deleteUpload(id) {
  const idx = data.uploads.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const upload = data.uploads[idx];
  data.uploads.splice(idx, 1);

  if (data.sessions[upload.session_id]) {
    data.sessions[upload.session_id].upload_count = Math.max(
      0,
      data.sessions[upload.session_id].upload_count - 1
    );
  }

  saveData();
  return upload;
}

module.exports = {
  getOrCreateSession,
  updateSessionInfo,
  incrementUploadCount,
  getSessionUploadCount,
  getTakenSeats,
  addUpload,
  getUploadsByTable,
  getAllUploads,
  getStats,
  deleteUpload,
};
