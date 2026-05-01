import express from 'express';
import { Innertube, UniversalCache, Platform, Log, ClientType } from 'youtubei.js';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { spawn, execSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { dbGet, dbAll, dbRun, dbBatch } from './db.js';
import bcrypt from 'bcryptjs';

let FFMPEG;
try {
  FFMPEG = execSync('which ffmpeg').toString().trim();
} catch {
  try {
    const { default: ffmpegStatic } = await import('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      FFMPEG = ffmpegStatic;
      console.log('[setup] Using bundled ffmpeg-static:', FFMPEG);
    } else {
      FFMPEG = 'ffmpeg';
    }
  } catch {
    FFMPEG = 'ffmpeg';
  }
}

// ffprobe is bundled with ffmpeg in the Replit runtime; if it lives in the
// same dir as ffmpeg use that, otherwise fall back to PATH.
let FFPROBE = 'ffprobe';
try { FFPROBE = execSync('which ffprobe').toString().trim() || 'ffprobe'; } catch {}
{
  const sib = path.join(path.dirname(FFMPEG), 'ffprobe');
  if (fs.existsSync(sib)) FFPROBE = sib;
}

const platform = os.platform();
let YTDLP = (() => {
  const binNames = platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];
  const lookup = platform === 'win32' ? 'where' : 'which';
  for (const name of binNames) {
    try {
      const resolved = execSync(`${lookup} ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
      if (resolved) return resolved.split(/\r?\n/)[0];
    } catch {}
  }
  const binName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return path.join(os.homedir(), 'bin', binName);
})();

async function ensureYtDlp() {
  if (fs.existsSync(YTDLP)) return;
  const dir = path.dirname(YTDLP);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log('[setup] yt-dlp not found — downloading...');
  await new Promise((resolve, reject) => {
    const downloadUrl = platform === 'win32'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    const proc = spawn('curl', [
      '-sL', '--retry', '3',
      downloadUrl,
      '-o', YTDLP,
    ]);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`curl exited ${code}`));
      try {
        if (platform !== 'win32') fs.chmodSync(YTDLP, 0o755);
        const ver = execSync(`"${YTDLP}" --version`).toString().trim();
        console.log(`[setup] yt-dlp ${ver} ready`);
        resolve();
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

await ensureYtDlp();

const ytdlpCache = new Map();
const ytdlpInFlight = new Map(); // videoId -> Promise (dedup concurrent calls)
const YTDLP_TTL = 15 * 60 * 1000;

Log.setLevel(Log.Level.ERROR);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

const MAX_CONCURRENT_STREAMS = 5;
// Use a Set so cleanup is always idempotent — each stream gets a unique ID
const activeStreamSet = new Set();
// Maps userId (or "ip:<addr>" for anon) -> currently active streamId.
// Lets a user seek (which opens a new proxy connection) without consuming an extra slot.
const activeUserStreams = new Map();

// ─── Currently-watching tracker ──────────────────────────────────────────────
// userId → { videoId, title, thumbnail, position, updatedAt }
const watchingNow = new Map();
setInterval(() => {
  const stale = Date.now() - 35000;
  for (const [uid, d] of watchingNow.entries()) {
    if (d.updatedAt < stale) watchingNow.delete(uid);
  }
}, 15000);

// ─── Bandwidth tracker ───────────────────────────────────────────────────────
const BW_BUCKETS = 60;          // keep 60 minutes of history
const BW_BUCKET_MS = 60 * 1000; // 1-minute buckets
const bwPerUser = new Map();    // userId -> [{ t, bytes }]
const bwTotal = [];             // [{ t, bytes }]

function recordBandwidth(userId, bytes) {
  if (!bytes || bytes <= 0) return;
  const t = Math.floor(Date.now() / BW_BUCKET_MS) * BW_BUCKET_MS;

  if (userId !== null && userId !== undefined) {
    if (!bwPerUser.has(userId)) bwPerUser.set(userId, []);
    const arr = bwPerUser.get(userId);
    const last = arr[arr.length - 1];
    if (last && last.t === t) last.bytes += bytes;
    else { arr.push({ t, bytes }); if (arr.length > BW_BUCKETS) arr.shift(); }
  }

  const last = bwTotal[bwTotal.length - 1];
  if (last && last.t === t) last.bytes += bytes;
  else { bwTotal.push({ t, bytes }); if (bwTotal.length > BW_BUCKETS) bwTotal.shift(); }
}

setInterval(() => {
  const cutoff = Date.now() - BW_BUCKETS * BW_BUCKET_MS;
  for (const [uid, arr] of bwPerUser.entries()) {
    const filtered = arr.filter(b => b.t >= cutoff);
    if (filtered.length === 0) bwPerUser.delete(uid);
    else bwPerUser.set(uid, filtered);
  }
}, 5 * 60 * 1000);

const USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const getRandomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

Platform.shim.eval = (data, _env) => {
  return new Function(data.output)();
};

const _nativeFetch = Platform.shim.fetch ?? fetch;
Platform.shim.fetch = (input, init = {}) => {
  if (init?.headers && typeof init.headers === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(init.headers)) clean[k] = v;
    init = { ...init, headers: clean };
  }
  return _nativeFetch(input, init);
};

let youtube;
let refreshTimer = null;

const infoCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

// Bot bypass environment variables
const YOUTUBE_VISITOR_DATA = process.env.YOUTUBE_VISITOR_DATA || '';
const YOUTUBE_PO_TOKEN = process.env.YOUTUBE_PO_TOKEN || '';
// Base64-encoded cookies.txt content — set this in Render/production env
const YOUTUBE_COOKIES_B64 = process.env.YOUTUBE_COOKIES || '';

// Write cookies to disk once on startup if provided
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Encryption helpers ───────────────────────────────────────────────────────
const KEY_FILE = path.join(DATA_DIR, '.key');
let ENCRYPT_KEY;
try {
  ENCRYPT_KEY = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  if (ENCRYPT_KEY.length !== 32) throw new Error('bad key length');
} catch {
  ENCRYPT_KEY = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, ENCRYPT_KEY.toString('hex'), 'utf8');
  console.log('[crypto] Generated new encryption key at', KEY_FILE);
}

// AES-256-GCM encrypt — returns 'enc:<base64>' or original value if falsy
function encrypt(text) {
  if (!text) return text;
  const str = String(text);
  if (str.startsWith('enc:')) return str; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPT_KEY, iv);
  const enc = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

// AES-256-GCM decrypt — accepts 'enc:<base64>' or plain (legacy) text
function decrypt(encoded) {
  if (!encoded) return encoded;
  const str = String(encoded);
  if (!str.startsWith('enc:')) return str; // not yet encrypted (legacy data)
  try {
    const buf = Buffer.from(str.slice(4), 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const data = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPT_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch { return encoded; }
}

// SHA-256 hash for email lookups (deterministic, no salt needed for high-entropy values)
function emailHash(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

const COOKIES_PATH = path.join(DATA_DIR, 'cookies.txt');
if (YOUTUBE_COOKIES_B64) {
  try {
    fs.writeFileSync(COOKIES_PATH, Buffer.from(YOUTUBE_COOKIES_B64, 'base64').toString('utf8'));
    console.log('[setup] YouTube cookies written to', COOKIES_PATH);
  } catch (e) {
    console.warn('[setup] Failed to write cookies:', e.message);
  }
}

function hasCookies() {
  return fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 0;
}

async function initYouTube() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }

  try {
    const options = {
      client_type: ClientType.TV_EMBEDDED,
      generate_session_locally: true,
      cache: new UniversalCache(false),
      enable_session_cache: false,
    };

    if (YOUTUBE_VISITOR_DATA) {
      options.visitor_data = YOUTUBE_VISITOR_DATA;
      console.log('[youtubei.js] Using provided visitor_data');
    }

    youtube = await Innertube.create(options);

    infoCache.clear();
    console.log('>>> [SUCCESS] YouTube API Initialised (TV_EMBEDDED)');
    refreshTimer = setTimeout(initYouTube, 25 * 60 * 1000);
  } catch (e) {
    console.error('>>> [ERROR] Init Failed:', e.message);
    setTimeout(initYouTube, 10000);
  }
}

await initYouTube();

// ─── Turso Database Init ─────────────────────────────────────────────────────

async function initDb() {
  await dbBatch([
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plain_password TEXT DEFAULT NULL,
      email_hash TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS admin_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      max_accounts INTEGER DEFAULT 1000,
      max_connections INTEGER DEFAULT 500,
      max_sessions INTEGER DEFAULT 0,
      show_passwords INTEGER DEFAULT 0,
      allow_co_watch INTEGER DEFAULT 0
    )`,
    `INSERT OR IGNORE INTO admin_settings (id, max_accounts, max_connections) VALUES (1, 1000, 500)`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS watch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      channel TEXT DEFAULT '',
      channel_id TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_hidden INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      subscriptions_weight REAL DEFAULT 1.0,
      trending_weight REAL DEFAULT 0.5,
      show_trending INTEGER DEFAULT 1,
      use_algorithm INTEGER DEFAULT 1,
      preferred_categories TEXT DEFAULT '{}',
      default_platform TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL DEFAULT 'youtube',
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      channel_avatar TEXT DEFAULT '',
      subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, platform, channel_id)
    )`,
    `CREATE TABLE IF NOT EXISTS saved_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      channel_id TEXT DEFAULT '',
      channel_avatar TEXT DEFAULT '',
      duration TEXT DEFAULT '',
      views TEXT DEFAULT '',
      saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, video_id)
    )`,
  ]);

  // Schema migrations — ignore errors if column already exists
  const migrations = [
    `ALTER TABLE sessions ADD COLUMN last_seen INTEGER DEFAULT 0`,
    `ALTER TABLE user_preferences ADD COLUMN use_algorithm INTEGER DEFAULT 1`,
    `ALTER TABLE user_preferences ADD COLUMN default_platform TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN plain_password TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN email_hash TEXT DEFAULT NULL`,
    `ALTER TABLE admin_settings ADD COLUMN max_sessions INTEGER DEFAULT 0`,
    `ALTER TABLE admin_settings ADD COLUMN show_passwords INTEGER DEFAULT 0`,
    `ALTER TABLE watch_history ADD COLUMN user_hidden INTEGER DEFAULT 0`,
    `ALTER TABLE admin_settings ADD COLUMN allow_co_watch INTEGER DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { await dbRun(sql); } catch {}
  }

  await dbRun('UPDATE admin_settings SET max_sessions = 0 WHERE max_sessions IS NULL');
  await dbRun('UPDATE admin_settings SET show_passwords = 0 WHERE show_passwords IS NULL');
  await dbRun('UPDATE admin_settings SET allow_co_watch = 0 WHERE allow_co_watch IS NULL');

  // Encrypt existing plaintext emails/passwords and populate email_hash
  const rows = await dbAll(`SELECT id, email, plain_password FROM users WHERE email NOT LIKE 'enc:%'`);
  for (const row of rows) {
    const encEmail = encrypt(row.email);
    const hash = emailHash(row.email);
    const encPwd = row.plain_password && !row.plain_password.startsWith('enc:') ? encrypt(row.plain_password) : row.plain_password;
    await dbRun('UPDATE users SET email = ?, email_hash = ?, plain_password = ? WHERE id = ?', [encEmail, hash, encPwd, row.id]);
  }
  const missingHash = await dbAll(`SELECT id, email FROM users WHERE email_hash IS NULL`);
  for (const row of missingHash) {
    try { await dbRun('UPDATE users SET email_hash = ? WHERE id = ?', [emailHash(decrypt(row.email)), row.id]); } catch {}
  }
  if (rows.length > 0) console.log(`[crypto] Encrypted ${rows.length} existing user records`);
  console.log('[db] Turso database ready');
}

await initDb();

// ─── Auth helpers ────────────────────────────────────────────────────────────

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await dbRun('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [token, userId, expiresAt]);
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const sess = await dbGet('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!sess || Date.now() > sess.expires_at) {
    if (sess) await dbRun('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  const u = await dbGet('SELECT id, username, email FROM users WHERE id = ?', [sess.user_id]);
  if (u) u.email = decrypt(u.email);
  return u;
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.session;
    const user = await getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    await dbRun('UPDATE sessions SET last_seen = ? WHERE token = ?', [Date.now(), token]);
    next();
  } catch (e) {
    next(e);
  }
}

// ─── Admin auth helpers ───────────────────────────────────────────────────────

async function isAdminSetup() {
  return !!(await dbGet('SELECT id FROM admin_config WHERE id = 1'));
}

async function getAdminSession(token) {
  if (!token) return null;
  const sess = await dbGet('SELECT * FROM admin_sessions WHERE token = ?', [token]);
  if (!sess || Date.now() > sess.expires_at) {
    if (sess) await dbRun('DELETE FROM admin_sessions WHERE token = ?', [token]);
    return null;
  }
  return { admin: true };
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    const session = await getAdminSession(token);
    if (!session) return res.status(401).json({ error: 'Admin not authenticated' });
    const renewed = Date.now() + 24 * 60 * 60 * 1000;
    await dbRun('UPDATE admin_sessions SET expires_at = ? WHERE token = ?', [renewed, token]);
    res.cookie('admin_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', path: '/' });
    next();
  } catch (e) {
    next(e);
  }
}

// ─── Express setup ───────────────────────────────────────────────────────────

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── Security & anti-indexing headers ────────────────────────────────────────
// These tell crawlers not to index, and tell Fortinet/corporate filters that
// this is a legitimate, well-behaved site (not malware/phishing).
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noodp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─── Bot / crawler blocking ───────────────────────────────────────────────────
const BOT_UA_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
  /yandexbot/i, /yandex\.com\/bots/i, /sogou/i, /exabot/i, /facebot/i,
  /facebookexternalhit/i, /facebookcatalog/i, /twitterbot/i, /applebot/i,
  /rogerbot/i, /linkedinbot/i, /embedly/i, /quora link preview/i,
  /showyoubot/i, /outbrain/i, /pinterest/i, /pinterestbot/i, /slackbot/i,
  /vkshare/i, /w3c_validator/i, /whatsapp/i, /telegrambot/i, /discordbot/i,
  /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /dotbot/i, /seznambot/i,
  /screaming frog/i, /seokicks/i, /sistrix/i, /seobilitybot/i, /majestic/i,
  /blexbot/i, /petalbot/i, /bytespider/i, /gptbot/i, /chatgpt-user/i,
  /claudebot/i, /anthropic-ai/i, /cohere-ai/i, /ccbot/i, /omgilibot/i,
  /dataforseobot/i, /serpstatbot/i, /neevabot/i, /pricespider/i,
  /archive\.org_bot/i, /ia_archiver/i, /wayback_machine/i, /httrack/i,
  /wget/i, /curl\/[0-9]/i, /python-requests/i, /go-http-client/i,
  /scrapy/i, /mechanize/i, /libwww-perl/i, /lwp-trivial/i,
  /java\/[0-9]/i, /okhttp/i, /axios\/[0-9]/i, /node-fetch/i,
  /headlesschrome/i, /phantomjs/i, /selenium/i,
];

app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  if (!ua || BOT_UA_PATTERNS.some(re => re.test(ua))) {
    return res.status(404).set('Content-Type', 'text/plain').end('Not Found');
  }
  next();
});

app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || '';
  req.cookies = {};
  cookieHeader.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  next();
});

app.use(express.static(path.join(__dirname, 'dist')));

// ─── Cache cleanup ───────────────────────────────────────────────────────────

setInterval(async () => {
  const now = Date.now();
  for (const [key, val] of infoCache) {
    if (now - val.ts > CACHE_TTL) infoCache.delete(key);
  }
  try { await dbRun('DELETE FROM sessions WHERE expires_at < ?', [now]); } catch {}
}, 30 * 60 * 1000);

// ─── Auth endpoints ──────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check max accounts limit
    const settings = await dbGet('SELECT max_accounts FROM admin_settings WHERE id = 1');
    if (settings) {
      const userCount = await dbGet('SELECT COUNT(*) as cnt FROM users');
      if (userCount.cnt >= settings.max_accounts) {
        return res.status(403).json({ error: 'Registration is currently closed (account limit reached)' });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const cleanEmail = email.trim().toLowerCase();
    let result;
    try {
      result = await dbRun(
        'INSERT INTO users (username, email, email_hash, password_hash, plain_password) VALUES (?,?,?,?,?)',
        [username.trim(), encrypt(cleanEmail), emailHash(cleanEmail), hash, encrypt(password)]
      );
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username or email already taken' });
      throw e;
    }

    const token = await createSession(result.lastInsertRowid);
    res.cookie('session', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ user: { id: result.lastInsertRowid, username: username.trim(), email: email.trim().toLowerCase() } });
  } catch (e) {
    console.error('[auth] register error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await dbGet('SELECT * FROM users WHERE username = ? OR email_hash = ?', [username, emailHash(username)]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Check concurrent session limit
    const loginSettings = await dbGet('SELECT max_sessions FROM admin_settings WHERE id = 1');
    if (loginSettings?.max_sessions > 0) {
      const activeSessions = (await dbGet('SELECT COUNT(*) as cnt FROM sessions WHERE expires_at > ?', [Date.now()])).cnt;
      if (activeSessions >= loginSettings.max_sessions) {
        return res.status(429).json({ error: 'Server is full — maximum concurrent sessions reached. Try again later.' });
      }
    }

    const token = await createSession(user.id);
    res.cookie('session', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ user: { id: user.id, username: user.username, email: decrypt(user.email) } });
  } catch (e) {
    console.error('[auth] login error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies?.session;
  if (token) try { await dbRun('DELETE FROM sessions WHERE token = ?', [token]); } catch {}
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies?.session;
  const user = await getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});

// ─── Admin endpoints ─────────────────────────────────────────────────────────

app.get('/api/admin/status', async (req, res) => {
  res.json({ setup: await isAdminSetup() });
});

