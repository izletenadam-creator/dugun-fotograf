const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const archiver = require('archiver');
const { config, getEventLabels, getPublicConfig } = require('./config');
const db = require('./database');

const app = express();

// Warn if no admin password set
if (!config.adminPassword) {
  console.warn('\n⚠️  ADMIN_PASS ayarlanmamis! .env dosyasina ekleyin.\n');
}

// Ensure uploads directory exists (local storage only)
const uploadsDir = path.join(__dirname, 'uploads');
if (config.storageType === 'local') {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (config.storageType === 'local') {
  app.use('/uploads', express.static(uploadsDir));
}

// ============ Storage Config ============
let storage;

if (config.storageType === 'r2' && config.r2Endpoint) {
  // Cloudflare R2 / S3-compatible storage
  // Requires: npm install @aws-sdk/client-s3 multer-s3
  const { S3Client } = require('@aws-sdk/client-s3');
  const multerS3 = require('multer-s3');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKey,
      secretAccessKey: config.r2SecretKey,
    },
  });

  storage = multerS3({
    s3,
    bucket: config.r2Bucket,
    key: (req, file, cb) => {
      const zoneNum = parseInt(req.params.zoneNumber);
      const ext = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
      cb(null, `zone-${zoneNum}/${uniqueName}`);
    },
  });
} else {
  // Local disk storage (default, development)
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const zoneNum = parseInt(req.params.zoneNumber);
      const zoneDir = path.join(uploadsDir, `zona-${zoneNum}`);
      if (!fs.existsSync(zoneDir)) {
        fs.mkdirSync(zoneDir, { recursive: true });
      }
      cb(null, zoneDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
      cb(null, uniqueName);
    },
  });
}

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
  limits: { fileSize: config.maxFileSize },
});

// ============ PUBLIC CONFIG ENDPOINT ============
app.get('/api/config', (req, res) => {
  res.json(getPublicConfig());
});

// ============ GUEST ROUTES ============

