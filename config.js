// ============ Central Config ============
// All settings read from env vars. No hardcoded values.

const path = require('path');

const EVENT_TYPES = {
  wedding:      { icon: '\u{1F492}', title: 'Hatira',        welcome: 'Hoş geldiniz!',                       zone: 'Masa',  seat: 'Koltuk', thanks: 'Bu güzel gecenin tadını çıkarın!',                          emoji: '\u{1F48D}' },
  engagement:   { icon: '\u{1F48D}', title: 'Nişan Hatira',          welcome: 'Nişanımıza hoş geldiniz!',             zone: 'Masa',  seat: 'Koltuk', thanks: 'Güzel dilekleriniz için teşekkürler!',                      emoji: '✨'    },
  henna:        { icon: '\u{1F319}', title: 'Kına Gecesi Hatira',    welcome: 'Kına gecemize hoş geldiniz!',          zone: 'Masa',  seat: 'Koltuk', thanks: 'Bu özel geceyi bizimle paylaştığınız için teşekkürler!',     emoji: '\u{1F319}' },
  circumcision: { icon: '\u{1F389}', title: 'Sünnet Hatira',        welcome: 'Sünnet düğünümüze hoş geldiniz!',      zone: 'Masa',  seat: 'Koltuk', thanks: 'Güzel dilekleriniz için teşekkürler!',                      emoji: '\u{1F38A}' },
  birthday:     { icon: '\u{1F382}', title: 'Doğum Günü Hatira',    welcome: 'Doğum günü partisine hoş geldiniz!',   zone: 'Masa',  seat: 'Yer',    thanks: 'Partiye katıldığınız için teşekkürler!',                    emoji: '\u{1F382}' },
  graduation:   { icon: '\u{1F393}', title: 'Mezuniyet Hatira',     welcome: 'Mezuniyet törenine hoş geldiniz!',     zone: 'Sınıf', seat: 'Koltuk', thanks: 'Bu başarıyı birlikte kutladığınız için teşekkürler!',       emoji: '\u{1F393}' },
  boat:         { icon: '⛵',    title: 'Tekne Hatira',          welcome: 'Tekne gezimize hoş geldiniz!',         zone: 'Bölge', seat: 'Yer',    thanks: 'Harika bir gezi oldu!',                                    emoji: '\u{1F6A2}' },
  group:        { icon: '\u{1F38A}', title: 'Etkinlik Hatira',      welcome: 'Etkinliğimize hoş geldiniz!',          zone: 'Alan',  seat: 'Yer',    thanks: 'Katılımınız için teşekkürler!',                             emoji: '\u{1F38A}' },
  corporate:    { icon: '\u{1F3E2}', title: 'Kurumsal Etkinlik',    welcome: 'Etkinliğimize hoş geldiniz!',          zone: 'Salon', seat: 'Bölüm',  thanks: 'Katılımınız için teşekkürler!',                             emoji: '\u{1F3E2}' },
  festival:     { icon: '\u{1F3EA}', title: 'Festival Hatira',      welcome: 'Festivale hoş geldiniz!',              zone: 'Sahne', seat: 'Alan',   thanks: 'Harika bir festival oldu!',                                 emoji: '\u{1F3EA}' },
};

const config = {
  // Server
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Event identity
  eventType: process.env.EVENT_TYPE || 'wedding',
  eventName: process.env.EVENT_NAME || '',
  eventDate: process.env.EVENT_DATE || '',
  totalZones: parseInt(process.env.TOTAL_ZONES || process.env.TOTAL_TABLES || '20'),
  seatsPerZone: parseInt(process.env.SEATS_PER_ZONE || '10'),
  maxUploads: parseInt(process.env.MAX_UPLOADS || '5'),

  // Auth
  adminPassword: process.env.ADMIN_PASS || null,

  // Branding
  primaryColor: process.env.PRIMARY_COLOR || '#d4a853',
  secondaryColor: process.env.SECONDARY_COLOR || '#1a1a2e',
  logoUrl: process.env.LOGO_URL || '',
  welcomeMessage: process.env.WELCOME_MESSAGE || '',

  // Storage — 'local' (disk) or 'r2' (Cloudflare R2 / S3-compatible)
  storageType: process.env.STORAGE_TYPE || 'local',
  r2Endpoint: process.env.R2_ENDPOINT || '',
  r2AccessKey: process.env.R2_ACCESS_KEY || '',
  r2SecretKey: process.env.R2_SECRET_KEY || '',
  r2Bucket: process.env.R2_BUCKET || '',
  r2PublicUrl: process.env.R2_PUBLIC_URL || '',

  // Limits
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(50 * 1024 * 1024)),

  // Database
  dbPath: process.env.DB_PATH || path.join(__dirname, 'event-data.json'),
};

function getEventLabels() {
  const base = EVENT_TYPES[config.eventType] || EVENT_TYPES.wedding;
  const labels = { ...base };
  if (config.welcomeMessage) labels.welcome = config.welcomeMessage;
  return labels;
}

// Safe to expose to frontend — no secrets
function getPublicConfig() {
  const labels = getEventLabels();
  return {
    eventType: config.eventType,
    eventName: config.eventName || labels.title,
    eventDate: config.eventDate,
    totalZones: config.totalZones,
    seatsPerZone: config.seatsPerZone,
    maxUploads: config.maxUploads,
    primaryColor: config.primaryColor,
    secondaryColor: config.secondaryColor,
    logoUrl: config.logoUrl,
    labels,
  };
}

module.exports = { config, getEventLabels, getPublicConfig, EVENT_TYPES };