app.post('/api/admin/setup', async (req, res) => {
  try {
    if (await isAdminSetup()) return res.status(409).json({ error: 'Admin password already set. Cannot change.' });
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 12);
    await dbRun('INSERT INTO admin_config (id, password_hash) VALUES (1, ?)', [hash]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    if (!await isAdminSetup()) return res.status(403).json({ error: 'Admin not set up yet' });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const config = await dbGet('SELECT password_hash FROM admin_config WHERE id = 1');
    const ok = await bcrypt.compare(password, config.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    await dbRun('INSERT INTO admin_sessions (token, created_at, expires_at) VALUES (?,?,?)', [token, now, now + 24 * 60 * 60 * 1000]);
    res.cookie('admin_token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/logout', requireAdmin, async (req, res) => {
  const token = req.cookies?.admin_token;
  if (token) try { await dbRun('DELETE FROM admin_sessions WHERE token = ?', [token]); } catch {}
  res.clearCookie('admin_token', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.username, u.email, u.created_at, u.plain_password,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) as active_sessions,
        (SELECT MAX(s.last_seen) FROM sessions s WHERE s.user_id = u.id) as last_seen,
        (SELECT COUNT(*) FROM watch_history wh WHERE wh.user_id = u.id) as watch_count
      FROM users u ORDER BY u.created_at DESC
    `, [Date.now()]);

    // Decrypt sensitive fields — only expose plain_password when show_passwords is enabled
    const adminCfg = await dbGet('SELECT show_passwords FROM admin_settings WHERE id = 1');
    const showPwds = !!(adminCfg?.show_passwords);
    for (const u of users) {
      const decEmail = decrypt(u.email);
      u.email = (decEmail && !decEmail.startsWith('enc:')) ? decEmail : null;
      if (showPwds && u.plain_password) {
        const dec = decrypt(u.plain_password);
        u.plain_password = (dec && !dec.startsWith('enc:') && !dec.startsWith('$2')) ? dec : null;
      } else {
        delete u.plain_password;
      }
    }

    // Attach subscription count
    const subCounts = await dbAll(`SELECT user_id, COUNT(*) as sub_count FROM subscriptions GROUP BY user_id`);
    const subMap = {};
    for (const row of subCounts) subMap[row.user_id] = row.sub_count;
    for (const u of users) u.sub_count = subMap[u.id] || 0;

    const totalUsers = users.length;
    const now = Date.now();
    const recentThreshold = now - 15 * 60 * 1000;
    const connectedUsers = users.filter(u => u.last_seen && u.last_seen > recentThreshold).length;

    const settings = await dbGet('SELECT * FROM admin_settings WHERE id = 1');

    res.json({ users, totalUsers, connectedUsers, settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM sessions WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM watch_history WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM user_preferences WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM subscriptions WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM saved_videos WHERE user_id = ?', [id]);
    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const hash = await bcrypt.hash(password, 10);
    await dbRun('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?', [hash, encrypt(password), id]);
    await dbRun('DELETE FROM sessions WHERE user_id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users/:id/watch-history', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const history = await dbAll('SELECT * FROM watch_history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 100', [id]);
    const user = await dbGet('SELECT id, username, email FROM users WHERE id = ?', [id]);
    res.json({ user, history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/users/:id/subscriptions', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const subs = await dbAll('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY subscribed_at DESC', [id]);
    const user = await dbGet('SELECT id, username FROM users WHERE id = ?', [id]);
    res.json({ user, subscriptions: subs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  const settings = await dbGet('SELECT * FROM admin_settings WHERE id = 1');
  res.json({ settings });
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const { max_accounts, max_connections, max_sessions, show_passwords, allow_co_watch } = req.body;
    if (max_accounts !== undefined) {
      await dbRun('UPDATE admin_settings SET max_accounts = ? WHERE id = 1', [parseInt(max_accounts)]);
    }
    if (max_connections !== undefined) {
      await dbRun('UPDATE admin_settings SET max_connections = ? WHERE id = 1', [parseInt(max_connections)]);
    }
    if (max_sessions !== undefined) {
      await dbRun('UPDATE admin_settings SET max_sessions = ? WHERE id = 1', [Math.max(0, parseInt(max_sessions) || 0)]);
    }
    if (show_passwords !== undefined) {
      await dbRun('UPDATE admin_settings SET show_passwords = ? WHERE id = 1', [show_passwords ? 1 : 0]);
    }
    if (allow_co_watch !== undefined) {
      await dbRun('UPDATE admin_settings SET allow_co_watch = ? WHERE id = 1', [allow_co_watch ? 1 : 0]);
    }
    const settings = await dbGet('SELECT * FROM admin_settings WHERE id = 1');
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Currently-watching reporting (user-facing) ──────────────────────────────

// Admin WebSocket clients for real-time watching updates
const adminWsClients = new Set();

// Maps each admin WS connection → the userId they are currently co-watching (if any)
const coWatchTargets = new Map();

// Throttle watching-list broadcasts: userId → last broadcast timestamp
// Prevents flooding admins at 200ms WS update rate (max once per 2s per user)
const watchingBroadcastThrottle = new Map();

async function broadcastWatchingToAdmins() {
  if (adminWsClients.size === 0) return;
  try {
    const cfg = await dbGet('SELECT allow_co_watch FROM admin_settings WHERE id = 1');
    if (!cfg?.allow_co_watch) return;
    const now = Date.now();
    const active = [];
    for (const entry of watchingNow.values()) {
      if (now - entry.updatedAt < 35000) active.push(entry);
    }
    const msg = JSON.stringify({ type: 'watching_update', watching: active });
    for (const ws of adminWsClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  } catch {}
}

// Push a single user's state to every admin WS that registered interest via cowatch_join
function pushCowatchUpdate(userId, entry) {
  if (coWatchTargets.size === 0) return;
  const msg = JSON.stringify({ type: 'cowatch_update', data: entry });
  for (const [ws, targetId] of coWatchTargets.entries()) {
    if (targetId === userId && ws.readyState === 1) ws.send(msg);
  }
}

app.post('/api/watching', requireAuth, (req, res) => {
  const { videoId, title, thumbnail, position, paused, speed, quality, subtitleLang, subtitlesOn } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });
  const entry = {
    userId: req.user.id,
    username: req.user.username,
    videoId,
    title: title || '',
    thumbnail: thumbnail || '',
    position: parseFloat(position) || 0,
    paused: !!paused,
    speed: parseFloat(speed) || 1,
    quality: quality || null,
    subtitleLang: subtitleLang || null,
    subtitlesOn: !!subtitlesOn,
    updatedAt: Date.now(),
  };
  watchingNow.set(req.user.id, entry);
  broadcastWatchingToAdmins();
  pushCowatchUpdate(req.user.id, entry); // real-time push to co-watching admins
  res.json({ ok: true });
});

app.post('/api/watching/stop', requireAuth, (req, res) => {
  watchingNow.delete(req.user.id);
  broadcastWatchingToAdmins();
  res.json({ ok: true });
});

app.get('/api/admin/watching', requireAdmin, async (req, res) => {
  const cfg = await dbGet('SELECT allow_co_watch FROM admin_settings WHERE id = 1');
  if (!cfg?.allow_co_watch) return res.status(403).json({ error: 'Co-watch is disabled' });
  const now = Date.now();
  const active = [];
  for (const entry of watchingNow.values()) {
    if (now - entry.updatedAt < 35000) active.push(entry);
  }
  res.json({ watching: active });
});

app.get('/api/admin/watching/:userId', requireAdmin, async (req, res) => {
  const cfg = await dbGet('SELECT allow_co_watch FROM admin_settings WHERE id = 1');
  if (!cfg?.allow_co_watch) return res.status(403).json({ error: 'Co-watch is disabled' });
  const entry = watchingNow.get(parseInt(req.params.userId));
  if (!entry) return res.status(404).json({ error: 'User not currently watching' });
  res.json(entry);
});

// ─── Bandwidth stats ─────────────────────────────────────────────────────────

app.get('/api/admin/bandwidth', requireAdmin, async (req, res) => {
  const users = await dbAll('SELECT id, username FROM users');
  const userMap = new Map(users.map(u => [u.id, u.username]));

  const now = Math.floor(Date.now() / BW_BUCKET_MS) * BW_BUCKET_MS;
  const times = Array.from({ length: BW_BUCKETS }, (_, i) => now - (BW_BUCKETS - 1 - i) * BW_BUCKET_MS);

  const totalData = times.map(t => {
    const entry = bwTotal.find(e => e.t === t);
    return entry ? entry.bytes : 0;
  });

  const usersData = [];
  for (const [userId, log] of bwPerUser.entries()) {
    const data = times.map(t => {
      const entry = log.find(e => e.t === t);
      return entry ? entry.bytes : 0;
    });
    if (data.some(b => b > 0)) {
      usersData.push({ userId, username: userMap.get(userId) || `User ${userId}`, data });
    }
  }

  res.json({ times, total: totalData, users: usersData });
});

// ─── Watch history (user-facing) ─────────────────────────────────────────────

app.post('/api/watch/:videoId', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { title, channel, channelId, thumbnail } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    // Keep only last 200 history entries per user
    const count = await dbGet('SELECT COUNT(*) as cnt FROM watch_history WHERE user_id = ?', [req.user.id]);
    if (count.cnt >= 200) {
      await dbRun('DELETE FROM watch_history WHERE user_id = ? AND id = (SELECT MIN(id) FROM watch_history WHERE user_id = ?)', [req.user.id, req.user.id]);
    }
    // Check if already watched recently (last 30 min), don't duplicate
    const recent = await dbGet(`SELECT id FROM watch_history WHERE user_id = ? AND video_id = ? AND user_hidden = 0 AND watched_at > datetime('now', '-30 minutes')`, [req.user.id, videoId]);
    if (!recent) {
      await dbRun('INSERT INTO watch_history (user_id, video_id, title, channel, channel_id, thumbnail) VALUES (?,?,?,?,?,?)', [req.user.id, videoId, title, channel || '', channelId || '', thumbnail || '']);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/watch/history', requireAuth, async (req, res) => {
  try {
    const history = await dbAll('SELECT * FROM watch_history WHERE user_id = ? AND user_hidden = 0 ORDER BY watched_at DESC LIMIT 50', [req.user.id]);
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/watch/history', requireAuth, async (req, res) => {
  try {
    await dbRun('UPDATE watch_history SET user_hidden = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── User preferences (feed settings) ────────────────────────────────────────

const ALLOWED_DEFAULT_PLATFORMS = new Set(['', 'home', 'feed', 'shorts', 'bilibili', 'twitch']);

app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    let prefs = await dbGet('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    if (!prefs) {
      prefs = { user_id: req.user.id, subscriptions_weight: 1.0, trending_weight: 0.5, show_trending: 1, use_algorithm: 1, preferred_categories: '{}', default_platform: '' };
    }
    res.json({ preferences: { ...prefs, default_platform: prefs.default_platform || '', preferred_categories: JSON.parse(prefs.preferred_categories || '{}') } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/preferences', requireAuth, async (req, res) => {
  try {
    const { subscriptions_weight, trending_weight, show_trending, use_algorithm, preferred_categories, default_platform } = req.body;
    let dp = null;
    if (default_platform !== undefined) {
      if (!ALLOWED_DEFAULT_PLATFORMS.has(default_platform)) {
        return res.status(400).json({ error: 'Invalid default_platform' });
      }
      dp = default_platform;
    }
    const existing = await dbGet('SELECT user_id FROM user_preferences WHERE user_id = ?', [req.user.id]);
    if (existing) {
      await dbRun(`UPDATE user_preferences SET 
        subscriptions_weight = COALESCE(?, subscriptions_weight),
        trending_weight = COALESCE(?, trending_weight),
        show_trending = COALESCE(?, show_trending),
        use_algorithm = COALESCE(?, use_algorithm),
        preferred_categories = COALESCE(?, preferred_categories),
        default_platform = COALESCE(?, default_platform),
        updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`, [
        subscriptions_weight ?? null,
        trending_weight ?? null,
        show_trending !== undefined ? (show_trending ? 1 : 0) : null,
        use_algorithm !== undefined ? (use_algorithm ? 1 : 0) : null,
        preferred_categories !== undefined ? JSON.stringify(preferred_categories) : null,
        dp,
        req.user.id,
      ]);
    } else {
      await dbRun(`INSERT INTO user_preferences (user_id, subscriptions_weight, trending_weight, show_trending, use_algorithm, preferred_categories, default_platform) VALUES (?,?,?,?,?,?,?)`, [
        req.user.id,
        subscriptions_weight ?? 1.0,
        trending_weight ?? 0.5,
        show_trending !== undefined ? (show_trending ? 1 : 0) : 1,
        use_algorithm !== undefined ? (use_algorithm ? 1 : 0) : 1,
        preferred_categories !== undefined ? JSON.stringify(preferred_categories) : '{}',
        dp ?? '',
      ]);
    }
    const prefs = await dbGet('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    res.json({ preferences: { ...prefs, default_platform: prefs.default_platform || '', preferred_categories: JSON.parse(prefs.preferred_categories || '{}') } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(currentPassword || '', user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await dbRun('UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?', [hash, encrypt(newPassword), req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/delete-account', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(password || '', user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });
    await dbRun('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
    await dbRun('DELETE FROM watch_history WHERE user_id = ?', [req.user.id]);
    await dbRun('DELETE FROM user_preferences WHERE user_id = ?', [req.user.id]);
    await dbRun('DELETE FROM subscriptions WHERE user_id = ?', [req.user.id]);
    try { await dbRun('DELETE FROM saved_videos WHERE user_id = ?', [req.user.id]); } catch {}
    await dbRun('DELETE FROM users WHERE id = ?', [req.user.id]);
    res.clearCookie('session');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Subscription endpoints ──────────────────────────────────────────────────

// Normalize the platform string coming from clients. Anything we don't
// recognize falls back to 'youtube' so legacy callers (which never sent the
// field) continue to behave exactly as before.
function normalizePlatform(p) {
  const v = String(p || '').toLowerCase();
  return (v === 'bilibili' || v === 'twitch') ? v : 'youtube';
}

app.get('/api/subscriptions', requireAuth, async (req, res) => {
  const platform = req.query.platform ? normalizePlatform(req.query.platform) : null;
  const subs = platform
    ? await dbAll('SELECT * FROM subscriptions WHERE user_id = ? AND platform = ? ORDER BY subscribed_at DESC', [req.user.id, platform])
    : await dbAll('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY subscribed_at DESC', [req.user.id]);
  res.json({ subscriptions: subs });
});

app.post('/api/subscriptions', requireAuth, async (req, res) => {
  const { channelId, channelName, channelAvatar } = req.body;
  const platform = normalizePlatform(req.body.platform);
  if (!channelId || !channelName) return res.status(400).json({ error: 'channelId and channelName required' });
  try {
    await dbRun('INSERT OR REPLACE INTO subscriptions (user_id, platform, channel_id, channel_name, channel_avatar) VALUES (?,?,?,?,?)',
      [req.user.id, platform, String(channelId), channelName, channelAvatar || '']);
    res.json({ ok: true, platform });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/subscriptions/:channelId', requireAuth, async (req, res) => {
  const platform = normalizePlatform(req.query.platform || req.body?.platform);
  await dbRun('DELETE FROM subscriptions WHERE user_id = ? AND platform = ? AND channel_id = ?',
    [req.user.id, platform, req.params.channelId]);
  res.json({ ok: true });
});

app.get('/api/subscriptions/:channelId/status', requireAuth, async (req, res) => {
  const platform = normalizePlatform(req.query.platform);
  const row = await dbGet('SELECT 1 FROM subscriptions WHERE user_id = ? AND platform = ? AND channel_id = ?',
    [req.user.id, platform, req.params.channelId]);
  res.json({ subscribed: !!row, platform });
});

app.post('/api/subscriptions/:channelId', requireAuth, async (req, res) => {
  const { channelId } = req.params;
  const { channelName, channelAvatar } = req.body;
  const platform = normalizePlatform(req.body?.platform || req.query.platform);
  if (!channelName) return res.status(400).json({ error: 'channelName required' });
  try {
    await dbRun('INSERT OR REPLACE INTO subscriptions (user_id, platform, channel_id, channel_name, channel_avatar) VALUES (?,?,?,?,?)',
      [req.user.id, platform, String(channelId), channelName, channelAvatar || '']);
    res.json({ ok: true, platform });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Saved videos endpoints ──────────────────────────────────────────────────

app.get('/api/saved', requireAuth, async (req, res) => {
  const videos = await dbAll('SELECT * FROM saved_videos WHERE user_id = ? ORDER BY saved_at DESC', [req.user.id]);
  res.json({ videos: videos.map(v => ({
    id: v.video_id,
    title: v.title,
    thumbnail: v.thumbnail,
    channel: v.channel,
    channelId: v.channel_id,
    channelAvatar: v.channel_avatar,
    duration: v.duration,
    views: v.views,
    savedAt: v.saved_at,
  })) });
});

app.post('/api/saved/:videoId', requireAuth, async (req, res) => {
  const { videoId } = req.params;
  const { title, thumbnail, channel, channelId, channelAvatar, duration, views } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    await dbRun(
      `INSERT OR REPLACE INTO saved_videos (user_id, video_id, title, thumbnail, channel, channel_id, channel_avatar, duration, views) VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.user.id, videoId, title, thumbnail || '', channel || '', channelId || '', channelAvatar || '', duration || '', views || '']
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/saved/:videoId', requireAuth, async (req, res) => {
  await dbRun('DELETE FROM saved_videos WHERE user_id = ? AND video_id = ?', [req.user.id, req.params.videoId]);
  res.json({ ok: true });
});

app.get('/api/saved/:videoId/status', requireAuth, async (req, res) => {
  const row = await dbGet('SELECT 1 FROM saved_videos WHERE user_id = ? AND video_id = ?', [req.user.id, req.params.videoId]);
  res.json({ saved: !!row });
});

// ─── YouTube helpers ─────────────────────────────────────────────────────────

// ─── Chapter parsing ─────────────────────────────────────────────────────────
function parseChaptersFromDescription(description, videoDuration) {
  if (!description) return [];
  const lines = description.split('\n');
  const chapters = [];
  // Match patterns like "0:00", "1:30", "1:02:30"
  const tsRe = /^(?:(\d+):)?(\d+):(\d{2})\b/;
  for (const line of lines) {
    const m = line.match(tsRe);
    if (!m) continue;
    const h = parseInt(m[1] || 0);
    const mn = parseInt(m[2]);
    const s = parseInt(m[3]);
    const time = h * 3600 + mn * 60 + s;
    // Everything after the timestamp, stripping common separators
    const title = line.replace(tsRe, '').replace(/^\s*[-–—|·•:]\s*/, '').trim();
    if (title && time >= 0) chapters.push({ time, title });
  }
  // Must have at least 2 chapters and the first must be at 0:00
  if (chapters.length < 2 || chapters[0].time !== 0) return [];
  // Deduplicate by time
  const seen = new Set();
  const deduped = chapters.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });
  // Add endTime for each chapter
  for (let i = 0; i < deduped.length; i++) {
    deduped[i].endTime = deduped[i + 1]?.time ?? (videoDuration || 0);
  }
  return deduped;
}

function extractChaptersFromInfo(info, videoDuration) {
  try {
    const playerOverlays = info.player_overlays;
    if (!playerOverlays) return [];
    // Try the observe array / get method
    let mmBar = null;
    if (typeof playerOverlays.get === 'function') {
      mmBar = playerOverlays.get('MultiMarkersPlayerBar');
    } else if (Array.isArray(playerOverlays)) {
      mmBar = playerOverlays.find(n => n?.type === 'MultiMarkersPlayerBar');
    }
    if (!mmBar?.markers_map) return [];
    for (const marker of mmBar.markers_map) {
      const chaps = marker?.value?.chapters;
      if (chaps?.length >= 2) {
        const result = chaps.map((c, i, arr) => ({
          title: String(c.title),
          time: Math.floor((c.time_range_start_millis || 0) / 1000),
          endTime: i + 1 < arr.length
            ? Math.floor((arr[i + 1].time_range_start_millis || 0) / 1000)
            : (videoDuration || 0),
        }));
        if (result.length >= 2) return result;
      }
    }
  } catch {}
  return [];
}

async function getVideoInfo(videoId) {
  const cached = infoCache.get(videoId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.info;

  if (!youtube) throw new Error('YouTube API not initialized');
  const info = await youtube.getInfo(videoId);
  if (!info) throw new Error('No video info returned');

  infoCache.set(videoId, { info, ts: Date.now() });
  return info;
}

function getFormatsFromInfo(info) {
  return {
    videoFormats: info.streaming_data?.formats || [],
    adaptiveFormats: info.streaming_data?.adaptive_formats || [],
    duration: info.basic_info?.duration || 0,
    title: info.basic_info?.title || 'Video',
  };
}

function selectVideoFormat(formats, targetHeight) {
  const all = [...formats.videoFormats, ...formats.adaptiveFormats].filter(f => f.has_video && f.height);
  if (all.length === 0) throw new Error('No video formats found');
  all.sort((a, b) => {
    const hDiff = Math.abs(a.height - targetHeight) - Math.abs(b.height - targetHeight);
    if (hDiff !== 0) return hDiff;
    return ((a.mime_type || '').includes('mp4') ? 0 : 1) - ((b.mime_type || '').includes('mp4') ? 0 : 1);
  });
  return all[0];
}

function selectAudioFormat(formats) {
  const all = [...formats.videoFormats, ...formats.adaptiveFormats].filter(f => f.has_audio && !f.has_video);
  if (all.length === 0) throw new Error('No audio formats found');
  all.sort((a, b) => {
    const aMp4 = (a.mime_type || '').includes('mp4') ? 0 : 1;
    const bMp4 = (b.mime_type || '').includes('mp4') ? 0 : 1;
    if (aMp4 !== bMp4) return aMp4 - bMp4;
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
  return all[0];
}

function selectBestFormat(formats, qualityLimit = 720, isAudio = false) {
  if (isAudio) return selectAudioFormat(formats);
  return selectVideoFormat(formats, qualityLimit);
}

// Build yt-dlp args with full bot bypass support
function buildYtDlpArgs(client = 'tv_embedded', extraArgs = []) {
  const args = [];

  // Cookies (most effective bypass)
  if (hasCookies()) {
    args.push('--cookies', COOKIES_PATH);
  }

  // Extractor args with optional visitor_data and po_token
  let extractorArg = `youtube:player_client=${client}`;
  if (YOUTUBE_VISITOR_DATA) extractorArg += `;visitor_data=${YOUTUBE_VISITOR_DATA}`;
  if (YOUTUBE_PO_TOKEN && YOUTUBE_VISITOR_DATA) {
    extractorArg += `;po_token=${YOUTUBE_VISITOR_DATA}+${YOUTUBE_PO_TOKEN}`;
  }
  args.push('--extractor-args', extractorArg);

  args.push('--add-headers', 'Origin:https://www.youtube.com');
  args.push('--add-headers', 'Referer:https://www.youtube.com/');

  args.push(...extraArgs);
  return args;
}

// yt-dlp with multiple client fallbacks and bot bypass
async function getYtDlpFormats(videoId, attempt = 0) {
  const cached = ytdlpCache.get(videoId);
  if (cached && Date.now() - cached.ts < YTDLP_TTL) return cached;

  const clients = ['tv_embedded', 'android_vr', 'mweb', 'android', 'ios', 'web'];
  const client = clients[attempt % clients.length];

  console.log(`[ytdlp] ${videoId} attempt ${attempt + 1} client=${client} cookies=${hasCookies()} po_token=${!!YOUTUBE_PO_TOKEN}`);

  const ytdlpArgs = buildYtDlpArgs(client);

  const raw = await new Promise((resolve, reject) => {
    const args = [
      '--no-playlist', '--quiet', '--no-warnings',
      ...ytdlpArgs,
      '-j', `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const proc = spawn(YTDLP, args, {
      env: { ...process.env, HTTP_USER_AGENT: getRandomUA() }
    });

    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim().substring(0, 300)}`));
      try { resolve(JSON.parse(out)); } catch(e) { reject(new Error('Failed to parse yt-dlp JSON')); }
    });
    proc.on('error', reject);
  });

  const formats = (raw.formats || []).filter(f => f.url);
  const meta = {
    duration: raw.duration || 0,
    title: raw.fulltitle || raw.title || '',
    description: raw.description || '',
    uploader: raw.uploader || '',
    thumbnail: raw.thumbnail || '',
  };

  const subtitles = {};
  if (raw.subtitles) {
    for (const [lang, subs] of Object.entries(raw.subtitles)) {
      if (subs && subs.length > 0) subtitles[lang] = subs.map(s => ({ url: s.url, name: s.name, ext: s.ext }));
    }
  }

  const automaticCaptions = {};
  if (raw.automatic_captions) {
    for (const [lang, subs] of Object.entries(raw.automatic_captions)) {
      if (subs && subs.length > 0) automaticCaptions[lang] = subs.map(s => ({ url: s.url, name: s.name, ext: s.ext }));
    }
  }

  const result = { formats, meta, subtitles, automaticCaptions, ts: Date.now() };
  ytdlpCache.set(videoId, result);
  console.log(`[ytdlp] Got ${formats.length} formats for ${videoId}`);
  return result;
}

async function _doYtDlpFormatsWithRetry(videoId) {
  const clients = ['tv_embedded', 'android_vr', 'mweb', 'android', 'ios', 'web'];
  let lastError;
  for (let i = 0; i < clients.length; i++) {
    try {
      if (i > 0) ytdlpCache.delete(videoId);
      return await getYtDlpFormats(videoId, i);
    } catch (e) {
      lastError = e;
      const isBotError = e.message.includes('bot') || e.message.includes('Sign in') ||
        e.message.includes('403') || e.message.includes('confirm') || e.message.includes('429');
      if (!isBotError) throw e;
      console.log(`[ytdlp] Bot/rate error with client ${clients[i]}, trying next... (${e.message.substring(0, 80)})`);
      if (i < clients.length - 1) {
        // Human-like delay: base + random jitter so retries don't look robotic
        const base = 1500 + i * 1000;
        const jitter = Math.floor(Math.random() * 1000);
        await new Promise(r => setTimeout(r, base + jitter));
      }
    }
  }
  throw lastError;
}

async function getYtDlpFormatsWithRetry(videoId) {
  // Return cached result immediately if still fresh
  const cached = ytdlpCache.get(videoId);
  if (cached && Date.now() - cached.ts < YTDLP_TTL) return cached;

  // Deduplicate concurrent callers — all share the same in-flight promise
  if (ytdlpInFlight.has(videoId)) {
    return ytdlpInFlight.get(videoId);
  }

  const promise = _doYtDlpFormatsWithRetry(videoId).finally(() => {
    ytdlpInFlight.delete(videoId);
  });
  ytdlpInFlight.set(videoId, promise);
  return promise;
}

// ─── Multi-platform support: Bilibili + Twitch ──────────────────────────────
// Generic yt-dlp extractor used for non-YouTube URLs (no YouTube-specific
// bot-bypass args). Returns the same shape as getYtDlpFormatsWithRetry so
// the existing pickYtDlpVideo / pickYtDlpAudio / muxToResponse logic works
// unchanged.
const genericCache = new Map();           // cacheKey -> { ts, formats, meta, ... }
const genericInFlight = new Map();        // cacheKey -> Promise
const GENERIC_TTL = 10 * 60 * 1000;       // 10 min — non-YT URLs expire too

// Bilibili requires a real buvid3 cookie that's been issued by their server,
// otherwise the playurl endpoint returns HTTP 412 (anti-crawler). We fetch
// one lazily from their public SPI endpoint and cache it for an hour.
const BILI_COOKIES_PATH = path.join(os.tmpdir(), 'bili_cookies.txt');
let biliCookieTs = 0;
const BILI_COOKIE_TTL = 60 * 60 * 1000; // 1h

async function ensureBilibiliCookies() {
  if (biliCookieTs && Date.now() - biliCookieTs < BILI_COOKIE_TTL && fs.existsSync(BILI_COOKIES_PATH)) {
    return BILI_COOKIES_PATH;
  }
  const r = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
    headers: BILIBILI_HEADERS,
  });
  if (!r.ok) throw new Error(`bili spi HTTP ${r.status}`);
  const j = await r.json();
  const b3 = j.data?.b_3;
  const b4 = j.data?.b_4;
  if (!b3) throw new Error('bili spi: no buvid3 returned');

  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  // Netscape cookies.txt format: domain, includeSubdomains, path, secure, expiry, name, value
  const lines = [
    '# Netscape HTTP Cookie File',
    `.bilibili.com\tTRUE\t/\tFALSE\t${expires}\tbuvid3\t${b3}`,
    `.bilibili.com\tTRUE\t/\tFALSE\t${expires}\tb_nut\t${Math.floor(Date.now() / 1000)}`,
  ];
  if (b4) lines.push(`.bilibili.com\tTRUE\t/\tFALSE\t${expires}\tbuvid4\t${b4}`);
  fs.writeFileSync(BILI_COOKIES_PATH, lines.join('\n') + '\n');
  biliCookieTs = Date.now();
  console.log(`[bili] refreshed cookies (buvid3=${b3.substring(0, 16)}...)`);
  return BILI_COOKIES_PATH;
}