// Serve guest page — /masa/:number kept for backward compat
app.get('/masa/:zoneNumber', (req, res) => {
  const zoneNum = parseInt(req.params.zoneNumber);
  if (isNaN(zoneNum) || zoneNum < 1 || zoneNum > config.totalZones) {
    const labels = getEventLabels();
    return res.status(404).send(`Geçersiz ${labels.zone.toLowerCase()} numarası`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Check/create session
app.post('/api/session', (req, res) => {
  const { sessionId, tableNumber, seatNumber, guestName, guestMessage } = req.body;
  if (!sessionId || !tableNumber) {
    return res.status(400).json({ error: 'Session ID ve alan numarası gerekli' });
  }

  const session = db.getOrCreateSession(sessionId, tableNumber, seatNumber, config.maxUploads);
  if (guestName || guestMessage || seatNumber) {
    db.updateSessionInfo(sessionId, guestName, guestMessage, seatNumber);
  }

  res.json({
    sessionId: session.session_id,
    tableNumber: session.table_number,
    seatNumber: session.seat_number,
    uploadCount: session.upload_count,
    maxUploads: session.max_uploads,
    remaining: session.max_uploads - session.upload_count,
  });
});

// Get session status
app.get('/api/session/:sessionId', (req, res) => {
  const status = db.getSessionUploadCount(req.params.sessionId, config.maxUploads);
  res.json({
    uploadCount: status.upload_count,
    maxUploads: status.max_uploads,
    remaining: status.max_uploads - status.upload_count,
  });
});

// Get taken seats for a zone
app.get('/api/seats/:tableNumber', (req, res) => {
  const taken = db.getTakenSeats(parseInt(req.params.tableNumber));
  res.json({ takenSeats: taken });
});

// Upload file
app.post('/api/upload/:zoneNumber', upload.single('media'), (req, res) => {
  try {
    const zoneNum = parseInt(req.params.zoneNumber);
    const sessionId = req.body.sessionId;
    const seatNumber = req.body.seatNumber ? parseInt(req.body.seatNumber) : null;

    if (!sessionId) {
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Session ID gerekli' });
    }

    // Check upload limit
    const session = db.getSessionUploadCount(sessionId, config.maxUploads);
    if (session.upload_count >= session.max_uploads) {
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      return res.status(429).json({ error: `Yükleme limitinize ulaştınız (${config.maxUploads} dosya)` });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Dosya bulunamadı' });
    }

    // Ensure session exists
    db.getOrCreateSession(sessionId, zoneNum, seatNumber, config.maxUploads);

    // Determine file name and URL based on storage type
    const fileName = config.storageType === 'r2' ? req.file.key : req.file.filename;
    const fileUrl = config.storageType === 'r2'
      ? `${config.r2PublicUrl}/${req.file.key}`
      : `/uploads/zona-${zoneNum}/${req.file.filename}`;

    // Save upload record
    db.addUpload({
      sessionId,
      tableNumber: zoneNum,
      seatNumber,
      fileName,
      originalName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      guestName: req.body.guestName || '',
      guestMessage: req.body.guestMessage || '',
    });

    db.incrementUploadCount(sessionId);
    const updatedSession = db.getSessionUploadCount(sessionId, config.maxUploads);

    res.json({
      success: true,
      fileName,
      fileType: req.file.mimetype,
      uploadCount: updatedSession.upload_count,
      remaining: updatedSession.max_uploads - updatedSession.upload_count,
      url: fileUrl,
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: 'Yükleme sırasında bir hata oluştu' });
  }
});

// ============ ADMIN ROUTES ============

app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (!config.adminPassword) {
    return res.status(500).json({ error: 'Admin şifresi ayarlanmamış' });
  }
  if (password === config.adminPassword) {
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
    if (config.storageType === 'local') {
      const filePath = path.join(uploadsDir, `zona-${deletedUpload.table_number}`, deletedUpload.file_name);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        console.error('File delete error:', e);
      }
    }
    // TODO: R2 delete — s3.deleteObject when storageType === 'r2'
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Dosya bulunamadı' });
  }
});

app.get('/api/admin/download-all', (req, res) => {
  const labels = getEventLabels();
  const eventSlug = (config.eventName || labels.title).replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ ]/g, '').replace(/\s+/g, '-').toLowerCase();
  const zipName = `${eventSlug}-hatira.zip`;

  const archive = archiver('zip', { zlib: { level: 5 } });
  res.attachment(zipName);
  archive.pipe(res);

  if (config.storageType === 'local') {
    for (let i = 1; i <= config.totalZones; i++) {
      const zoneDir = path.join(uploadsDir, `zona-${i}`);
      if (fs.existsSync(zoneDir)) {
        archive.directory(zoneDir, `${labels.zone}-${i}`);
      }
    }
  }
  // TODO: R2 download — stream from S3 when storageType === 'r2'

  archive.finalize();
});

app.get('/api/admin/qr-codes', async (req, res) => {
  const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;
  const qrCodes = [];

  for (let i = 1; i <= config.totalZones; i++) {
    const url = `${baseUrl}/masa/${i}`;
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: config.secondaryColor, light: '#ffffff' },
    });
    qrCodes.push({ zoneNumber: i, url, qrDataUrl: dataUrl });
  }

  res.json(qrCodes);
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const sizeMB = Math.round(config.maxFileSize / (1024 * 1024));
      return res.status(413).json({ error: `Dosya çok büyük! Maksimum ${sizeMB}MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  next();
});

// Only listen when running directly (not in Vercel)
if (require.main === module) {
  const labels = getEventLabels();
  app.listen(config.port, () => {
    console.log(`\n${labels.icon} ${config.eventName || labels.title} çalışıyor!`);
    console.log(`📱 Misafir sayfası: http://localhost:${config.port}/masa/1`);
    console.log(`🔧 Admin paneli:   http://localhost:${config.port}/admin.html`);
    console.log(`🖨️  QR Kodlar:      http://localhost:${config.port}/qr.html`);
    if (config.adminPassword) {
      console.log(`🔑 Admin şifre:    ${config.adminPassword}`);
    }
    console.log(`\nToplam ${config.totalZones} ${labels.zone.toLowerCase()} × ${config.seatsPerZone} ${labels.seat.toLowerCase()} = ${config.totalZones * config.seatsPerZone} kişi kapasiteli!`);
    console.log(`📦 Storage: ${config.storageType}\n`);
  });
}

module.exports = app;
