const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const archiver = require('archiver');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'dugun2026';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const TOTAL_TABLES = 40;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tableNum = parseInt(req.params.tableNumber);
    const tableDir = path.join(uploadsDir, `masa-${tableNum}`);
    if (!fs.existsSync(tableDir)) {
      fs.mkdirSync(tableDir, { recursive: true });
    }
    cb(null, tableDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Sadece fotoğraf ve video dosyaları yüklenebilir!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// ============ GUEST ROUTES ============

// Serve guest page for table URLs
app.get('/masa/:tableNumber', (req, res) => {
  const tableNum = parseInt(req.params.tableNumber);
  if (isNaN(tableNum) || tableNum < 1 || tableNum > TOTAL_TABLES) {
    return res.status(404).send('Geçersiz masa numarası');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Check/create session
app.post('/api/session', (req, res) => {
  const { sessionId, tableNumber, seatNumber, guestName, guestMessage } = req.body;
  if (!sessionId || !tableNumber) {
    return res.status(400).json({ error: 'Session ID ve masa numarası gerekli' });
  }

  const session = db.getOrCreateSession(sessionId, tableNumber, seatNumber);
  if (guestName || guestMessage || seatNumber) {
    db.updateSessionInfo(sessionId, guestName, guestMessage, seatNumber);
  }

  res.json({
    sessionId: session.session_id,
    tableNumber: session.table_number,
    seatNumber: session.seat_number,
    uploadCount: session.upload_count,
    maxUploads: session.max_uploads,
    remaining: session.max_uploads - session.upload_count
  });
});

// Get session status
app.get('/api/session/:sessionId', (req, res) => {
  const status = db.getSessionUploadCount(req.params.sessionId);
  res.json({
    uploadCount: status.upload_count,
    maxUploads: status.max_uploads,
    remaining: status.max_uploads - status.upload_count
  });
});

// Get taken seats for a table
app.get('/api/seats/:tableNumber', (req, res) => {
  const taken = db.getTakenSeats(parseInt(req.params.tableNumber));
  res.json({ takenSeats: taken });
});

// Upload file
app.post('/api/upload/:tableNumber', upload.single('media'), (req, res) => {
  try {
    const tableNum = parseInt(req.params.tableNumber);
    const sessionId = req.body.sessionId;
    const seatNumber = req.body.seatNumber ? parseInt(req.body.seatNumber) : null;

    if (!sessionId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Session ID gerekli' });
    }

    // Check upload limit
    const session = db.getSessionUploadCount(sessionId);
    if (session.upload_count >= session.max_uploads) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(429).json({ error: 'Yükleme limitinize ulaştınız (5 dosya)' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Dosya bulunamadı' });
    }

    // Ensure session exists
    db.getOrCreateSession(sessionId, tableNum, seatNumber);

    // Save upload record
    db.addUpload({
      sessionId,
      tableNumber: tableNum,
      seatNumber,
      fileName: req.file.filename,
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      guestName: req.body.guestName || '',
      guestMessage: req.body.guestMessage || ''
    });

    db.incrementUploadCount(sessionId);

    const updatedSession = db.getSessionUploadCount(sessionId);

    res.json({
      success: true,
      fileName: req.file.filename,
      fileType: req.file.mimetype,
      uploadCount: updatedSession.upload_count,
      remaining: updatedSession.max_uploads - updatedSession.upload_count,
      url: `/uploads/masa-${tableNum}/${req.file.filename}`
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: 'Yükleme sırasında bir hata oluştu' });
  }
});

// ============ ADMIN ROUTES ============

app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Yanlış şifre' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  const stats = db.getStats();
  res.json(stats);
});

app.get('/api/admin/uploads', (req, res) => {
  const uploads = db.getAllUploads();
  res.json(uploads);
});

app.get('/api/admin/uploads/:tableNumber', (req, res) => {
  const uploads = db.getUploadsByTable(parseInt(req.params.tableNumber));
  res.json(uploads);
});

app.delete('/api/admin/uploads/:id', (req, res) => {
  const deletedUpload = db.deleteUpload(parseInt(req.params.id));
  if (deletedUpload) {
    const filePath = path.join(uploadsDir, `masa-${deletedUpload.table_number}`, deletedUpload.file_name);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('File delete error:', e);
    }
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Dosya bulunamadı' });
  }
});

app.get('/api/admin/download-all', (req, res) => {
  const archive = archiver('zip', { zlib: { level: 5 } });
  res.attachment('dugun-fotograflari.zip');
  archive.pipe(res);

  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const tableDir = path.join(uploadsDir, `masa-${i}`);
    if (fs.existsSync(tableDir)) {
      archive.directory(tableDir, `Masa-${i}`);
    }
  }

  archive.finalize();
});

app.get('/api/admin/qr-codes', async (req, res) => {
  const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;
  const qrCodes = [];

  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const url = `${baseUrl}/masa/${i}`;
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });
    qrCodes.push({ tableNumber: i, url, qrDataUrl: dataUrl });
  }

  res.json(qrCodes);
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Dosya çok büyük! Maksimum 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`\n🎉 Düğün Fotoğraf Uygulaması çalışıyor!`);
  console.log(`📱 Misafir sayfası: http://localhost:${PORT}/masa/1`);
  console.log(`🔧 Admin paneli:   http://localhost:${PORT}/admin.html`);
  console.log(`🖨️  QR Kodlar:      http://localhost:${PORT}/qr.html`);
  console.log(`🔑 Admin şifre:    ${ADMIN_PASSWORD}`);
  console.log(`\nToplam ${TOTAL_TABLES} masa × 10 koltuk = ${TOTAL_TABLES * 10} kişi kapasiteli!\n`);
});