async function _doExtractGeneric(url) {
  const args = [
    '--no-playlist', '--quiet', '--no-warnings',
  ];

  if (url.includes('bilibili.com')) {
    try {
      const cookiesPath = await ensureBilibiliCookies();
      args.push('--cookies', cookiesPath);
    } catch (e) {
      console.warn('[bili cookies]', e.message);
    }
    args.push(
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-headers', 'Referer:https://www.bilibili.com/',
    );
  }

  args.push('-j', url);
  const raw = await new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { env: { ...process.env } });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim().substring(0, 300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('Failed to parse yt-dlp JSON')); }
    });
    proc.on('error', reject);
  });

  const formats = (raw.formats || []).filter(f => f.url);
  const meta = {
    duration: raw.duration || 0,
    title: raw.fulltitle || raw.title || '',
    description: raw.description || '',
    uploader: raw.uploader || raw.channel || '',
    thumbnail: raw.thumbnail || '',
    isLive: !!raw.is_live,
  };

  return { formats, meta, raw, ts: Date.now() };
}

async function extractGeneric(url, cacheKey) {
  const key = cacheKey || url;
  const cached = genericCache.get(key);
  if (cached && Date.now() - cached.ts < GENERIC_TTL) return cached;

  if (genericInFlight.has(key)) return genericInFlight.get(key);

  const promise = _doExtractGeneric(url)
    .then(result => { genericCache.set(key, result); return result; })
    .finally(() => { genericInFlight.delete(key); });
  genericInFlight.set(key, promise);
  return promise;
}

// Single-input HLS muxer for Twitch (combined audio+video stream).
// Reads an HLS playlist URL with ffmpeg and remuxes to fragmented mp4
// for MSE consumption. Live streams skip the seek argument.
function muxHlsToResponse(hlsUrl, res, signal, seekSeconds = 0, isLive = false) {
  return new Promise((resolve, reject) => {
    if (!hlsUrl) return reject(new Error('Missing HLS URL'));

    const headers = [
      `User-Agent: ${getRandomUA()}`,
      'Accept: */*',
      'Accept-Language: en-US,en;q=0.9',
      'Origin: https://www.twitch.tv',
      'Referer: https://www.twitch.tv/',
    ].join('\r\n') + '\r\n';

    const args = ['-loglevel', 'error'];
    args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto');
    args.push('-probesize', '500k', '-analyzeduration', '500k');
    args.push('-headers', headers);
    args.push('-reconnect', '1');
    args.push('-reconnect_streamed', '1');
    args.push('-reconnect_on_network_error', '1');
    args.push('-reconnect_delay_max', '5');
    if (!isLive && seekSeconds > 0) args.push('-ss', seekSeconds.toFixed(3));
    args.push('-i', hlsUrl);

    // Twitch's HLS variant has video, audio, and a timed_id3 data track.
    // Map the first video and first audio stream explicitly so ffmpeg never
    // tries to copy the data track into the fmp4 output (which it can't).
    args.push('-map', '0:v:0');
    args.push('-map', '0:a:0?');
    args.push('-c', 'copy');
    // Twitch HLS audio is raw AAC in ADTS frames. The MP4 muxer needs
    // AudioSpecificConfig (ASC) instead, so apply the stock bitstream
    // filter — without this every packet fails with "Malformed AAC
    // bitstream detected" / "Operation not permitted" and ffmpeg exits.
    args.push('-bsf:a', 'aac_adtstoasc');
    // For LIVE streams the playlist's PTS starts at the broadcast time
    // (billions of 90 kHz ticks). With -copyts + empty_moov we'd hit
    // "Track 0 starts with a nonzero dts ..., while the moov already has
    // been written" and the muxer would refuse every packet. Dropping
    // -copyts shifts the output to start at PTS=0, which is exactly what
    // MSE expects when there's no seek baseline. For VOD seeks we keep
    // -copyts so client currentTime stays aligned with fragment PTS.
    if (!isLive) {
      args.push('-copyts');
    }
    args.push('-avoid_negative_ts', 'make_non_negative');
    args.push('-max_muxing_queue_size', '4096');
    args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof');
    args.push('-f', 'mp4', 'pipe:1');

    console.log(`[ffmpeg-hls] Streaming ${isLive ? 'LIVE' : 'VOD'} seek=${seekSeconds}s`);

    const proc = spawn(FFMPEG, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const onAbort = () => { try { proc.kill('SIGKILL'); } catch {} };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    proc.stdout.pipe(res);

    proc.on('error', e => {
      if (signal) signal.removeEventListener?.('abort', onAbort);
      reject(e);
    });
    proc.on('close', code => {
      if (signal) signal.removeEventListener?.('abort', onAbort);
      try { res.end(); } catch {}
      if (code === 0 || signal?.aborted) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().substring(0, 200)}`));
    });
  });
}

// ─── Bilibili helpers ────────────────────────────────────────────────────────
const BILIBILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
};

function bilibiliVideoUrl(id) {
  // BV-prefixed IDs are the standard bilibili identifier
  return `https://www.bilibili.com/video/${id}/`;
}

function formatDurationSeconds(s) {
  s = parseInt(s, 10) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatDurationMMSS(text) {
  // Bilibili search returns "MM:SS" or "HH:MM:SS" already
  if (!text) return '';
  if (typeof text === 'number') return formatDurationSeconds(text);
  return String(text);
}

function bilibiliMapVideo(item) {
  // item shape varies between popular/search/etc. — be defensive
  const bvid = item.bvid || item.id || '';
  const title = (item.title || '').replace(/<[^>]+>/g, ''); // strip <em> highlights
  let pic = item.pic || item.cover || '';
  if (pic && pic.startsWith('//')) pic = 'https:' + pic;
  if (pic && pic.startsWith('http://')) pic = 'https://' + pic.slice(7);
  // Proxy thumbnails through our server to dodge bilibili hotlink protection
  const thumbnail = pic ? `/api/img-proxy?url=${encodeURIComponent(pic)}` : '';

  const channel = item.author || item.owner?.name || '';
  const channelId = String(item.mid || item.owner?.mid || '');
  const views = item.play
    ? (typeof item.play === 'number'
        ? `${item.play.toLocaleString()} views`
        : `${item.play} views`)
    : (item.stat?.view ? `${item.stat.view.toLocaleString()} views` : '');

  const duration = item.duration
    ? formatDurationMMSS(item.duration)
    : (item.length ? String(item.length) : '');

  return {
    id: bvid,
    platform: 'bilibili',
    title,
    thumbnail,
    duration,
    views,
    channel,
    channelId,
    channelAvatar: '',
    published: item.pubdate
      ? new Date(item.pubdate * 1000).toLocaleDateString()
      : '',
    authors: channel ? [{ name: channel, id: channelId, avatar: '' }] : [],
  };
}

// Direct Bilibili extractor — bypasses yt-dlp because yt-dlp's bilibili
// playurl call returns 412 from datacenter IPs. Bilibili's own API works
// fine when given a real buvid3 cookie + proper Referer/Origin.
async function extractBilibiliFormats(bvid) {
  await ensureBilibiliCookies();
  // Read the cached cookie back — we wrote it in netscape format
  const cookieFile = fs.readFileSync(BILI_COOKIES_PATH, 'utf8');
  const cookieMap = {};
  for (const line of cookieFile.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 7) cookieMap[parts[5]] = parts[6];
  }
  const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');

  const headers = {
    ...BILIBILI_HEADERS,
    'Origin': 'https://www.bilibili.com',
    'Cookie': cookieHeader,
  };

  // 1) view → cid + metadata
  const viewR = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { headers });
  if (!viewR.ok) throw new Error(`bilibili view HTTP ${viewR.status}`);
  const viewJ = await viewR.json();
  if (viewJ.code !== 0) throw new Error(`bilibili view code=${viewJ.code}: ${viewJ.message}`);
  const v = viewJ.data;
  const cid = v.cid;
  const aid = v.aid;
  const duration = v.duration || 0;
  const title = v.title || '';

  // 2) playurl with fnval=4048 → DASH manifest with separate V/A
  // qn=120 = 4K, fourk=1 enables 4K. fnval bitmask 4048 = DASH+HDR+4K+...
  const playR = await fetch(
    `https://api.bilibili.com/x/player/wbi/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=120&fnval=4048&fourk=1`,
    { headers }
  );
  if (!playR.ok) throw new Error(`bilibili playurl HTTP ${playR.status}`);
  const playJ = await playR.json();
  if (playJ.code !== 0) throw new Error(`bilibili playurl code=${playJ.code}: ${playJ.message}`);
  const dash = playJ.data?.dash;
  if (!dash) throw new Error('bilibili: no DASH stream available');

  // Convert to yt-dlp-style formats array
  const formats = [];
  for (const vid of dash.video || []) {
    formats.push({
      format_id: `dash-v-${vid.id}`,
      ext: 'm4s',
      vcodec: vid.codecs || 'avc1',
      acodec: 'none',
      width: vid.width,
      height: vid.height,
      fps: vid.frameRate ? parseFloat(vid.frameRate) : null,
      tbr: vid.bandwidth ? vid.bandwidth / 1000 : null,
      url: vid.baseUrl || vid.base_url,
    });
  }
  for (const aud of dash.audio || []) {
    formats.push({
      format_id: `dash-a-${aud.id}`,
      ext: 'm4s',
      vcodec: 'none',
      acodec: aud.codecs || 'mp4a',
      tbr: aud.bandwidth ? aud.bandwidth / 1000 : null,
      url: aud.baseUrl || aud.base_url,
    });
  }

  return {
    formats,
    meta: { duration, title, isLive: false },
    ts: Date.now(),
  };
}

async function extractBilibili(bvid) {
  const key = `bb-direct:${bvid}`;
  const cached = genericCache.get(key);
  if (cached && Date.now() - cached.ts < GENERIC_TTL) return cached;
  if (genericInFlight.has(key)) return genericInFlight.get(key);

  const promise = extractBilibiliFormats(bvid)
    .then(result => { genericCache.set(key, result); return result; })
    .finally(() => { genericInFlight.delete(key); });
  genericInFlight.set(key, promise);
  return promise;
}

async function bilibiliPopular(limit = 30) {
  const r = await fetch(`https://api.bilibili.com/x/web-interface/popular?ps=${limit}&pn=1`, {
    headers: BILIBILI_HEADERS,
  });
  if (!r.ok) throw new Error(`bilibili popular HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`bilibili popular code=${j.code}: ${j.message}`);
  const list = j.data?.list || [];
  return list.filter(v => v.bvid).map(bilibiliMapVideo);
}

async function bilibiliSearch(query, limit = 30) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=1&page_size=${limit}`;
  // Bilibili search requires a "buvid3" cookie or it returns code -412.
  // A random uuid-like value is enough for the public endpoint.
  const buvid = `B${Math.random().toString(36).slice(2, 12).toUpperCase()}-${Date.now()}infoc`;
  const r = await fetch(url, {
    headers: { ...BILIBILI_HEADERS, Cookie: `buvid3=${buvid}` },
  });
  if (!r.ok) throw new Error(`bilibili search HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`bilibili search code=${j.code}: ${j.message}`);
  const list = j.data?.result || [];
  return list.filter(v => v.bvid).slice(0, limit).map(bilibiliMapVideo);
}

// ─── Twitch helpers ──────────────────────────────────────────────────────────
// Public web client ID — same one twitch.tv uses for unauthenticated GQL
// queries. No secret involved.
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TWITCH_GQL = 'https://gql.twitch.tv/gql';

async function twitchGql(operationName, variables, sha256Hash) {
  const body = JSON.stringify([{
    operationName,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash } },
  }]);
  const r = await fetch(TWITCH_GQL, {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!r.ok) throw new Error(`twitch gql HTTP ${r.status}`);
  const j = await r.json();
  if (j[0]?.errors) throw new Error(`twitch gql errors: ${JSON.stringify(j[0].errors).substring(0, 200)}`);
  return j[0]?.data || {};
}

function twitchMapStream(s) {
  if (!s) return null;
  const broadcaster = s.broadcaster || s;
  const login = broadcaster.login || s.login || '';
  if (!login) return null;
  // Twitch live thumbnail template
  let thumb = s.previewImageURL || '';
  if (thumb) {
    thumb = thumb.replace('{width}', '440').replace('{height}', '248');
  } else {
    thumb = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg`;
  }
  const game = s.game?.displayName || s.game?.name || '';
  const title = s.broadcaster?.broadcastSettings?.title || s.title || s.broadcaster?.displayName || login;
  return {
    id: login,
    platform: 'twitch',
    isLive: true,
    title,
    thumbnail: thumb,
    duration: 'LIVE',
    views: s.viewersCount != null ? `${s.viewersCount.toLocaleString()} watching` : '',
    channel: broadcaster.displayName || login,
    channelId: broadcaster.id || '',
    channelAvatar: broadcaster.profileImageURL || '',
    published: game,
    authors: [{ name: broadcaster.displayName || login, id: broadcaster.id || '', avatar: broadcaster.profileImageURL || '' }],
  };
}

async function twitchTopStreams(limit = 30) {
  // Twitch GQL caps "first" at 30 — clamp here to avoid the
  // "argument 'first' value must be between 1 and 30" error.
  limit = Math.min(Math.max(limit, 1), 30);
  // Inline GraphQL query — twitch.tv's gql endpoint accepts raw queries
  // from any client with a valid Client-ID, no auth needed for read-only
  // public data.
  const inlineBody = JSON.stringify({
    query: `query Popular($limit: Int!) {
      streams(first: $limit, options: { sort: VIEWER_COUNT, freeformTags: [] }) {
        edges {
          node {
            id
            title
            viewersCount
            previewImageURL(width: 440, height: 248)
            broadcaster { id login displayName profileImageURL(width: 50) }
            game { id name displayName }
          }
        }
      }
    }`,
    variables: { limit },
  });
  const r = await fetch(TWITCH_GQL, {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
    body: inlineBody,
  });
  if (!r.ok) throw new Error(`twitch top HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(`twitch top: ${JSON.stringify(j.errors).substring(0, 200)}`);
  const edges = j.data?.streams?.edges || [];
  return edges.map(e => twitchMapStream(e.node)).filter(Boolean);
}

async function twitchSearch(query, limit = 30) {
  limit = Math.min(Math.max(limit, 1), 30);
  const inlineBody = JSON.stringify({
    query: `query Search($q: String!, $limit: Int!) {
      searchFor(userQuery: $q, platform: "web", options: { targets: [{ index: CHANNEL, limit: $limit }] }) {
        channels {
          items {
            id
            login
            displayName
            profileImageURL(width: 50)
            stream {
              id
              title
              viewersCount
              previewImageURL(width: 440, height: 248)
              game { id name displayName }
            }
          }
        }
      }
    }`,
    variables: { q: query, limit },
  });
  const r = await fetch(TWITCH_GQL, {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
    body: inlineBody,
  });
  if (!r.ok) throw new Error(`twitch search HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(`twitch search: ${JSON.stringify(j.errors).substring(0, 200)}`);
  const items = j.data?.searchFor?.channels?.items || [];
  // Show all matching channels, marking offline ones as such
  return items.map(ch => {
    if (ch.stream) {
      return twitchMapStream({
        ...ch.stream,
        broadcaster: { id: ch.id, login: ch.login, displayName: ch.displayName, profileImageURL: ch.profileImageURL },
      });
    }
    // Offline channel — still show but mark it
    return {
      id: ch.login,
      platform: 'twitch',
      isLive: false,
      offline: true,
      title: `${ch.displayName} (offline)`,
      thumbnail: ch.profileImageURL || '',
      duration: 'OFFLINE',
      views: '',
      channel: ch.displayName,
      channelId: ch.id,
      channelAvatar: ch.profileImageURL || '',
      published: '',
      authors: [{ name: ch.displayName, id: ch.id, avatar: ch.profileImageURL || '' }],
    };
  });
}

function pickYtDlpVideo(formats, targetHeight) {
  const video = formats.filter(f => f.vcodec !== 'none' && f.url);
  if (!video.length) throw new Error('No video formats from yt-dlp');
  video.sort((a, b) => {
    const hDiff = Math.abs((a.height || 0) - targetHeight) - Math.abs((b.height || 0) - targetHeight);
    if (hDiff !== 0) return hDiff;
    return ((a.vcodec || '').startsWith('avc') ? 0 : 1) - ((b.vcodec || '').startsWith('avc') ? 0 : 1);
  });
  return video[0];
}

function pickYtDlpAudio(formats) {
  // CRITICAL FIX: Also include formats that have both audio and video (for audio extraction)
  // Some YouTube formats have both, we can extract just the audio
  const audio = formats.filter(f => f.acodec !== 'none' && f.url);
  if (!audio.length) throw new Error('No audio formats from yt-dlp');
  audio.sort((a, b) => {
    // Prefer audio-only formats (no video)
    const aAudioOnly = a.vcodec === 'none' ? 0 : 1;
    const bAudioOnly = b.vcodec === 'none' ? 0 : 1;
    if (aAudioOnly !== bAudioOnly) return aAudioOnly - bAudioOnly;

    // Then prefer m4a/mp4
    const aM4a = a.ext === 'm4a' ? 0 : 1;
    const bM4a = b.ext === 'm4a' ? 0 : 1;
    if (aM4a !== bM4a) return aM4a - bM4a;

    // Then by bitrate
    return (b.tbr || 0) - (a.tbr || 0);
  });
  return audio[0];
}

function ytDlpAvailableHeights(formats) {
  return [...new Set(
    formats.filter(f => f.vcodec !== 'none' && f.height).map(f => f.height)
  )].sort((a, b) => b - a);
}

async function decipherUrl(format, info) {
  const url = await format.decipher(youtube.session.player);
  if (!url) throw new Error('Could not decipher stream URL');
  return `${url}&cpn=${info.cpn}`;
}

async function fetchFormatStream(format, info, signal, rangeHeader = null) {
  const fetchUrl = await decipherUrl(format, info);
  const headers = {
    'accept': '*/*',
    'origin': 'https://www.youtube.com',
    'referer': 'https://www.youtube.com',
    'DNT': '?1',
    'user-agent': getRandomUA(),
  };
  if (rangeHeader) headers['range'] = rangeHeader;

  const resp = await youtube.session.http.fetch_function(fetchUrl, {
    method: 'GET', headers, redirect: 'follow', signal,
  });
  if (!resp.ok) throw new Error(`Upstream fetch failed: ${resp.status}`);
  return resp;
}

function muxToResponse(videoUrl, audioUrl, res, signal, seekSeconds = 0, rangeHeader = null, isDownload = false, platform = 'youtube') {
  return new Promise((resolve, reject) => {
    if (!videoUrl || !audioUrl) {
      return reject(new Error(`Missing URL: video=${!!videoUrl}, audio=${!!audioUrl}`));
    }

    // ── Symmetric seek for tight A/V sync ─────────────────────────────────
    // Apply the SAME `-ss` value to both inputs. With `-c copy`, ffmpeg
    // performs a demuxer-level seek that lands on the keyframe at-or-before
    // the requested time for the video input, and at the nearest packet
    // boundary (≈ exact) for the audio input. Combined with `-copyts` the
    // original absolute PTS is preserved on both streams, so:
    //   • Video buffered range starts at K (= keyframe ≤ T)
    //   • Audio buffered range starts at ≈ T
    //   • Player at T plays both V and A at the same wall-clock PTS → in sync.
    //
    // Earlier code back-stepped the VIDEO input by 10 s in an attempt to
    // pre-warm the decoder; in practice that combined with `+igndts` (see
    // below) sometimes corrupted B-frame ordering after a seek across a
    // fragment boundary, producing the audible "audio leads, video catches
    // up" drift the user reported. Symmetric seek + DTS preservation fixes it.
    const ssArg = seekSeconds > 0 ? seekSeconds.toFixed(3) : null;
    const ssArgVideo = ssArg;
    const ssArgAudio = ssArg;

    const ytHeaders = [
      `User-Agent: ${getRandomUA()}`,
      'Accept: */*',
      'Accept-Language: en-US,en;q=0.9',
      'Origin: https://www.youtube.com',
      'Referer: https://www.youtube.com/',
    ].join('\r\n') + '\r\n';

    // Bilibili CDN enforces Referer hotlink protection — use bilibili-origin
    // headers when the platform is bilibili or any URL is on a known bilibili
    // CDN host. The CDN list includes Akamai mirrors (upos-*-mirrorakam.
    // akamaized.net) which the older URL sniffing missed and which caused 403s.
    const BILI_CDN_RE = /bilivideo\.com|hdslb\.com|mcdn\.bilivideo\.cn|upos-[a-z0-9]+-mirrorakam\.akamaized\.net|akamaized\.net/;
    const isBili = platform === 'bilibili'
      || BILI_CDN_RE.test(videoUrl) || BILI_CDN_RE.test(audioUrl);
    const biliHeaders = [
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept: */*',
      'Accept-Language: en-US,en;q=0.9',
      'Origin: https://www.bilibili.com',
      'Referer: https://www.bilibili.com/',
    ].join('\r\n') + '\r\n';
    const inputHeaders = isBili ? biliHeaders : ytHeaders;

    const args = ['-loglevel', 'error'];
    args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto');

    // ── Fast-start tuning ─────────────────────────────────────────────────
    // ffmpeg defaults to probing 5 MB / 5 s of input before producing any
    // output, which is what makes the first byte after a forward seek
    // arrive several seconds late. We can safely shrink this without
    // breaking the H.264 parameter sets that MSE needs in the init
    // segment: 500 KB is enough to capture the SPS/PPS NAL units (which
    // appear in the very first GOP of every YouTube stream) but small
    // enough to come down off the wire in well under a second. Going
    // lower than this — or setting analyzeduration to 0 — produces a
    // truncated `moov` box and the browser raises MEDIA_ERR_DECODE.
    const FAST_PROBE = ['-probesize', '500k', '-analyzeduration', '500k'];

    // Video input
    args.push(...FAST_PROBE);
    args.push('-headers', inputHeaders);
    args.push('-reconnect', '1');
    args.push('-reconnect_on_network_error', '1');
    args.push('-reconnect_delay_max', '5');
    if (ssArgVideo) args.push('-ss', ssArgVideo);
    args.push('-i', videoUrl);

    // Audio input
    args.push(...FAST_PROBE);
    args.push('-headers', inputHeaders);
    args.push('-reconnect', '1');
    args.push('-reconnect_on_network_error', '1');
    args.push('-reconnect_delay_max', '5');
    if (ssArgAudio) args.push('-ss', ssArgAudio);
    args.push('-i', audioUrl);

    args.push('-map', '0:v:0');
    args.push('-map', '1:a:0');
    args.push('-c:v', 'copy');
    args.push('-c:a', 'copy');
    // ── A/V sync ──────────────────────────────────────────────────────────
    // `-copyts` preserves the input's absolute PTS so the SourceBuffer
    // receives fragments with their true positions on the timeline. The
    // client side leaves `SourceBuffer.timestampOffset` at 0 so fragments
    // land at their true positions.
    //
    // We deliberately do NOT pass `-fflags +igndts`: with `-c copy`, the
    // demuxer's DTS values are required by the muxer to write correct
    // tfdt/tdtt boxes for B-frame heavy YouTube streams. Ignoring DTS
    // caused decode-order corruption that surfaced as A/V drift after
    // out-of-buffer seeks.
    args.push('-copyts');
    args.push('-avoid_negative_ts', 'make_non_negative');
    args.push('-max_muxing_queue_size', '4096');

    const movFlags = 'frag_keyframe+empty_moov+default_base_moof';
    args.push('-movflags', movFlags);
    args.push('-f', 'mp4');
    args.push('pipe:1');

    console.log(`[ffmpeg] Muxing video+audio seek=${seekSeconds}s isDownload=${isDownload}`);
    console.log(`[ffmpeg] Video: ${videoUrl.substring(0, 80)}...`);
    console.log(`[ffmpeg] Audio: ${audioUrl.substring(0, 80)}...`);
    console.log(`[ffmpeg] movflags=${movFlags}`);

    const proc = spawn(FFMPEG, args);

    if (signal) {
      signal.addEventListener('abort', () => {
        try { proc.kill('SIGTERM'); } catch {}
      }, { once: true });
    }

    let stderrData = '';
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) {
        stderrData += msg + '\n';
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
          console.error('[ffmpeg]', msg);
        }
      }
    });

    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Cache-Control', isDownload ? 'no-cache' : 'public, max-age=3600');

    proc.stdout.pipe(res);

    proc.stdout.on('error', err => {
      console.error('[ffmpeg] stdout error:', err.message);
    });

    proc.on('close', code => {
      if (code === 0 || code === null || res.writableEnded) {
        resolve();
      } else {
        console.error(`[ffmpeg] Exit ${code}`);
        if (stderrData) console.error('[ffmpeg stderr]', stderrData.substring(0, 500));
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

const searchContinuations = new Map();

app.get('/api/search', async (req, res) => {
  try {
    if (!youtube) return res.status(503).json({ error: 'API Initialising...' });
    const { q } = req.query;
    if (!q) return res.json({ videos: [], searchId: null });

    const results = await youtube.search(q, { type: 'video' });
    const searchId = crypto.randomBytes(8).toString('hex');
    searchContinuations.set(searchId, results);
    setTimeout(() => searchContinuations.delete(searchId), 30 * 60 * 1000);

    const videos = mapSearchResults(results.videos || []);
    const hasMore = typeof results.has_continuation === 'undefined' ? videos.length >= 10 : !!results.has_continuation;
    res.json({ videos, searchId, hasMore });
  } catch (error) {
    console.error('[search] error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/more', async (req, res) => {
  try {
    const { searchId } = req.query;
    if (!searchId) return res.status(400).json({ error: 'searchId required' });

    const prev = searchContinuations.get(searchId);
    if (!prev) return res.status(404).json({ error: 'Search session expired, please search again' });

    let next;
    try {
      next = await prev.getContinuation();
    } catch (e) {
      return res.status(404).json({ error: 'No more results', hasMore: false, videos: [] });
    }

    searchContinuations.set(searchId, next);
    const videos = mapSearchResults(next.videos || []);
    const hasMore = typeof next.has_continuation === 'undefined' ? videos.length >= 10 : !!next.has_continuation;
    res.json({ videos, searchId, hasMore });
  } catch (error) {
    console.error('[search/more] error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function splitCollabNames(name) {
  // Split on " and " or " & " to detect collaboration channel names
  const parts = name.split(/ and | & /i).map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function sanitizeChannelId(id) {
  if (!id || id === 'N/A' || id === 'n/a' || id.trim().length < 2) return '';
  return id;
}

function buildAuthors(v) {
  const arr = [];
  if (Array.isArray(v.authors) && v.authors.length > 0) {
    for (const a of v.authors) {
      if (a.name || a.id) {
        arr.push({ name: a.name || '', id: sanitizeChannelId(a.id), avatar: a.thumbnails?.[0]?.url || a.best_thumbnail?.url || '' });
      }
    }
  }
  if (arr.length === 0 && v.author && (v.author.name || v.author.id)) {
    const fullName = v.author.name || '';
    const primaryId = sanitizeChannelId(v.author.id);
    const primaryAvatar = v.author.best_thumbnail?.url || v.author.thumbnails?.[0]?.url || '';
    const parts = splitCollabNames(fullName);
    if (parts) {
      parts.forEach((name, i) => {
        arr.push({ name, id: i === 0 ? primaryId : '', avatar: i === 0 ? primaryAvatar : '' });
      });
    } else {
      arr.push({ name: fullName, id: primaryId, avatar: primaryAvatar });
    }
  }
  if (arr.length === 0 && v.channel && (v.channel.name || v.channel.id)) {
    arr.push({ name: v.channel.name || '', id: sanitizeChannelId(v.channel.id), avatar: '' });
  }
  return arr;
}

function mapSearchResults(videos) {
  return videos.map(v => {
    const authors = buildAuthors(v);
    return {
      id: v.id,
      title: v.title?.text || 'Video',
      thumbnail: v.thumbnails?.[0]?.url || '',
      duration: v.duration?.text || '0:00',
      views: v.view_count?.text || '0',
      channel: authors[0]?.name || 'Channel',
      channelId: authors[0]?.id || '',
      channelAvatar: authors[0]?.avatar || '',
      authors,
    };
  });
}

// ─── Channel search ──────────────────────────────────────────────────────────

app.get('/api/channel/search', async (req, res) => {
  try {
    if (!youtube) return res.status(503).json({ error: 'API Initialising...' });
    const { q } = req.query;
    if (!q) return res.json({ channels: [] });

    const results = await youtube.search(q, { type: 'video' });
    const seen = new Set();
    const channels = [];

    for (const v of (results.videos || [])) {
      const id = v.author?.id;
      const name = v.author?.name;
      if (id && name && !seen.has(id)) {
        seen.add(id);
        channels.push({
          id,
          name,
          avatar: v.author?.thumbnails?.[0]?.url || '',
          subscribers: '',
          description: '',
        });
      }
    }

    res.json({ channels });
  } catch (e) {
    console.error('[channel/search] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Lightweight channel info (name → id + avatar) ───────────────────────────

const channelInfoCache = new Map();

app.get('/api/channel/info', async (req, res) => {
  try {
    if (!youtube) return res.status(503).json({ error: 'API initialising' });
    const { name } = req.query;
    if (!name) return res.status(400).json({ id: '', avatar: '' });

    const cacheKey = name.toLowerCase().trim();
    if (channelInfoCache.has(cacheKey)) return res.json(channelInfoCache.get(cacheKey));

    const results = await youtube.search(name, { type: 'video' });
    const sn = name.toLowerCase().trim();

    let bestScore = 0;
    let bestInfo = null;

    for (const v of (results.videos || [])) {
      const authorName = (v.author?.name || '').toLowerCase().trim();
      if (!authorName) continue;
      let score = 0;
      if (authorName === sn) score = 4;
      else if (authorName.startsWith(sn) || sn.startsWith(authorName)) score = 3;
      else if (authorName.split(' ').some(w => w === sn) || sn.split(' ').some(w => w === authorName)) score = 2;
      else if (authorName.includes(sn) && !authorName.includes(' and ') && !authorName.includes(' & ')) score = 1;

      if (score > bestScore) {
        bestScore = score;
        bestInfo = {
          id: sanitizeChannelId(v.author?.id),
          avatar: v.author?.best_thumbnail?.url || v.author?.thumbnails?.[0]?.url || '',
        };
      }
      if (bestScore === 4) break;
    }

    const result = bestInfo || { id: '', avatar: '' };
    channelInfoCache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.json({ id: '', avatar: '' });
  }
});

// ─── Channel videos via yt-dlp ───────────────────────────────────────────────

const channelCache = new Map();
const CHANNEL_TTL = 10 * 60 * 1000;

// ─── Bilibili WBI signing for authenticated GET endpoints ───────────────────
// Bilibili guards a number of "/x/space/wbi/..." endpoints with a rolling
// HMAC-style signature ("w_rid" + "wts" query params). The keys come from
// /x/web-interface/nav and rotate every few hours, so we cache them per
// process. Without this the user-video listing returns code -352 (风控).
const BILI_WBI_MIXIN_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];
let biliWbiKey = null;
let biliWbiTs = 0;
const BILI_WBI_TTL = 60 * 60 * 1000;

async function getBilibiliWbiKey() {
  if (biliWbiKey && Date.now() - biliWbiTs < BILI_WBI_TTL) return biliWbiKey;
  // We deliberately reuse the buvid3 cookie set up by ensureBilibiliCookies —
  // /nav refuses anonymous calls from datacenter IPs without a real buvid.
  await ensureBilibiliCookies();
  const cookieFile = fs.readFileSync(BILI_COOKIES_PATH, 'utf8');
  const cookieMap = {};
  for (const line of cookieFile.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 7) cookieMap[parts[5]] = parts[6];
  }
  const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { ...BILIBILI_HEADERS, Cookie: cookieHeader },
  });
  if (!r.ok) throw new Error(`bili nav HTTP ${r.status}`);
  const j = await r.json();
  const wbi = j.data?.wbi_img || {};
  const imgKey = (wbi.img_url || '').split('/').pop().split('.')[0];
  const subKey = (wbi.sub_url || '').split('/').pop().split('.')[0];
  if (!imgKey || !subKey) throw new Error('bili nav: missing wbi keys');
  const concat = imgKey + subKey;
  const mixinKey = BILI_WBI_MIXIN_TABLE.map(i => concat[i]).join('').slice(0, 32);
  biliWbiKey = { mixinKey, cookieHeader };
  biliWbiTs = Date.now();
  return biliWbiKey;
}

async function biliWbiSign(params) {
  const { mixinKey } = await getBilibiliWbiKey();
  const all = { ...params, wts: Math.floor(Date.now() / 1000) };
  const keys = Object.keys(all).sort();
  // The official client strips !'()* before signing — match that behaviour
  // exactly or the server returns -352.
  const sanitize = v => String(v).replace(/[!'()*]/g, '');
  const queryStr = keys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(sanitize(all[k]))}`)
    .join('&');
  const wRid = crypto.createHash('md5').update(queryStr + mixinKey).digest('hex');
  return `${queryStr}&w_rid=${wRid}`;
}

async function fetchBilibiliChannelVideos(mid, page = 1, pageSize = 30) {
  const cacheKey = `ch:bili:${mid}:${page}-${pageSize}`;
  const cached = channelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHANNEL_TTL) return cached;

  let videos = [];
  let channelMeta = { id: String(mid), name: '', avatar: '', description: '' };
  try {
    const { cookieHeader } = await getBilibiliWbiKey();
    const signed = await biliWbiSign({ mid, ps: pageSize, pn: page, order: 'pubdate', platform: 'web' });
    const url = `https://api.bilibili.com/x/space/wbi/arc/search?${signed}`;
    const r = await fetch(url, {
      headers: { ...BILIBILI_HEADERS, Cookie: cookieHeader },
    });
    if (!r.ok) throw new Error(`bili user HTTP ${r.status}`);
    const j = await r.json();
    if (j.code !== 0) throw new Error(`bili user code=${j.code}: ${j.message}`);
    const list = j.data?.list?.vlist || [];
    videos = list.map(bilibiliMapVideo);
  } catch (e) {
    console.warn(`[bili-channel] mid=${mid} failed: ${e.message}`);
  }

  // Best-effort: pull display name + avatar from any video we got back so the
  // header on the channel page renders something useful even when /space/info
  // is risk-controlled.
  if (videos[0]) {
    channelMeta.name = videos[0].channel || '';
  }

  const result = { videos, channel: channelMeta, hasMore: videos.length >= pageSize, ts: Date.now() };
  channelCache.set(cacheKey, result);
  return result;
}

async function fetchTwitchChannelVideos(login, page = 1, pageSize = 20) {
  const cacheKey = `ch:twitch:${login}:${page}-${pageSize}`;
  const cached = channelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHANNEL_TTL) return cached;

  // GQL: live stream + recent VODs in one round-trip. The page param is
  // ignored for live status and applied to VODs via offset slicing on our
  // side, since the public schema doesn't expose paging cursors here.
  const body = JSON.stringify({
    query: `query U($login: String!, $first: Int!) {
      user(login: $login) {
        id login displayName profileImageURL(width: 150)
        stream {
          id title viewersCount previewImageURL(width: 440, height: 248)
          game { name displayName }
        }
        videos(first: $first, type: ARCHIVE, sort: TIME) {
          edges { node {
            id title lengthSeconds viewCount publishedAt
            previewThumbnailURL(width: 440, height: 248)
            game { name displayName }
          } }
        }
      }
    }`,
    variables: { login, first: Math.min(40, page * pageSize) },
  });

  let videos = [];
  let channelMeta = { id: login, name: login, avatar: '', description: '' };
  try {
    const r = await fetch(TWITCH_GQL, {
      method: 'POST',
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
      body,
    });
    if (!r.ok) throw new Error(`twitch user HTTP ${r.status}`);
    const j = await r.json();
    const u = j.data?.user;
    if (!u) throw new Error('twitch user: not found');
    channelMeta = {
      id: u.login, name: u.displayName || u.login,
      avatar: u.profileImageURL || '', description: '',
    };
    if (u.stream) {
      const live = twitchMapStream({ ...u.stream, broadcaster: u });
      // Force channelId=login for consistency with the subscription store —
      // every other Twitch surface in this app keys by login, not numeric id.
      if (live) videos.push({ ...live, channelId: u.login });
    }
    for (const e of (u.videos?.edges || [])) {
      const n = e.node;
      videos.push({
        id: n.id,
        platform: 'twitch',
        isLive: false,
        title: n.title || 'VOD',
        thumbnail: (n.previewThumbnailURL || '')
          .replace('{width}', '440').replace('{height}', '248'),
        duration: formatSecondsToTime(n.lengthSeconds || 0),
        views: n.viewCount != null ? `${Number(n.viewCount).toLocaleString()} views` : '',
        channel: u.displayName || u.login,
        channelId: u.login,
        channelAvatar: u.profileImageURL || '',
        published: n.publishedAt ? n.publishedAt.slice(0, 10) : '',
        authors: [{ name: u.displayName || u.login, id: u.login, avatar: u.profileImageURL || '' }],
      });
    }
  } catch (e) {
    console.warn(`[twitch-channel] login=${login} failed: ${e.message}`);
  }

  const result = { videos, channel: channelMeta, hasMore: false, ts: Date.now() };
  channelCache.set(cacheKey, result);
  return result;
}

// Single dispatch entry point used by /api/channel/videos and /api/feed so
// every callsite gets the right backend without duplicating the platform
// switch.
async function fetchChannelVideosForPlatform(platform, channelId, page = 1, pageSize = 60) {
  const p = String(platform || 'youtube').toLowerCase();
  if (p === 'bilibili') return fetchBilibiliChannelVideos(channelId, page, Math.min(50, pageSize));
  if (p === 'twitch') return fetchTwitchChannelVideos(channelId, page, Math.min(40, pageSize));
  return fetchChannelVideos(channelId, page, pageSize);
}

// FIXED: Correct URL logic for UC IDs vs @ handles vs plain names
async function fetchChannelVideos(channelId, page = 1, pageSize = 60) {
  const start = (page - 1) * pageSize + 1;
  const end = page * pageSize;
  const cacheKey = `ch:${channelId}:${start}-${end}`;
  const cached = channelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHANNEL_TTL) return cached;

  // Build URL priority list without mixing ID formats
  const urls = [];
  const isUCId = /^UC[a-zA-Z0-9_\-]{10,}$/.test(channelId);
  const isHandle = channelId.startsWith('@');

  if (isUCId) {
    // YouTube channel IDs always use /channel/UCxxx/videos
    urls.push(`https://www.youtube.com/channel/${channelId}/videos`);
  } else if (isHandle) {
    // Handle with @ prefix: /@handle/videos
    urls.push(`https://www.youtube.com/${channelId}/videos`);
  } else {
    // Plain name: try @handle, then /c/ (legacy custom URLs), then /channel/ as last resort
    urls.push(`https://www.youtube.com/@${channelId}/videos`);
    urls.push(`https://www.youtube.com/c/${channelId}/videos`);
    urls.push(`https://www.youtube.com/channel/${channelId}/videos`);
  }

  let entries = [];
  let channelMeta = {};

  for (const url of urls) {
    try {
      const ytdlpArgs = buildYtDlpArgs('tv_embedded');

      const raw = await new Promise((resolve, reject) => {
        const args = [
          '--flat-playlist', '--no-warnings', '--quiet',
          ...ytdlpArgs,
          '--playlist-items', `${start}-${end}`,
          '-J', url,
        ];
        const proc = spawn(YTDLP, args, {
          env: { ...process.env, HTTP_USER_AGENT: getRandomUA() }
        });
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          reject(new Error('yt-dlp timeout'));
        }, 45000);
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', d => { err += d; });
        proc.on('close', code => {
          clearTimeout(timer);
          if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${err.substring(0, 200)}`));
          const trimmed = out.trimStart();
          if (trimmed.startsWith('<')) return reject(new Error('yt-dlp returned HTML instead of JSON (channel may be restricted)'));
          try { resolve(JSON.parse(trimmed)); } catch { reject(new Error('JSON parse failed')); }
        });
        proc.on('error', e => { clearTimeout(timer); reject(e); });
      });

      entries = raw.entries || [];
      channelMeta = {
        name: raw.uploader || raw.channel || raw.title || '',
        avatar: raw.thumbnails?.[0]?.url || raw.channel_thumbnail || '',
        description: raw.description || '',
        subscribers: raw.channel_follower_count
          ? formatViewCount(raw.channel_follower_count).replace(' views', '')
          : '',
        id: raw.uploader_id || raw.channel_id || channelId,
      };
      if (entries.length > 0) break; // success
      console.warn(`[channel] ${url} returned 0 entries, trying next...`);
    } catch (e) {
      console.warn(`[channel] failed with ${url}: ${e.message}`);
    }
  }

  const videos = entries.map(v => ({
    id: v.id,
    title: v.title || 'Video',
    thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    duration: v.duration ? formatSecondsToTime(v.duration) : '',
    views: v.view_count ? formatViewCount(v.view_count) : '',
    published: v.upload_date ? formatUploadDate(v.upload_date) : '',
    channel: channelMeta.name || channelId,
    channelId,
    channelAvatar: channelMeta.avatar || '',
  })).filter(v => v.id);

  const result = { videos, channel: channelMeta, hasMore: entries.length >= pageSize, ts: Date.now() };
  channelCache.set(cacheKey, result);
  return result;
}

function formatSecondsToTime(secs) {
  const s = Math.floor(secs || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatViewCount(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}

function formatUploadDate(d) {
  if (!d || d.length < 8) return '';
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
}

// Query-string version — avoids routing failures when channelId contains slashes or other special chars
app.get('/api/channel/videos', async (req, res) => {
  try {
    const channelId = req.query.id || '';
    if (!channelId) return res.status(400).json({ error: 'id is required' });
    const { sort = 'newest', page = '1', pageSize = '60' } = req.query;
    const platform = normalizePlatform(req.query.platform);
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSizeNum = Math.min(200, Math.max(10, parseInt(pageSize) || 60));

    const data = await fetchChannelVideosForPlatform(platform, channelId, pageNum, pageSizeNum);
    let videos = [...data.videos];

    if (sort === 'oldest') videos = videos.reverse();
    else if (sort === 'popular') {
      videos = videos.sort((a, b) => {
        const aV = parseInt((a.views || '0').replace(/[^\d]/g, '')) || 0;
        const bV = parseInt((b.views || '0').replace(/[^\d]/g, '')) || 0;
        return bV - aV;
      });
    }

    res.json({ videos, channel: data.channel, hasMore: data.hasMore, page: pageNum, platform });
  } catch (e) {
    console.error('[channel/videos] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/channel/:channelId/videos', async (req, res) => {
  try {
    const { channelId } = req.params;
    const { sort = 'newest', page = '1', pageSize = '60' } = req.query;
    const platform = normalizePlatform(req.query.platform);
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSizeNum = Math.min(200, Math.max(10, parseInt(pageSize) || 60));

    const data = await fetchChannelVideosForPlatform(platform, channelId, pageNum, pageSizeNum);
    let videos = [...data.videos];

    if (sort === 'oldest') videos = videos.reverse();
    else if (sort === 'popular') {
      videos = videos.sort((a, b) => {
        const aV = parseInt((a.views || '0').replace(/[^\d]/g, '')) || 0;
        const bV = parseInt((b.views || '0').replace(/[^\d]/g, '')) || 0;
        return bV - aV;
      });
    }

    res.json({ videos, channel: data.channel, hasMore: data.hasMore, page: pageNum, platform });
  } catch (e) {
    console.error('[channel/videos] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Feed (YouTube-like algorithm: subscriptions + trending) ─────────────────

function getFeedRecencyScore(published) {
  if (!published) return 0;
  const p = String(published);
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
    const daysAgo = (Date.now() - new Date(p).getTime()) / (1000 * 86400);
    return Math.max(0, 1 - daysAgo / 90);
  }
  const lower = p.toLowerCase();
  if (lower.includes('hour') || lower.includes('minute') || lower.includes('second')) return 1.0;
  if (lower.includes('day')) { const d = parseInt(lower) || 1; return Math.max(0, 1 - d / 90); }
  if (lower.includes('week')) { const w = parseInt(lower) || 1; return Math.max(0, 1 - (w * 7) / 90); }
  if (lower.includes('month')) { const m = parseInt(lower) || 1; return Math.max(0, 1 - (m * 30) / 365); }
  if (lower.includes('year')) return 0.01;
  return 0;
}

function getFeedPopularityScore(views) {
  if (!views) return 0;
  const n = parseInt(String(views).replace(/[^\d]/g, '')) || 0;
  if (!n) return 0;
  return Math.min(1, Math.log10(n + 1) / 7);
}

app.get('/api/feed', requireAuth, async (req, res) => {
  try {
    const subs = await dbAll('SELECT * FROM subscriptions WHERE user_id = ?', [req.user.id]);
    const allVideos = [];

    // Load user preferences
    let prefs = await dbGet('SELECT * FROM user_preferences WHERE user_id = ?', [req.user.id]);
    if (!prefs) prefs = { subscriptions_weight: 1.0, trending_weight: 0.5, show_trending: 1, use_algorithm: 1 };

    const useAlgorithm = prefs.use_algorithm !== 0;
    const subWeight = Math.max(0, Math.min(2, prefs.subscriptions_weight ?? 1.0));
    const trendWeight = Math.max(0, Math.min(2, prefs.trending_weight ?? 0.5));
    const showTrending = prefs.show_trending !== 0;

    // ── Subscription videos ───────────────────────────────────────────────────
    // Each sub is dispatched to its own platform fetcher; failures from one
    // platform must not block the rest (e.g. Bilibili 风控 returns []).
    if (subs.length > 0) {
      const slice = subs.slice(0, 12);
      const channelResults = await Promise.allSettled(
        slice.map(sub => fetchChannelVideosForPlatform(sub.platform || 'youtube', sub.channel_id, 1, 15))
      );
      for (let i = 0; i < channelResults.length; i++) {
        const result = channelResults[i];
        if (result.status !== 'fulfilled') continue;
        const sub = slice[i];
        for (const v of result.value.videos.slice(0, 10)) {
          const recency = getFeedRecencyScore(v.published);
          const popularity = getFeedPopularityScore(v.views);
          const channelBoost = (slice.length - i) / Math.max(slice.length, 1) * 0.1;
          const random = Math.random() * 0.05;
          // Live Twitch streams should always float to the top of the feed.
          const liveBoost = v.isLive ? 1.5 : 0;
          const score = subWeight * (0.4 + recency * 0.65 + popularity * 0.2 + channelBoost + random + liveBoost);
          allVideos.push({
            ...v,
            platform: v.platform || sub.platform || 'youtube',
            channel: v.channel || sub.channel_name,
            channelId: v.channelId || sub.channel_id,
            channelAvatar: v.channelAvatar || sub.channel_avatar || '',
            _score: score, _src: 'subscription',
          });
        }
      }
    }

    // ── Trending videos ───────────────────────────────────────────────────────
    if (showTrending) {
      let trendingVideos = [];
      try {
        if (trendingCache.data && Date.now() - trendingCache.ts < TRENDING_TTL) {
          trendingVideos = trendingCache.data.videos || [];
        } else {
          const raw = await fetchTrendingYtDlp();
          trendingVideos = raw;
          trendingCache.data = { videos: raw };
          trendingCache.ts = Date.now();
        }
      } catch (e) {
        console.warn('[feed] trending fetch failed:', e.message);
      }

      const subChannelIds = new Set(subs.map(s => s.channel_id));
      for (const v of trendingVideos) {
        const popularity = getFeedPopularityScore(v.views);
        const recency = getFeedRecencyScore(v.published);
        const isSub = subChannelIds.has(v.channelId);
        const random = Math.random() * 0.08;
        const score = trendWeight * ((isSub ? 0.3 : 0.05) + recency * 0.4 + popularity * 0.35 + random);
        allVideos.push({ ...v, _score: score, _src: 'trending' });
      }
    }

    // Deduplicate by video ID, keeping highest score
    const seen = new Map();
    for (const v of allVideos) {
      if (!seen.has(v.id) || seen.get(v.id)._score < v._score) seen.set(v.id, v);
    }

    let videos;
    if (useAlgorithm) {
      // Sort by algorithm score
      videos = [...seen.values()]
        .sort((a, b) => b._score - a._score)
        .slice(0, 60)
        .map(({ _score, _src, ...v }) => v);
    } else {
      // Algorithm off: chronological subscription content only
      videos = [...seen.values()]
        .filter(v => v._src === 'subscription')
        .sort((a, b) => getFeedRecencyScore(b.published) - getFeedRecencyScore(a.published))
        .slice(0, 60)
        .map(({ _score, _src, ...v }) => v);
    }

    res.json({ videos });
  } catch (e) {
    console.error('[feed] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Video info / formats / subtitles ────────────────────────────────────────

app.get('/api/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { platform = 'youtube' } = req.query;

  // Non-YouTube platforms: extract via platform-specific path
  if (platform === 'bilibili' || platform === 'twitch') {
    try {
      let data;
      if (platform === 'bilibili') {
        data = await extractBilibili(videoId);
      } else {
        const url = /^\d+$/.test(videoId) ? `https://www.twitch.tv/videos/${videoId}` : `https://www.twitch.tv/${videoId}`;
        data = await extractGeneric(url, `tw:${videoId}`);
      }
      return res.json({
        duration: data.meta?.duration || 0,
        title: data.meta?.title || '',
        chapters: [],
        isLive: !!data.meta?.isLive,
        source: platform,
      });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  let duration = 0, title = '', chapters = [], description = '';

  try {
    const info = await getVideoInfo(videoId);
    duration = info.basic_info?.duration || 0;
    title = info.basic_info?.title || '';
    description = info.basic_info?.short_description || '';
    // Try to get chapters from the YouTube API first
    chapters = extractChaptersFromInfo(info, duration);
  } catch {}

  if (!duration || !title) {
    try {
      const data = await getYtDlpFormatsWithRetry(videoId);
      if (!duration && data.meta?.duration) duration = data.meta.duration;
      if (!title && data.meta?.title) title = data.meta.title;
      if (!description && data.meta?.description) description = data.meta.description;
    } catch {}
  }

  // Fallback: parse chapters from description
  if (chapters.length === 0 && description) {
    chapters = parseChaptersFromDescription(description, duration);
  }

  if (!duration && !title) {
    return res.status(502).json({
      error: 'Could not fetch video info',
      fallback: { type: 'youtube-embed', url: `https://www.youtube.com/embed/${videoId}` },
    });
  }

  res.json({ duration, title, chapters, source: 'combined' });
});

app.get('/api/formats/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { platform = 'youtube' } = req.query;
  try {
    if (platform === 'twitch') {
      const isVod = /^\d+$/.test(videoId);
      const url = isVod
        ? `https://www.twitch.tv/videos/${videoId}`
        : `https://www.twitch.tv/${videoId}`;
      const data = await extractGeneric(url, `tw:${videoId}`);
      const heights = ytDlpAvailableHeights(data.formats);
      // Twitch live streams sometimes report only "audio_only" + "source" — give a sane fallback
      return res.json({ availableHeights: heights.length ? heights : [720] });
    }
    if (platform === 'bilibili') {
      const data = await extractBilibili(videoId);
      const heights = ytDlpAvailableHeights(data.formats);
      return res.json({ availableHeights: heights });
    }
    const data = await getYtDlpFormatsWithRetry(videoId);
    const heights = ytDlpAvailableHeights(data.formats);
    res.json({ availableHeights: heights });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Codec info for MSE (MediaSource Extensions) ─────────────────────────────
// Returns the MIME type string for a given video+quality so the client can
// initialize a SourceBuffer with the correct codec.
// MSE rejects every appended segment if the SourceBuffer's declared codec
// doesn't byte-exactly match the actual stream's profile/level. Twitch 720p60
// is usually `avc1.4D4020` (Main@3.2), Bilibili videos vary between High@4.0
// and High@5.0, and there's no way to predict either. So we ffprobe the actual
// chosen URL and build the avc1.XXXXXX / mp4a.40.X codec string from the
// reported profile + level. Cached for 5 min to keep playback start snappy.
const codecCache = new Map();
const CODEC_TTL_MS = 5 * 60 * 1000;

const H264_PROFILE_MAP = {
  'Constrained Baseline': { idc: 0x42, constraint: 0x40 },
  'Baseline':             { idc: 0x42, constraint: 0x00 },
  'Main':                 { idc: 0x4D, constraint: 0x00 },
  'Extended':             { idc: 0x58, constraint: 0x00 },
  'High':                 { idc: 0x64, constraint: 0x00 },
  'High 10':              { idc: 0x6E, constraint: 0x00 },
  'High 4:2:2':           { idc: 0x7A, constraint: 0x00 },
  'High 4:4:4 Predictive':{ idc: 0xF4, constraint: 0x00 },
};

function buildAvcCodecString(stream) {
  if (!stream || stream.codec_name !== 'h264') return null;
  const p = H264_PROFILE_MAP[stream.profile] || { idc: 0x64, constraint: 0x00 };
  const level = (typeof stream.level === 'number' && stream.level > 0) ? stream.level : 30;
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `avc1.${hex(p.idc)}${hex(p.constraint)}${hex(level)}`.toLowerCase();
}

function buildAacCodecString(stream) {
  if (!stream) return 'mp4a.40.2';
  if (stream.codec_name === 'aac') {
    if (stream.profile === 'HE-AACv2' || stream.profile === 'HE-AAC v2') return 'mp4a.40.29';
    if (stream.profile === 'HE-AAC') return 'mp4a.40.5';
    return 'mp4a.40.2'; // LC and unknown
  }
  if (stream.codec_name === 'mp3') return 'mp4a.40.34';
  return 'mp4a.40.2';
}

function ffprobeStreams(url, headerLines = '') {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_streams'];
    if (headerLines) args.push('-headers', headerLines);
    args.push('-i', url);
    const proc = spawn(FFPROBE, args);
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(null); }, 8000);
    proc.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function probeMimeForPlatform(platform, videoId, quality) {
  const cacheKey = `${platform}:${videoId}:${quality}`;
  const cached = codecCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CODEC_TTL_MS) return cached.value;

  let videoUrl = null, audioUrl = null, headerLines = '';
  try {
    if (platform === 'bilibili') {
      const data = await extractBilibili(videoId);
      const vf = pickYtDlpVideo(data.formats, parseInt(quality, 10));
      const af = data.formats.find(f => f.acodec !== 'none' && f.vcodec === 'none' && f.url) || pickYtDlpAudio(data.formats);
      videoUrl = vf?.url; audioUrl = af?.url;
      headerLines = 'Referer: https://www.bilibili.com/\r\nUser-Agent: ' + getRandomUA() + '\r\n';
    } else if (platform === 'twitch') {
      const isVod = /^\d+$/.test(videoId);
      const url = isVod ? `https://www.twitch.tv/videos/${videoId}` : `https://www.twitch.tv/${videoId}`;
      const data = await extractGeneric(url, `tw:${videoId}`);
      const vfs = data.formats.filter(f =>
        f.url && (f.vcodec === undefined || f.vcodec !== 'none') && !/^audio[_-]?only$/i.test(f.format_id || '')
      );
      vfs.sort((a, b) => Math.abs((a.height || 0) - parseInt(quality, 10)) - Math.abs((b.height || 0) - parseInt(quality, 10)));
      videoUrl = vfs[0]?.url; // Twitch HLS is multiplexed (V+A in one playlist)
    }
  } catch (e) {
    console.warn(`[codec-probe] extract failed for ${platform}/${videoId}: ${e.message}`);
  }

  if (!videoUrl) return null;

  const [vProbe, aProbe] = await Promise.all([
    ffprobeStreams(videoUrl, headerLines),
    audioUrl ? ffprobeStreams(audioUrl, headerLines) : Promise.resolve(null),
  ]);

  const vStream = vProbe?.streams?.find(s => s.codec_type === 'video');
  const aStream = (aProbe || vProbe)?.streams?.find(s => s.codec_type === 'audio');

  const vcodec = buildAvcCodecString(vStream) || 'avc1.640028';
  const acodec = buildAacCodecString(aStream);
  const mimeType = `video/mp4; codecs="${vcodec},${acodec}"`;
  const value = { mimeType, videoCodec: vcodec, audioCodec: acodec };
  codecCache.set(cacheKey, { value, ts: Date.now() });
  console.log(`[codec-probe] ${platform}/${videoId} q=${quality} → ${mimeType}`);
  return value;
}

app.get('/api/codec/:videoId', requireAuth, async (req, res) => {
  const { videoId } = req.params;
  const { quality = '720', platform = 'youtube' } = req.query;
  try {
    if (platform === 'bilibili' || platform === 'twitch') {
      const probed = await probeMimeForPlatform(platform, videoId, quality);
      if (probed) return res.json(probed);
      // Last-resort fallback — Constrained Baseline @ 4.0 + AAC-LC, the
      // most universally accepted combination.
      const mimeType = 'video/mp4; codecs="avc1.42E028,mp4a.40.2"';
      return res.json({ mimeType, videoCodec: 'avc1.42E028', audioCodec: 'mp4a.40.2' });
    }
    const data = await getYtDlpFormatsWithRetry(videoId);
    const qualityNum = parseInt(quality, 10);
    const videoFmt  = pickYtDlpVideo(data.formats, qualityNum);

    let vcodec = (videoFmt.vcodec || 'avc1.42E01E').replace(/^avc1$/, 'avc1.42E01E');
    let acodec;

    if (videoFmt.acodec !== 'none') {
      acodec = (videoFmt.acodec || 'mp4a.40.2').replace(/^mp4a$/, 'mp4a.40.2');
    } else {
      const audioFmt = pickYtDlpAudio(data.formats);
      acodec = (audioFmt.acodec || 'mp4a.40.2').replace(/^mp4a$/, 'mp4a.40.2');
    }

    // VP9/AV1 in mp4 container is uncommon but handle it anyway
    const mimeType = `video/mp4; codecs="${vcodec},${acodec}"`;
    res.json({ mimeType, videoCodec: vcodec, audioCodec: acodec });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Video details (description + comments) ──────────────────────────────────

app.get('/api/video/:videoId/details', async (req, res) => {
  const { videoId } = req.params;
  const { platform = 'youtube' } = req.query;
  let description = '';
  let comments = [];

  // Non-YouTube platforms: return what we can pull from their extractor
  // and skip the comments fetch entirely (which is YouTube-specific).
  if (platform !== 'youtube') {
    try {
      let data;
      if (platform === 'bilibili') data = await extractBilibili(videoId);
      else if (platform === 'twitch') {
        const url = /^\d+$/.test(videoId) ? `https://www.twitch.tv/videos/${videoId}` : `https://www.twitch.tv/${videoId}`;
        data = await extractGeneric(url, `tw:${videoId}`);
      }
      description = data?.meta?.description || '';
    } catch {}
    return res.json({ description, comments: [] });
  }

  try {
    const data = await getYtDlpFormatsWithRetry(videoId);
    description = data.meta?.description || '';
  } catch {}

  if (!description) {
    try {
      const info = await getVideoInfo(videoId);
      description = info.basic_info?.short_description || '';
    } catch {}
  }

  try {
    const ytdlpArgs = buildYtDlpArgs('tv_embedded');
    const commentData = await new Promise((resolve) => {
      const args = [
        '--no-playlist', '--skip-download', '--write-comments', '--quiet', '--no-warnings',
        '--extractor-args', 'youtube:comment_sort=top;max_comments=30,all,top,0',
        ...ytdlpArgs,
        '-j', `https://www.youtube.com/watch?v=${videoId}`,
      ];
      const proc = spawn(YTDLP, args, {
        env: { ...process.env, HTTP_USER_AGENT: getRandomUA() }
      });
      let out = '';
      proc.stdout.on('data', d => { out += d; });
      proc.stderr.on('data', () => {});
      const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve(null); }, 20000);
      proc.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve(null); } });
      proc.on('error', () => { clearTimeout(timer); resolve(null); });
    });

    if (commentData?.comments?.length) {
      comments = commentData.comments
        .filter(c => c.parent === 'root' && c.text)
        .slice(0, 30)
        .map(c => ({
          id: c.id || Math.random().toString(36),
          author: c.author || 'User',
          authorAvatar: c.author_thumbnail || '',
          text: c.text || '',
          likes: c.like_count ?? 0,
          published: c.timestamp ? new Date(c.timestamp * 1000).toLocaleDateString() : '',
        }));
    }
  } catch (e) {
    console.warn('[details] comments fetch failed:', e.message);
  }

  res.json({ description, comments });
});

// ─── Subtitles ───────────────────────────────────────────────────────────────

app.get('/api/subtitles/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { lang = 'en', auto = 'false' } = req.query;

  try {
    const data = await getYtDlpFormatsWithRetry(videoId);
    const subtitleSource = auto === 'true' ? data.automaticCaptions : data.subtitles;

    if (!subtitleSource || !subtitleSource[lang]) {
      return res.status(404).json({ error: 'Subtitles not available for this language' });
    }

    const subs = subtitleSource[lang];
    const vttSub = subs.find(s => s.ext === 'vtt') || subs.find(s => s.ext === 'srt') || subs[0];

    if (!vttSub || !vttSub.url) return res.status(404).json({ error: 'No subtitle URL found' });

    const resp = await fetch(vttSub.url, { headers: { 'user-agent': getRandomUA() } });
    if (!resp.ok) return res.status(502).json({ error: 'Failed to fetch subtitles' });

    const content = await resp.text();
    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(content);
  } catch (e) {
    console.error('[subtitles] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/subtitles/:videoId/list', async (req, res) => {
  const { videoId } = req.params;
  const { platform = 'youtube' } = req.query;
  // Bilibili & Twitch don't expose subtitle tracks through our pipeline
  if (platform !== 'youtube') return res.json({ subtitles: [] });
  try {
    const data = await getYtDlpFormatsWithRetry(videoId);
    const availableSubs = [];

    if (data.subtitles) {
      for (const [lang, subs] of Object.entries(data.subtitles)) {
        if (subs && subs.length > 0) availableSubs.push({ lang, name: subs[0].name || lang, auto: false });
      }
    }

    if (data.automaticCaptions) {
      for (const [lang, subs] of Object.entries(data.automaticCaptions)) {
        if (subs && subs.length > 0) {
          const existing = availableSubs.find(s => s.lang === lang);
          if (existing) existing.hasAuto = true;
          else availableSubs.push({ lang, name: subs[0].name || lang, auto: true });
        }
      }
    }

    res.json({ subtitles: availableSubs });
  } catch (e) {
    console.error('[subtitles list] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/subtitles/:videoId/translate', async (req, res) => {
  const { videoId } = req.params;
  const { lang = 'en', auto = 'false', to = 'en' } = req.query;

  try {
    const data = await getYtDlpFormatsWithRetry(videoId);

    const autoCapsSrc = data.automaticCaptions;
    if (autoCapsSrc && autoCapsSrc[to]) {
      const subs = autoCapsSrc[to];
      const vttSub = subs.find(s => s.ext === 'vtt') || subs[0];
      if (vttSub?.url) {
        const r = await fetch(vttSub.url, { headers: { 'user-agent': getRandomUA() } });
        if (r.ok) {
          res.setHeader('Content-Type', 'text/vtt');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('X-Translation-Source', 'youtube-auto');
          return res.send(await r.text());
        }
      }
    }

    const subtitleSource = auto === 'true' ? data.automaticCaptions : data.subtitles;
    const srcSubs = subtitleSource?.[lang];
    if (!srcSubs?.length) return res.status(404).json({ error: 'Source subtitles not found' });

    const vttSub = srcSubs.find(s => s.ext === 'vtt') || srcSubs[0];
    const r = await fetch(vttSub.url, { headers: { 'user-agent': getRandomUA() } });
    if (!r.ok) return res.status(502).json({ error: 'Failed to fetch source subtitles' });

    const vttText = await r.text();

    const cueRegex = /(\d{2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n\n|\n*$)/g;
    const cues = [];
    let m;
    while ((m = cueRegex.exec(vttText)) !== null) {
      const text = m[3].replace(/<[^>]+>/g, '').trim();
      if (text) cues.push({ start: m[1], end: m[2], text });
    }

    if (!cues.length) {
      res.setHeader('Content-Type', 'text/vtt');
      return res.send(vttText);
    }

    const DELIM = ' ||| ';
    const batch = cues.map(c => c.text).join(DELIM);

    let translated = batch;
    try {
      const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(batch)}`;
      const gtRes = await fetch(gtUrl, {
        headers: { 'user-agent': 'Mozilla/5.0', 'accept': '*/*' },
        signal: AbortSignal.timeout(10000),
      });
      if (gtRes.ok) {
        const gtData = await gtRes.json();
        translated = (gtData[0] || []).map(part => part[0] || '').join('');
      }
    } catch (e) {
      console.warn('[translate] Google Translate failed:', e.message);
    }

    const translatedParts = translated.split(DELIM);
    const vttLines = ['WEBVTT', ''];
    cues.forEach((cue, i) => {
      vttLines.push(`${cue.start} --> ${cue.end}`);
      vttLines.push(translatedParts[i]?.trim() || cue.text);
      vttLines.push('');
    });

    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Translation-Source', 'google-translate');
    res.send(vttLines.join('\n'));
  } catch (e) {
    console.error('[translate] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Stream availability check (called before video loads) ───────────────────
// Uses activeStreamSet — the live count of open proxy connections, accurate in real-time.

app.get('/api/stream/available', requireAuth, async (req, res) => {
  const streamSettings = await dbGet('SELECT max_connections FROM admin_settings WHERE id = 1');
  const maxStreams = streamSettings?.max_connections ?? MAX_CONCURRENT_STREAMS;
  const current = activeStreamSet.size;
  // If this user already has a stream slot, seeking/reloading won't consume an extra slot
  // (the proxy handler releases the old slot before checking capacity).
  const userKey = `uid:${req.user.id}`;
  const userHasSlot = activeUserStreams.has(userKey);
  const effectiveCount = userHasSlot ? Math.max(0, current - 1) : current;
  const available = effectiveCount < maxStreams;
  res.json({ available, current, max: maxStreams });
});

// ─── Proxy (streaming) ───────────────────────────────────────────────────────

app.get('/api/proxy/:videoId', async (req, res) => {
  const { videoId } = req.params;
  // BUG FIX: Support both 't' (YouTube style) and 'start' (HTML5 standard) parameters
  // Priority: start > t > 0
  const { quality = '720', t, start, platform = 'youtube' } = req.query;

  // BUG FIX: Properly parse seek time from either parameter
  let seekSeconds = 0;
  if (start !== undefined) {
    seekSeconds = Math.max(0, parseFloat(start) || 0);
  } else if (t !== undefined) {
    // Support YouTube time formats: "123" (seconds) or "2m3s"
    const tStr = String(t);
    if (/^\d+$/.test(tStr)) {
      seekSeconds = parseInt(tStr, 10);
    } else {
      // Parse "1h2m3s" format
      const match = tStr.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
      if (match) {
        const hours = parseInt(match[1] || 0) * 3600;
        const mins = parseInt(match[2] || 0) * 60;
        const secs = parseInt(match[3] || 0);
        seekSeconds = hours + mins + secs;
      }
    }
  }

  const rangeHeader = req.headers.range;

  console.log(`[proxy] ${videoId} q=${quality} seek=${seekSeconds}s range=${rangeHeader || 'none'}`);

  // Optional user detection for bandwidth accounting
  const _bwUser = await getSessionUser(req.cookies?.session);
  const _bwUid = _bwUser?.id ?? null;
  const _origWrite = res.write.bind(res);
  const _origEnd = res.end.bind(res);
  res.write = function (chunk, ...args) {
    if (chunk) recordBandwidth(_bwUid, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk));
    return _origWrite(chunk, ...args);
  };
  res.end = function (chunk, ...args) {
    if (chunk) recordBandwidth(_bwUid, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk));
    return _origEnd(chunk, ...args);
  };

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  // ── Concurrent stream limit (admins bypass) ────────────────────────────────
  const _proxyIsAdmin = !!getAdminSession(req.cookies?.admin_token);
  const _proxyStreamId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Key for per-user deduplication: authenticated user ID or fallback to IP.
  // This lets the same user seek (which opens a new connection) without burning an extra slot.
  const _proxyUserKey = _bwUid != null ? `uid:${_bwUid}` : `ip:${req.ip}`;

  if (!_proxyIsAdmin) {
    const _proxySettings = await dbGet('SELECT max_connections FROM admin_settings WHERE id = 1');
    const _proxyMax = _proxySettings?.max_connections ?? MAX_CONCURRENT_STREAMS;

    // If this user already has an active stream, release it first so seeking
    // doesn't look like a brand-new concurrent connection to the limit check.
    const _oldStreamId = activeUserStreams.get(_proxyUserKey);
    if (_oldStreamId) {
      activeStreamSet.delete(_oldStreamId);
      activeUserStreams.delete(_proxyUserKey);
    }

    if (activeStreamSet.size >= _proxyMax) {
      return res.status(503).json({ error: 'Server is busy, please try again later.', current: activeStreamSet.size, max: _proxyMax });
    }
  }

  activeStreamSet.add(_proxyStreamId);
  activeUserStreams.set(_proxyUserKey, _proxyStreamId);
  let _proxyCleaned = false;
  const _proxyCleanup = () => {
    if (!_proxyCleaned) {
      _proxyCleaned = true;
      activeStreamSet.delete(_proxyStreamId);
      if (activeUserStreams.get(_proxyUserKey) === _proxyStreamId) activeUserStreams.delete(_proxyUserKey);
    }
  };
  req.on('close', _proxyCleanup);

  try {
    const qualityNum = parseInt(quality, 10);

    // ── Bilibili: separate V/A like YouTube, mux with existing logic ──────
    if (platform === 'bilibili') {
      const data = await extractBilibili(videoId);
      const videoFmt = pickYtDlpVideo(data.formats, qualityNum);
      const audioFmt = data.formats.find(f => f.acodec !== 'none' && f.vcodec === 'none' && f.url)
        || pickYtDlpAudio(data.formats);

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      // Bilibili requires Referer/Origin headers on every CDN request.
      // Pass platform='bilibili' explicitly so muxToResponse picks the
      // bilibili header set regardless of which CDN host (bilivideo.com,
      // mcdn.bilivideo.cn, akamaized.net mirror, ...) the URL resolves to.
      await muxToResponse(videoFmt.url, audioFmt.url, res, controller.signal, seekSeconds, rangeHeader, false, 'bilibili');
      return;
    }

    // ── Twitch: HLS combined stream, mux as single input ───────────────────
    if (platform === 'twitch') {
      // Numeric ID = VOD; alphanumeric = channel (live)
      const isVod = /^\d+$/.test(videoId);
      const url = isVod
        ? `https://www.twitch.tv/videos/${videoId}`
        : `https://www.twitch.tv/${videoId}`;
      const data = await extractGeneric(url, `tw:${videoId}`);
      const isLive = !!data.meta?.isLive && !isVod;

      // Pick the format closest to requested quality. yt-dlp on Twitch
      // sometimes leaves vcodec unset for HLS variants but always tags
      // audio-only ones with format_id "audio_only". Filter by that
      // negative criterion so we keep every video variant.
      const videoFmts = data.formats.filter(f =>
        f.url
        && (f.vcodec === undefined || f.vcodec !== 'none')
        && !/^audio[_-]?only$/i.test(f.format_id || '')
      );
      if (!videoFmts.length) throw new Error('No twitch streams available');
      videoFmts.sort((a, b) => Math.abs((a.height || 0) - qualityNum) - Math.abs((b.height || 0) - qualityNum));
      const chosen = videoFmts[0];
      console.log(`[twitch] picked format ${chosen.format_id} ${chosen.height || '?'}p (live=${isLive})`);

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      await muxHlsToResponse(chosen.url, res, controller.signal, seekSeconds, isLive);
      return;
    }

    // ── YouTube (default) ──────────────────────────────────────────────────
    const data = await getYtDlpFormatsWithRetry(videoId);
    const { formats: ytFmts } = data;

    const videoFmt = pickYtDlpVideo(ytFmts, qualityNum);

    if (videoFmt.acodec !== 'none') {
      // Progressive stream (video+audio combined)
      const fetchHeaders = {
        'accept': '*/*',
        'origin': 'https://www.youtube.com',
        'referer': 'https://www.youtube.com',
        'user-agent': getRandomUA()
      };

      // BUG FIX: When seeking, we must NOT use range headers from client
      // because the byte positions won't correspond after time-based seeking.
      // Instead, we rely on ffmpeg or the upstream to handle seeking.
      // For direct progressive streams without transcoding, we pass range only if not seeking.
      if (rangeHeader && seekSeconds === 0) {
        fetchHeaders['range'] = rangeHeader;
      }

      const resp = await fetch(videoFmt.url, {
        headers: fetchHeaders,
        signal: controller.signal
      });

      if (!resp.ok && resp.status !== 206) throw new Error(`Upstream: ${resp.status}`);

      res.status(resp.status === 206 ? 206 : 200);
      res.setHeader('Content-Type', videoFmt.ext === 'webm' ? 'video/webm' : 'video/mp4');

      // BUG FIX: Only advertise Accept-Ranges when not seeking
      if (seekSeconds === 0) {
        res.setHeader('Accept-Ranges', 'bytes');
      } else {
        res.setHeader('Accept-Ranges', 'none');
      }

      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');

      if (resp.headers.get('content-length')) res.setHeader('Content-Length', resp.headers.get('content-length'));
      if (resp.headers.get('content-range')) res.setHeader('Content-Range', resp.headers.get('content-range'));

      await pipeline(Readable.fromWeb(resp.body), res);
    } else {
      // DASH stream - need to mux video + audio
      const audioFmt = pickYtDlpAudio(ytFmts);

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      // BUG FIX: Pass rangeHeader to muxToResponse so it can handle it properly
      // Note: isDownload=false for proxy endpoint (streaming)
      await muxToResponse(videoFmt.url, audioFmt.url, res, controller.signal, seekSeconds, rangeHeader, false);
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    console.error(`[proxy] Error: ${e.message}`);
    if (!res.headersSent) {
      res.status(502).json({
        error: e.message,
        videoId,
        fallback: { type: 'youtube-embed', url: `https://www.youtube.com/embed/${videoId}` },
      });
    }
  } finally {
    _proxyCleanup();
  }
});

// ─── Stream ──────────────────────────────────────────────────────────────────

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  // BUG FIX: Added seek support to stream endpoint
  const { quality = '720', audioOnly = 'false', t, start } = req.query;

  // BUG FIX: Parse seek time (same logic as proxy)
  let seekSeconds = 0;
  if (start !== undefined) {
    seekSeconds = Math.max(0, parseFloat(start) || 0);
  } else if (t !== undefined) {
    const tStr = String(t);
    if (/^\d+$/.test(tStr)) {
      seekSeconds = parseInt(tStr, 10);
    } else {
      const match = tStr.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
      if (match) {
        const hours = parseInt(match[1] || 0) * 3600;
        const mins = parseInt(match[2] || 0) * 60;
        const secs = parseInt(match[3] || 0);
        seekSeconds = hours + mins + secs;
      }
    }
  }

  const streamSettings = await dbGet('SELECT max_connections FROM admin_settings WHERE id = 1');
  const maxStreams = streamSettings?.max_connections ?? MAX_CONCURRENT_STREAMS;
  if (activeStreamSet.size >= maxStreams) {
    return res.status(503).json({ error: 'Server is busy, please try again later.' });
  }

  const streamId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  activeStreamSet.add(streamId);
  let streamCleaned = false;
  const cleanup = () => { if (!streamCleaned) { streamCleaned = true; activeStreamSet.delete(streamId); } };

  // Bandwidth accounting for stream route
  const _sBwUser = await getSessionUser(req.cookies?.session);
  const _sBwUid = _sBwUser?.id ?? null;
  const _sOrigWrite = res.write.bind(res);
  const _sOrigEnd = res.end.bind(res);
  res.write = function (chunk, ...args) {
    if (chunk) recordBandwidth(_sBwUid, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk));
    return _sOrigWrite(chunk, ...args);
  };
  res.end = function (chunk, ...args) {
    if (chunk) recordBandwidth(_sBwUid, Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk));
    return _sOrigEnd(chunk, ...args);
  };

  const controller = new AbortController();
  req.on('close', () => { controller.abort(); cleanup(); });

  try {
    const info = await getVideoInfo(videoId);
    const formats = getFormatsFromInfo(info);
    const qualityNum = parseInt(quality, 10);

    const format = audioOnly === 'true'
      ? selectBestFormat(formats, 999, true)
      : selectBestFormat(formats, qualityNum, false);

    // BUG FIX: If seeking is requested and format is separate video/audio (DASH),
    // we need to use muxToResponse instead of direct streaming
    if (seekSeconds > 0 && (!format.has_audio || !format.has_video)) {
      // Need to mux for seeking - fetch separate formats
      const videoFmt = selectVideoFormat(formats, qualityNum);
      const audioFmt = selectAudioFormat(formats);

      const videoUrl = await decipherUrl(videoFmt, info);
      const audioUrl = await decipherUrl(audioFmt, info);

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'none');
      res.setHeader('Cache-Control', 'no-cache');

      // Note: isDownload=false for stream endpoint
      await muxToResponse(videoUrl, audioUrl, res, controller.signal, seekSeconds, null, false);
    } else {
      // Direct stream (no seek or progressive format)
      const resp = await fetchFormatStream(format, info, controller.signal);
      res.setHeader('Content-Type', format.mime_type || 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      // BUG FIX: Only support ranges when not seeking
      if (seekSeconds === 0) {
        res.setHeader('Accept-Ranges', 'bytes');
      } else {
        res.setHeader('Accept-Ranges', 'none');
      }

      await pipeline(Readable.fromWeb(resp.body), res);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('[stream] error:', error.message);
      if (!res.headersSent) res.status(502).json({ error: error.message });
    }
  } finally {
    cleanup();
  }
});

// ─── Download ────────────────────────────────────────────────────────────────

function getDownloadFormatConfig(format, bitrate, compression) {
  const configs = {
    mp4: {
      ext: 'mp4',
      mime: 'video/mp4',
      audioCodec: 'copy',
      isAudio: false,
    },
    mp3: {
      ext: 'mp3',
      mime: 'audio/mpeg',
      audioCodec: 'libmp3lame',
      args: ['-b:a', bitrate || '320k', '-ar', '44100'],
      isAudio: true,
    },
    flac: {
      ext: 'flac',
      mime: 'audio/flac',
      audioCodec: 'flac',
      args: ['-compression_level', String(compression ?? 5)],
      isAudio: true,
    },
    opus: {
      ext: 'opus',
      mime: 'audio/ogg',
      audioCodec: 'libopus',
      args: ['-b:a', bitrate || '160k', '-ar', '48000'],
      isAudio: true,
    },
    ogg: {
      ext: 'ogg',
      mime: 'audio/ogg',
      audioCodec: 'libvorbis',
      args: ['-b:a', bitrate || '192k', '-ar', '44100'],
      isAudio: true,
    },
    m4a: {
      ext: 'm4a',
      mime: 'audio/mp4',
      audioCodec: 'aac',
      args: ['-b:a', bitrate || '256k'],
      isAudio: true,
    },
  };
  return configs[format] || configs.mp4;
}

function spawnFfmpegAudio(audioUrl, codec, ffmpegFormat, extraArgs, signal, seekSeconds = 0) {
  return new Promise((resolve) => {
    const ytHeaders = [
      `User-Agent: ${getRandomUA()}`,
      'Accept: */*',
      'Accept-Language: en-US,en;q=0.9',
      'Origin: https://www.youtube.com',
      'Referer: https://www.youtube.com/',
    ].join('\r\n') + '\r\n';

    const ssArgs = seekSeconds > 0 ? ['-ss', seekSeconds.toFixed(3)] : [];

    const args = [
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-headers', ytHeaders,
      '-reconnect', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_delay_max', '5',
      ...ssArgs,
      '-i', audioUrl,
      '-vn',
      '-c:a', codec,
      ...extraArgs,
      '-f', ffmpegFormat,
      'pipe:1',
    ];

    const proc = spawn(FFMPEG, args);

    if (signal) {
      signal.addEventListener('abort', () => { try { proc.kill('SIGTERM'); } catch {} }, { once: true });
    }

    proc.stderr.on('data', d => {
      const m = d.toString().trim();
      if (m) console.error('[ffmpeg-audio]', m);
    });

    resolve(proc);
  });
}

function sanitizeFilenameForHeader(filename) {
  if (!filename) return 'download';

  let sanitized = filename
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, '_')
    .trim();

  sanitized = sanitized.replace(/^[._]+|[._]+$/g, '');

  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  if (!sanitized) {
    sanitized = 'download';
  }

  return sanitized;
}

function muxToTempFile(videoUrl, audioUrl, tempPath, signal, seekSeconds = 0) {
  return new Promise((resolve, reject) => {
    const ytHeaders = [
      `User-Agent: ${getRandomUA()}`,
      'Accept: */*',
      'Accept-Language: en-US,en;q=0.9',
      'Origin: https://www.youtube.com',
      'Referer: https://www.youtube.com/',
    ].join('\r\n') + '\r\n';

    const ssArg = seekSeconds > 0 ? seekSeconds.toFixed(3) : null;

    const args = ['-loglevel', 'error'];
    args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto');

    // Video input
    args.push('-headers', ytHeaders);
    args.push('-reconnect', '1');
    args.push('-reconnect_streamed', '1');
    args.push('-reconnect_on_network_error', '1');
    args.push('-reconnect_delay_max', '10');
    if (ssArg) args.push('-ss', ssArg);
    args.push('-i', videoUrl);

    // Audio input
    args.push('-headers', ytHeaders);
    args.push('-reconnect', '1');
    args.push('-reconnect_streamed', '1');
    args.push('-reconnect_on_network_error', '1');
    args.push('-reconnect_delay_max', '10');
    if (ssArg) args.push('-ss', ssArg);
    args.push('-i', audioUrl);

    args.push('-map', '0:v:0');
    args.push('-map', '1:a:0');
    args.push('-c:v', 'copy');
    args.push('-c:a', 'copy');
    // Same A/V sync treatment as the streaming muxer above — keeps
    // downloaded files in sync after a partial-segment seek. For the
    // download case we DO want the file to start at 0 instead of at
    // SEEK_SEC, so `-output_ts_offset` shifts both streams by the same
    // single constant (preserving cross-stream sync, unlike per-stream
    // `make_zero`). `make_non_negative` then only fixes any small residual
    // negative PTS introduced by the keyframe-rounded video start.
    args.push('-copyts');
    args.push('-fflags', '+igndts');
    if (ssArg) args.push('-output_ts_offset', `-${ssArg}`);
    args.push('-avoid_negative_ts', 'make_non_negative');
    args.push('-max_muxing_queue_size', '4096');
    args.push('-movflags', '+faststart');
    args.push('-f', 'mp4');
    args.push(tempPath);

    console.log(`[ffmpeg-dl] Muxing to temp file seek=${seekSeconds}s → ${tempPath}`);

    const proc = spawn(FFMPEG, args);

    if (signal) {
      signal.addEventListener('abort', () => { try { proc.kill('SIGTERM'); } catch {} }, { once: true });
    }

    let stderrData = '';
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) {
        stderrData += msg + '\n';
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
          console.error('[ffmpeg-dl]', msg);
        }
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        if (stderrData) console.error('[ffmpeg-dl stderr]', stderrData.substring(0, 500));
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// Temp-file audio: transcode audio to disk, then serve with known Content-Length
function audioToTempFile(audioUrl, codec, ffmpegFormat, extraArgs, tempPath, signal, seekSeconds = 0) {
  return new Promise((resolve, reject) => {
    const ytHeaders = [
      `User-Agent: ${getRandomUA()}`,
      'Accept: */*',
      'Accept-Language: en-US,en;q=0.9',
      'Origin: https://www.youtube.com',
      'Referer: https://www.youtube.com/',
    ].join('\r\n') + '\r\n';

    const ssArgs = seekSeconds > 0 ? ['-ss', seekSeconds.toFixed(3)] : [];

    const args = [
      '-loglevel', 'warning',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-headers', ytHeaders,
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_delay_max', '10',
      ...ssArgs,
      '-i', audioUrl,
      '-vn',
      '-c:a', codec,
      ...extraArgs,
      '-f', ffmpegFormat,
      tempPath,
    ];

    console.log(`[ffmpeg-dl] Audio to temp file codec=${codec} → ${tempPath}`);

    const proc = spawn(FFMPEG, args);

    if (signal) {
      signal.addEventListener('abort', () => { try { proc.kill('SIGTERM'); } catch {} }, { once: true });
    }

    let stderrData = '';
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) {
        stderrData += msg + '\n';
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
          console.error('[ffmpeg-dl]', msg);
        }
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        if (stderrData) console.error('[ffmpeg-dl stderr]', stderrData.substring(0, 500));
        reject(new Error(`ffmpeg audio exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// ─── Download job store ───────────────────────────────────────────────────────
// jobs: { status:'preparing'|'muxing'|'ready'|'error', tempPath, ext, mime,
//          title, estimatedSize, finalSize, error, createdAt }
const downloadJobs = new Map();

function cleanupJob(jobId) {
  const job = downloadJobs.get(jobId);
  if (job) {
    try { fs.unlinkSync(job.tempPath); } catch {}
    downloadJobs.delete(jobId);
  }
}

// Phase 1 – start a job and return immediately
app.post('/api/download/start', async (req, res) => {
  const { videoId, format = 'mp4', quality = '720', title: titleParam, bitrate, compression } = req.query;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  const jobId = crypto.randomBytes(10).toString('hex');
  const formatConfig = getDownloadFormatConfig(format, bitrate, compression);
  const tempPath = path.join(os.tmpdir(), `ytdl_${jobId}.${formatConfig.ext}`);

  const job = {
    status: 'preparing',
    tempPath,
    ext: formatConfig.ext,
    mime: formatConfig.mime,
    title: titleParam || `video_${videoId}`,
    estimatedSize: null,
    finalSize: null,
    error: null,
    createdAt: Date.now(),
  };
  downloadJobs.set(jobId, job);

  // Respond immediately so the client isn't kept waiting
  res.json({ jobId, title: job.title });

  // Run FFmpeg in background
  (async () => {
    try {
      ytdlpCache.delete(videoId);
      ytdlpInFlight.delete(videoId);

      let data;
      try {
        data = await getYtDlpFormatsWithRetry(videoId);
      } catch (ytdlpError) {
        const info = await getVideoInfo(videoId);
        const fmts = getFormatsFromInfo(info);
        data = {
          formats: [
            ...fmts.videoFormats.map(f => ({
              url: f.url, height: f.height, width: f.width,
              vcodec: f.has_video ? 'avc1' : 'none', acodec: f.has_audio ? 'mp4a' : 'none',
              ext: 'mp4', format_id: f.itag,
            })),
            ...fmts.adaptiveFormats.map(f => ({
              url: f.url, height: f.height, width: f.width,
              vcodec: f.has_video ? 'avc1' : 'none', acodec: f.has_audio ? 'mp4a' : 'none',
              ext: 'mp4', format_id: f.itag,
            })),
          ],
          meta: { title: info.basic_info?.title || '', duration: info.basic_info?.duration || 0 },
        };
      }

      const { formats: ytFmts, meta } = data;
      if (meta?.title) job.title = meta.title;

      const qualityNum = parseInt(quality, 10);

      if (format === 'mp4') {
        const videoFmt = pickYtDlpVideo(ytFmts, qualityNum);
        const audioFmt = pickYtDlpAudio(ytFmts);
        if (!videoFmt || !audioFmt) throw new Error('No suitable video or audio formats found');

        // Use yt-dlp reported sizes for a realistic total estimate
        const vs = videoFmt.filesize || videoFmt.filesize_approx || 0;
        const as = audioFmt.filesize || audioFmt.filesize_approx || 0;
        if (vs + as > 0) job.estimatedSize = vs + as;

        job.status = 'muxing';
        await muxToTempFile(videoFmt.url, audioFmt.url, tempPath, null, 0);
      } else {
        const audioFmt = pickYtDlpAudio(ytFmts);
        if (!audioFmt) throw new Error('No audio format available');

        const as = audioFmt.filesize || audioFmt.filesize_approx || 0;
        if (as > 0) job.estimatedSize = as;

        job.status = 'muxing';
        const ffmpegFormat = format === 'm4a' ? 'mp4' : formatConfig.ext;
        await audioToTempFile(
          audioFmt.url, formatConfig.audioCodec, ffmpegFormat,
          formatConfig.args || [], tempPath, null, 0,
        );
      }

      const { size } = fs.statSync(tempPath);
      job.finalSize = size;
      job.status = 'ready';
      console.log(`[download] job=${jobId} ${format} size=${(size/1024/1024).toFixed(1)}MB ready`);

      // Auto-clean after 30 minutes if client never fetches
      setTimeout(() => cleanupJob(jobId), 30 * 60 * 1000);
    } catch (err) {
      console.error(`[download] job=${jobId} error:`, err.message);
      job.status = 'error';
      job.error = err.message;
      try { fs.unlinkSync(tempPath); } catch {}
      setTimeout(() => downloadJobs.delete(jobId), 5 * 60 * 1000);
    }
  })();
});

// Phase 2 – poll status + size on disk for progress
app.get('/api/download/status/:jobId', (req, res) => {
  const job = downloadJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  let fileSizeOnDisk = 0;
  if (job.status === 'muxing' || job.status === 'ready') {
    try { fileSizeOnDisk = fs.statSync(job.tempPath).size; } catch {}
  }

  res.json({
    status: job.status,
    fileSizeOnDisk,
    estimatedSize: job.finalSize || job.estimatedSize || null,
    title: job.title,
    ext: job.ext,
    error: job.error,
  });
});

// Phase 3 – serve the completed file
//
// Notes for restrictive networks (school WiFi, web filters) and
// in-browser proxies (Scramjet, Ultraviolet, etc.):
//   * We deliberately use Content-Type: application/octet-stream and do
//     NOT send Content-Disposition: attachment. Many school filters block
//     responses with media MIME types (video/mp4, audio/mpeg) or with an
//     "attachment" disposition, returning a 403 block-page in their place.
//     The client buffers the response into a Blob and triggers the save
//     itself via <a download="filename.ext">, so the real MIME/filename
//     are not needed on the wire.
//   * In-browser proxies often issue a preflight HEAD/Range request before
//     the real GET. The previous code deleted the temp file the moment
//     res.sendFile's callback fired, so the second (real) request hit a
//     "Job not found" 404 -> "no file" error in the proxy. We now stream
//     the file manually and defer cleanup, allowing retries within a
//     short window to succeed.
function serveDownloadFile(req, res) {
  const { jobId } = req.params;
  const job = downloadJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'ready') return res.status(409).json({ error: `Not ready: ${job.status}` });

  // Generic MIME so school/network web filters don't see a media type
  // and silently rewrite the response to a 403 block-page.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', job.finalSize);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // In-browser proxies like Scramjet / Ultraviolet only recognise a
  // response as a "download" when Content-Disposition: attachment is
  // present. Without it their service-worker download handler returns
  // "Couldn't download — No file". We send it with the real filename so
  // the proxy has a name to save the file under (the proxy may ignore
  // the page's <a download> attribute).
  const safeTitle = sanitizeFilenameForHeader(job.title);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeTitle}.${job.ext}"`,
  );

  console.log(`[download] job=${jobId} sending ${(job.finalSize/1024/1024).toFixed(1)}MB to client`);

  // HEAD requests (some proxies preflight) – respond with headers only,
  // do NOT touch the temp file.
  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(job.tempPath);
  let finished = false;
  const scheduleCleanup = () => {
    if (finished) return;
    finished = true;
    // Give in-browser proxies / retries a generous window before deleting.
    // The 30-minute TTL set in start handler is the absolute upper bound.
    setTimeout(() => cleanupJob(jobId), 2 * 60 * 1000);
  };

  stream.on('error', (err) => {
    console.error('[download] stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Read failed' });
    } else {
      try { res.end(); } catch {}
    }
    scheduleCleanup();
  });

  res.on('close', scheduleCleanup);
  res.on('finish', scheduleCleanup);

  stream.pipe(res);
}

// The optional :filename path segment is purely cosmetic for the URL —
// the server ignores it. It exists so the in-browser proxies (Scramjet,
// Ultraviolet, etc.) and browsers themselves can derive a sensible
// suggested filename from the URL when no Content-Disposition is sent.
app.get('/api/download/file/:jobId/:filename?', serveDownloadFile);
app.head('/api/download/file/:jobId/:filename?', serveDownloadFile);

// Generic alias that avoids the keyword "download" in the URL — useful for
// network filters that block by URL substring.
app.get('/api/d/:jobId/:filename?', serveDownloadFile);
app.head('/api/d/:jobId/:filename?', serveDownloadFile);

// ─── Trending ────────────────────────────────────────────────────────────────

const trendingCache = { data: null, ts: 0 };
const TRENDING_TTL = 30 * 60 * 1000;

async function fetchTrendingYtDlp() {
  // Primary: use youtubei.js search (YouTube's trending feed URL is blocked for bots)
  if (youtube) {
    try {
      const results = await youtube.search('trending');
      const vids = (results.videos || []).slice(0, 40).map(v => {
        const authors = buildAuthors(v);
        return {
          id: v.id,
          title: v.title?.text || v.title || 'Video',
          thumbnail: v.best_thumbnail?.url || v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          duration: v.duration?.text || v.duration || '',
          views: v.view_count?.text || v.short_view_count?.text || '',
          channel: authors[0]?.name || '',
          channelId: authors[0]?.id || '',
          channelAvatar: authors[0]?.avatar || '',
          published: v.published?.text || '',
          authors,
        };
      }).filter(v => v.id);
      if (vids.length > 0) {
        console.log(`[trending] got ${vids.length} videos via search`);
        return vids;
      }
    } catch (e) {
      console.warn('[trending] youtube.search failed:', e.message);
    }
  }

  // Fallback: yt-dlp search syntax (ytsearch doesn't hit the blocked trending URL)
  try {
    const raw = await new Promise((resolve, reject) => {
      const args = [
        '--flat-playlist', '--no-warnings', '--quiet',
        ...buildYtDlpArgs('web'),
        '--playlist-items', '1-40',
        '-J', 'ytsearch40:trending',
      ];
      const proc = spawn(YTDLP, args, { env: { ...process.env, HTTP_USER_AGENT: getRandomUA() } });
      let out = '';
      const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, 30000);
      proc.stdout.on('data', d => { out += d; });
      proc.stderr.on('data', () => {});
      proc.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`exit ${code}`));
        try { resolve(JSON.parse(out)); } catch { reject(new Error('parse failed')); }
      });
      proc.on('error', e => { clearTimeout(timer); reject(e); });
    });
    const entries = raw.entries || [];
    if (entries.length > 0) {
      return entries.map(v => ({
        id: v.id,
        title: v.title || 'Video',
        thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        duration: v.duration ? formatSecondsToTime(v.duration) : '',
        views: v.view_count ? formatViewCount(v.view_count) : '',
        channel: v.uploader || v.channel || '',
        channelId: v.uploader_id || v.channel_id || '',
        channelAvatar: '',
        published: v.upload_date ? formatUploadDate(v.upload_date) : '',
      })).filter(v => v.id);
    }
  } catch (e) {
    console.warn('[trending] yt-dlp search fallback failed:', e.message);
  }

  throw new Error('All trending sources failed');
}


app.get('/api/trending', async (req, res) => {
  try {
    if (trendingCache.data && Date.now() - trendingCache.ts < TRENDING_TTL) {
      return res.json(trendingCache.data);
    }

    let videos = [];

    try {
      if (youtube && typeof youtube.getTrending === 'function') {
        const results = await youtube.getTrending();
        const items = results.videos || results.items || [];
        const section = Array.isArray(items) ? items : (results.contents?.[0]?.contents || []);

        videos = section
          .filter(v => v.id && (v.title?.text || v.title))
          .slice(0, 40)
          .map(v => {
            const authors = buildAuthors(v);
            return {
              id: v.id,
              title: v.title?.text || v.title || 'Video',
              thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
              duration: v.duration?.text || '',
              views: v.view_count?.text || v.short_view_count?.text || '',
              channel: authors[0]?.name || '',
              channelId: authors[0]?.id || '',
              channelAvatar: authors[0]?.avatar || '',
              published: v.published?.text || '',
              authors,
            };
          });
      }
    } catch (apiErr) {
      console.warn('[trending] API failed:', apiErr.message);
    }

    if (videos.length === 0) {
      try {
        videos = await fetchTrendingYtDlp();
      } catch (e) {
        console.warn('[trending] yt-dlp fallback failed:', e.message);
      }
    }

    const result = { videos };
    trendingCache.data = result;
    trendingCache.ts = Date.now();
    res.json(result);
  } catch (e) {
    console.error('[trending] error:', e.message);
    res.status(500).json({ videos: [], error: e.message });
  }
});

// ─── Bilibili / Twitch endpoints ─────────────────────────────────────────────

const bilibiliPopularCache = { data: null, ts: 0 };
const twitchTopCache = { data: null, ts: 0 };
const PLATFORM_LIST_TTL = 5 * 60 * 1000; // 5 min

app.get('/api/bilibili/popular', async (req, res) => {
  try {
    if (bilibiliPopularCache.data && Date.now() - bilibiliPopularCache.ts < PLATFORM_LIST_TTL) {
      return res.json(bilibiliPopularCache.data);
    }
    const videos = await bilibiliPopular(40);
    const result = { videos };
    bilibiliPopularCache.data = result;
    bilibiliPopularCache.ts = Date.now();
    res.json(result);
  } catch (e) {
    console.error('[bilibili popular]', e.message);
    res.status(502).json({ videos: [], error: e.message });
  }
});

app.get('/api/bilibili/search', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json({ videos: [] });
  try {
    const videos = await bilibiliSearch(q.trim(), 40);
    res.json({ videos });
  } catch (e) {
    console.error('[bilibili search]', e.message);
    res.status(502).json({ videos: [], error: e.message });
  }
});

app.get('/api/twitch/streams', async (req, res) => {
  try {
    if (twitchTopCache.data && Date.now() - twitchTopCache.ts < PLATFORM_LIST_TTL) {
      return res.json(twitchTopCache.data);
    }
    const videos = await twitchTopStreams(30);
    const result = { videos };
    twitchTopCache.data = result;
    twitchTopCache.ts = Date.now();
    res.json(result);
  } catch (e) {
    console.error('[twitch streams]', e.message);
    res.status(502).json({ videos: [], error: e.message });
  }
});

app.get('/api/twitch/search', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json({ videos: [] });
  try {
    const videos = await twitchSearch(q.trim(), 30);
    res.json({ videos });
  } catch (e) {
    console.error('[twitch search]', e.message);
    res.status(502).json({ videos: [], error: e.message });
  }
});

// Generic image proxy — bilibili thumbnails block hotlinking from non-bilibili
// referers, so we fetch them server-side. Restricted to a small allowlist
// of known image hosts so it can't be abused as an open redirect.
const IMG_PROXY_HOSTS = [
  'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com', 'i3.hdslb.com',
  'archive.biliimg.com', 'static.hdslb.com',
];
app.get('/api/img-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();
  let target;
  try { target = new URL(url); } catch { return res.status(400).end(); }
  if (!IMG_PROXY_HOSTS.includes(target.hostname)) {
    return res.status(403).end();
  }
  try {
    const r = await fetch(target.toString(), { headers: BILIBILI_HEADERS });
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    await pipeline(Readable.fromWeb(r.body), res);
  } catch (e) {
    res.status(502).end();
  }
});

// ─── Shorts (actual YouTube Shorts — duration ≤ 60s) ─────────────────────────

const shortsCache = { data: null, ts: 0 };
const SHORTS_TTL = 20 * 60 * 1000;

function isActualShort(v) {
  // A video is considered a short if it has a duration <= 62s OR if the URL contains /shorts/
  if (v.duration && v.duration > 62) return false;
  if (v.webpage_url && v.webpage_url.includes('/shorts/')) return true;
  if (v.url && v.url.includes('/shorts/')) return true;
  if (v.duration && v.duration <= 62) return true;
  // No duration info — accept it only from shorts-specific sources
  return false;
}

async function fetchActualShorts(offset = 0) {
  // ── 1. Try innertube hashtag API (most reliable for actual shorts) ───────
  if (youtube) {
    try {
      const hashtag = await youtube.getHashtag('shorts');
      const videos = hashtag?.videos || hashtag?.contents || [];
      const shorts = videos
        .filter(v => v.id || v.video_id)
        .map(v => {
          const id = v.id || v.video_id || v.videoId;
          const durSecs = v.duration?.seconds ?? v.duration ?? 0;
          const authors = buildAuthors(v);
          return {
            id,
            title: v.title?.text || v.title || 'Short',
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            duration: durSecs ? formatSecondsToTime(durSecs) : '',
            durationSecs: durSecs,
            views: v.view_count?.text || v.views?.text || '',
            channel: authors[0]?.name || '',
            channelId: authors[0]?.id || '',
            channelAvatar: authors[0]?.avatar || '',
            isShort: true,
            authors,
          };
        })
        .filter(v => v.id && (!v.durationSecs || v.durationSecs <= 62))
        .slice(0, 30);

      if (shorts.length >= 5) {
        console.log(`[shorts] Got ${shorts.length} shorts via innertube hashtag`);
        return shorts;
      }
    } catch (e) {
      console.warn('[shorts] innertube hashtag failed:', e.message);
    }
  }

  // ── 2. yt-dlp from the /shorts/ page ─────────────────────────────────────
  const ytdlpArgs = buildYtDlpArgs('tv_embedded');
  const start = offset + 1;
  const end = offset + 60;

  const sources = [
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/hashtag/shorts',
  ];

  for (const src of sources) {
    try {
      const raw = await new Promise((resolve, reject) => {
        const args = [
          '--flat-playlist', '--no-warnings', '--quiet',
          ...ytdlpArgs,
          '--playlist-items', `${start}-${end}`,
          '-J', src,
        ];
        const proc = spawn(YTDLP, args, { env: { ...process.env, HTTP_USER_AGENT: getRandomUA() } });
        let out = '';
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, 30000);
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', () => {});
        proc.on('close', code => {
          clearTimeout(timer);
          if (code !== 0) return reject(new Error(`exit ${code}`));
          try { resolve(JSON.parse(out)); } catch { reject(new Error('parse')); }
        });
        proc.on('error', e => { clearTimeout(timer); reject(e); });
      });

      const entries = (raw.entries || []).filter(v => v.id);
      // From /shorts/ page: all entries are actual shorts; also enforce duration when available
      const shorts = entries
        .filter(v => !v.duration || v.duration <= 62)
        .slice(0, 30)
        .map(v => ({
          id: v.id,
          title: v.title || 'Short',
          thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          duration: v.duration ? formatSecondsToTime(v.duration) : '',
          durationSecs: v.duration || 0,
          views: v.view_count ? formatViewCount(v.view_count) : '',
          channel: v.uploader || v.channel || '',
          channelId: v.uploader_id || v.channel_id || '',
          channelAvatar: '',
          isShort: true,
        }));

      if (shorts.length >= 5) {
        console.log(`[shorts] Got ${shorts.length} shorts from ${src}`);
        return shorts;
      }
    } catch (e) {
      console.warn(`[shorts] source ${src} failed:`, e.message);
    }
  }

  // ── 3. Final fallback: search #shorts via innertube ───────────────────────
  if (youtube) {
    try {
      const results = await youtube.search('#shorts', { type: 'video' });
      return (results.videos || [])
        .filter(v => v.id)
        .map(v => {
          const durSecs = v.duration?.seconds ?? 0;
          const authors = buildAuthors(v);
          return {
            id: v.id,
            title: v.title?.text || 'Short',
            thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: v.duration?.text || '',
            durationSecs: durSecs,
            views: v.view_count?.text || '',
            channel: authors[0]?.name || '',
            channelId: authors[0]?.id || '',
            channelAvatar: authors[0]?.avatar || '',
            isShort: true,
            authors,
          };
        })
        .filter(v => !v.durationSecs || v.durationSecs <= 62)
        .slice(0, 30);
    } catch (e) {
      console.warn('[shorts] search fallback failed:', e.message);
    }
  }

  return [];
}

app.get('/api/shorts', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    if (!force && shortsCache.data && Date.now() - shortsCache.ts < SHORTS_TTL) {
      return res.json(shortsCache.data);
    }

    if (force) {
      shortsCache.data = null;
      shortsCache.ts = 0;
    }

    const shorts = await fetchActualShorts();

    const result = { shorts };
    shortsCache.data = result;
    shortsCache.ts = Date.now();
    res.json(result);
  } catch (e) {
    console.error('[shorts] error:', e.message);
    res.status(500).json({ shorts: [], error: e.message });
  }
});

// ─── Personalized Shorts (based on watch history) ────────────────────────────

app.get('/api/shorts/personalized', requireAuth, async (req, res) => {
  try {
    // Get recent channel IDs from watch history (last 30 entries, distinct channels)
    const historyRows = await dbAll(
      'SELECT DISTINCT channel_id FROM watch_history WHERE user_id = ? AND channel_id != "" ORDER BY watched_at DESC LIMIT 30',
      [req.user.id]
    );

    const channelIds = historyRows.map(r => r.channel_id).filter(Boolean);

    if (channelIds.length === 0) {
      return res.status(200).json({ shorts: [] });
    }

    const ytdlpArgs = buildYtDlpArgs('tv_embedded');
    const results = [];

    // Pick up to 6 channels, shuffle for variety
    const shuffled = channelIds.sort(() => Math.random() - 0.5).slice(0, 6);

    await Promise.allSettled(shuffled.map(async (channelId) => {
      try {
        const channelUrl = /^UC[a-zA-Z0-9_\-]{10,}$/.test(channelId)
          ? `https://www.youtube.com/channel/${channelId}/shorts`
          : `https://www.youtube.com/${channelId}/shorts`;

        const raw = await new Promise((resolve, reject) => {
          const args = [
            '--flat-playlist', '--no-warnings', '--quiet',
            ...ytdlpArgs,
            '--playlist-items', '1-15',
            '-J', channelUrl,
          ];
          const proc = spawn(YTDLP, args, { env: { ...process.env, HTTP_USER_AGENT: getRandomUA() } });
          let out = '';
          const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, 20000);
          proc.stdout.on('data', d => { out += d; });
          proc.stderr.on('data', () => {});
          proc.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(`exit ${code}`));
            try { resolve(JSON.parse(out)); } catch { reject(new Error('parse')); }
          });
          proc.on('error', e => { clearTimeout(timer); reject(e); });
        });

        const entries = (raw.entries || []).filter(v => v.id && (!v.duration || v.duration <= 62));
        entries.slice(0, 5).forEach(v => {
          results.push({
            id: v.id,
            title: v.title || 'Short',
            thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: v.duration ? formatSecondsToTime(v.duration) : '',
            durationSecs: v.duration || 0,
            views: v.view_count ? formatViewCount(v.view_count) : '',
            channel: v.uploader || v.channel || raw.uploader || raw.channel || '',
            channelId: v.uploader_id || v.channel_id || channelId,
            channelAvatar: '',
            isShort: true,
          });
        });
      } catch {}
    }));

    if (results.length < 5) {
      return res.status(200).json({ shorts: [] });
    }

    // Shuffle results
    const shorts = results.sort(() => Math.random() - 0.5);
    res.json({ shorts });
  } catch (e) {
    console.error('[shorts/personalized] error:', e.message);
    res.status(500).json({ shorts: [], error: e.message });
  }
});

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    youtube: !!youtube,
    activeStreams: activeStreamSet.size,
    cookies: hasCookies(),
    visitorData: !!YOUTUBE_VISITOR_DATA,
    poToken: !!YOUTUBE_PO_TOKEN,
  });
});

// Catch unmatched API routes and return JSON (not HTML)
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler — ensures unhandled exceptions return JSON, not HTML
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Bot bypass: cookies=${hasCookies()} visitor_data=${!!YOUTUBE_VISITOR_DATA} po_token=${!!YOUTUBE_PO_TOKEN}`);
});

const wss = new WebSocketServer({ server });
const wsClients = new Map(); // videoId -> Set of clients

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const videoId = url.searchParams.get('v');
  const isAdmin = url.searchParams.get('admin') === '1';

  // Parse cookies from the WS upgrade request (Express middleware doesn't run here)
  const wsCookies = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) wsCookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  const wsUser = !isAdmin ? await getSessionUser(wsCookies.session) : null;

  if (isAdmin) {
    adminWsClients.add(ws);
    // Send current watching state immediately on connect
    const cfg = await dbGet('SELECT allow_co_watch FROM admin_settings WHERE id = 1');
    if (cfg?.allow_co_watch) {
      const now = Date.now();
      const active = [];
      for (const entry of watchingNow.values()) {
        if (now - entry.updatedAt < 35000) active.push(entry);
      }
      ws.send(JSON.stringify({ type: 'watching_update', watching: active }));
    } else {
      ws.send(JSON.stringify({ type: 'watching_update', watching: [] }));
    }
  } else if (videoId) {
    if (!wsClients.has(videoId)) {
      wsClients.set(videoId, new Set());
    }
    wsClients.get(videoId).add(ws);
    ws.send(JSON.stringify({ type: 'ready', videoId }));
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      // Peer seek broadcast (video room clients)
      if (msg.type === 'seek' && msg.time !== undefined && videoId) {
        const clients = wsClients.get(videoId);
        if (clients) {
          clients.forEach(client => {
            if (client !== ws && client.readyState === 1) {
              client.send(JSON.stringify({ type: 'seek', time: msg.time, from: 'peer' }));
            }
          });
        }
      }
      // Co-watch interest registration — admin indicates which user they are watching
      if (msg.type === 'cowatch_join' && isAdmin && msg.userId) {
        coWatchTargets.set(ws, parseInt(msg.userId, 10));
        // Immediately push the current state of that user if available
        const entry = watchingNow.get(parseInt(msg.userId, 10));
        if (entry && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'cowatch_update', data: entry }));
        }
      }
      if (msg.type === 'cowatch_leave' && isAdmin) {
        coWatchTargets.delete(ws);
      }
      // Real-time position update from a user's player — 200ms interval, no HTTP involved
      if (msg.type === 'position_update' && !isAdmin && wsUser?.id) {
        const entry = {
          userId: wsUser.id,
          username: wsUser.username,
          videoId: msg.videoId || videoId || '',
          title: msg.title || '',
          thumbnail: msg.thumbnail || '',
          position: parseFloat(msg.position) || 0,
          paused: !!msg.paused,
          speed: parseFloat(msg.speed) || 1,
          quality: msg.quality || null,
          subtitleLang: msg.subtitleLang || null,
          subtitlesOn: !!msg.subtitlesOn,
          updatedAt: Date.now(),
        };
        watchingNow.set(wsUser.id, entry);
        pushCowatchUpdate(wsUser.id, entry); // instant push to co-watching admin detail view
        // Also update the admin watching list, throttled to max once per 2s per user
        const lastBroadcast = watchingBroadcastThrottle.get(wsUser.id) || 0;
        if (Date.now() - lastBroadcast > 2000) {
          watchingBroadcastThrottle.set(wsUser.id, Date.now());
          broadcastWatchingToAdmins();
        }
      }
    } catch (e) {
      // Invalid JSON, ignore
    }
  });

  ws.on('close', () => {
    if (isAdmin) {
      adminWsClients.delete(ws);
      coWatchTargets.delete(ws); // clean up any co-watch registration
    } else {
      if (wsUser?.id) watchingBroadcastThrottle.delete(wsUser.id);
      if (videoId && wsClients.has(videoId)) {
        wsClients.get(videoId).delete(ws);
        if (wsClients.get(videoId).size === 0) wsClients.delete(videoId);
      }
    }
  });
});