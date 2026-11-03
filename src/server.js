import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { subscribe, refreshAll, isRefreshing, exportOpml, importOpml } from './feeds.js';
import { VERSION, availableUpdate, startUpdateChecker } from './updates.js';
import { getIcon } from './icons.js';
import { fullArticle } from './fulltext.js';
import { send, readBody } from './http.js';
import { syncStatus, setSyncCredentials } from './sync.js';
import { handleFever } from './fever.js';
import { handleGReader } from './greader.js';

const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.FEEDSTER_PASSWORD || '';
const REFRESH_MINUTES = Number(process.env.FEEDSTER_REFRESH_MINUTES || 15);
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, '..', 'public');

const STATIC = {
  '/vendor/purify.min.js': path.join(root, '..', 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// ---- auth (optional, single user) ----

const secret = crypto.createHash('sha256').update(`feedster:${PASSWORD}`).digest();
const sessionToken = () => crypto.createHmac('sha256', secret).update('session').digest('hex');

function authed(req) {
  if (!PASSWORD) return true;
  const cookie = (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === 'feedster');
  const token = cookie?.[1] || '';
  const expected = sessionToken();
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

async function json(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

/** Build a WHERE clause for an article scope: { feed, folder, view: all|unread|starred, q } */
function scopeWhere({ feed, folder, view, q }) {
  const where = [];
  const params = [];
  if (feed) { where.push('a.feed_id = ?'); params.push(Number(feed)); }
  if (folder) { where.push('f.folder_id = ?'); params.push(Number(folder)); }
  if (view === 'unread') where.push('a.read = 0');
  if (view === 'starred') where.push('a.starred = 1');
  if (q) {
    where.push('(a.title LIKE ? OR a.content LIKE ? OR a.author LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// ---- API ----

function state() {
  const folders = db.prepare('SELECT * FROM folders ORDER BY position, name COLLATE NOCASE').all();
  const feeds = db.prepare(`
    SELECT f.id, f.title, f.url, f.site_url, f.folder_id, f.last_fetched, f.last_error, f.next_fetch_at,
      (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.read = 0) AS unread,
      (SELECT checked_at FROM icons i WHERE i.feed_id = f.id AND i.data IS NOT NULL) AS icon
    FROM feeds f ORDER BY f.title COLLATE NOCASE`).all();
  const totals = db.prepare('SELECT SUM(read = 0) AS unread, SUM(starred = 1) AS starred, COUNT(*) AS total FROM articles').get();
  return {
    folders,
    feeds,
    totals: { unread: totals.unread || 0, starred: totals.starred || 0, total: totals.total || 0 },
    refreshing: isRefreshing(),
    version: VERSION,
    update: availableUpdate(),
  };
}

const routes = [
  ['GET', /^\/api\/state$/, () => state()],

  ['GET', /^\/api\/articles$/, (req, _m, url) => {
    const p = Object.fromEntries(url.searchParams);
    const { sql, params } = scopeWhere(p);
    const limit = Math.min(Number(p.limit) || 50, 200);
    const asc = p.order === 'oldest';
    let cursor = '';
    if (p.cursor) {
      const [pub, id] = p.cursor.split(':').map(Number);
      cursor = `${sql ? 'AND' : 'WHERE'} (a.published, a.id) ${asc ? '>' : '<'} (?, ?)`;
      params.push(pub, id);
    }
    const rows = db.prepare(`
      SELECT a.id, a.feed_id, a.url, a.title, a.author, a.image, a.published, a.read, a.starred,
        substr(a.content, 1, 1200) AS snippet, ${p.full ? 'a.content,' : ''} f.title AS feed_title, f.site_url
      FROM articles a JOIN feeds f ON f.id = a.feed_id
      ${sql} ${cursor}
      ORDER BY a.published ${asc ? 'ASC' : 'DESC'}, a.id ${asc ? 'ASC' : 'DESC'}
      LIMIT ?`).all(...params, limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({ ...r, snippet: snippetText(r.snippet) }));
    const last = items.at(-1);
    return { items, cursor: more && last ? `${last.published}:${last.id}` : null };
  }],

  ['GET', /^\/api\/articles\/(\d+)$/, (_req, m) => {
    const a = db.prepare(`SELECT a.*, f.title AS feed_title, f.site_url FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.id = ?`).get(Number(m[1]));
    return a || [404, { error: 'Not found' }];
  }],

  ['GET', /^\/api\/articles\/(\d+)\/full$/, async (_req, m) => {
    const result = await fullArticle(Number(m[1]));
    return result || [404, { error: 'Not found' }];
  }],

  ['PATCH', /^\/api\/articles\/(\d+)$/, async (req, m) => {
    const body = await json(req);
    if ('read' in body) db.prepare('UPDATE articles SET read = ? WHERE id = ?').run(body.read ? 1 : 0, Number(m[1]));
    if ('starred' in body) db.prepare('UPDATE articles SET starred = ? WHERE id = ?').run(body.starred ? 1 : 0, Number(m[1]));
    return { ok: true };
  }],

  ['POST', /^\/api\/mark-read$/, async (req) => {
    const body = await json(req);
    const { sql, params } = scopeWhere({ feed: body.feed, folder: body.folder, view: body.view === 'starred' ? 'starred' : undefined, q: body.q });
    const extra = body.olderThan ? `${sql ? 'AND' : 'WHERE'} a.published < ?` : '';
    if (body.olderThan) params.push(Number(body.olderThan));
    const r = db.prepare(`UPDATE articles SET read = 1 WHERE read = 0 AND id IN (
      SELECT a.id FROM articles a JOIN feeds f ON f.id = a.feed_id ${sql} ${extra})`).run(...params);
    return { marked: Number(r.changes) };
  }],

  ['POST', /^\/api\/feeds$/, async (req) => {
    const { url, folderId } = await json(req);
    if (!url) return [400, { error: 'URL required' }];
    try {
      return await subscribe(url, folderId || null);
    } catch (err) {
      return [422, { error: err.message }];
    }
  }],

  ['GET', /^\/api\/feeds\/(\d+)\/icon$/, (_req, m) => {
    const icon = getIcon(Number(m[1]));
    if (!icon) return [404, { error: 'No icon' }];
    // The URL carries the icon's version, so it can be cached. The CSP keeps an SVG icon
    // from running scripts if someone opens it directly.
    return [200, Buffer.from(icon.data), {
      'Content-Type': icon.type,
      'Cache-Control': 'private, max-age=604800',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    }];
  }],

  ['PATCH', /^\/api\/feeds\/(\d+)$/, async (req, m) => {
    const body = await json(req);
    if (body.title) db.prepare('UPDATE feeds SET title = ? WHERE id = ?').run(String(body.title), Number(m[1]));
    if ('folderId' in body) db.prepare('UPDATE feeds SET folder_id = ? WHERE id = ?').run(body.folderId || null, Number(m[1]));
    return { ok: true };
  }],

  ['DELETE', /^\/api\/feeds\/(\d+)$/, (_req, m) => {
    db.prepare('DELETE FROM feeds WHERE id = ?').run(Number(m[1]));
    return { ok: true };
  }],

  ['POST', /^\/api\/folders$/, async (req) => {
    const { name } = await json(req);
    if (!name?.trim()) return [400, { error: 'Name required' }];
    db.prepare('INSERT OR IGNORE INTO folders (name, position) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM folders))').run(name.trim());
    return db.prepare('SELECT * FROM folders WHERE name = ?').get(name.trim());
  }],

  ['PATCH', /^\/api\/folders\/(\d+)$/, async (req, m) => {
    const { name } = await json(req);
    if (name?.trim()) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name.trim(), Number(m[1]));
    return { ok: true };
  }],

  ['DELETE', /^\/api\/folders\/(\d+)$/, (_req, m) => {
    // Feeds inside fall back to the top level (ON DELETE SET NULL).
    db.prepare('DELETE FROM folders WHERE id = ?').run(Number(m[1]));
    return { ok: true };
  }],

  ['POST', /^\/api\/refresh$/, async (req) => {
    const { feed } = await json(req);
    if (feed) return { added: await refreshAll(Number(feed)) };
    refreshAll().catch(() => {});
    return { started: true };
  }],

  ['GET', /^\/api\/sync$/, () => syncStatus()],

  ['PUT', /^\/api\/sync$/, async (req) => {
    // Both set turns app sync on (or changes the password); both empty turns it off.
    const body = await json(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (username || password) {
      if (!username) return [400, { error: 'Username required' }];
      if (password.length < 8) return [400, { error: 'Use at least 8 characters for the app password' }];
    }
    setSyncCredentials(username, password);
    return syncStatus();
  }],

  ['GET', /^\/api\/opml$/, () => [200, exportOpml(), {
    'Content-Type': 'text/x-opml; charset=utf-8',
    'Content-Disposition': 'attachment; filename="feedster.opml"',
  }]],

  ['POST', /^\/api\/opml$/, async (req) => {
    try {
      return { imported: importOpml(await readBody(req)) };
    } catch (err) {
      return [400, { error: err.message }];
    }
  }],
];

function snippetText(html) {
  return (html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function serveStatic(res, pathname) {
  const file = STATIC[pathname] || path.join(publicDir, path.normalize(pathname === '/' ? '/index.html' : pathname));
  if (!STATIC[pathname] && !file.startsWith(publicDir)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const LOGIN_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedster</title><link rel="stylesheet" href="/style.css">
<body class="login"><form method="post" action="/login"><h1>Feedster</h1>
<input type="password" name="password" placeholder="Password" autofocus required><button>Sign in</button></form></body>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/login' && req.method === 'POST') {
      const pw = new URLSearchParams(await readBody(req)).get('password') || '';
      const ok = PASSWORD && pw.length === PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(PASSWORD));
      if (!ok) return send(res, 401, LOGIN_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });
      res.writeHead(303, { Location: '/', 'Set-Cookie': `feedster=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` });
      return res.end();
    }
    // Reading apps authenticate with their own credentials (see sync.js).
    const greaderBase = ['/api/greader.php', '/api/greader'].find((b) => url.pathname === b || url.pathname.startsWith(`${b}/`));
    if (greaderBase) return await handleGReader(req, res, url, greaderBase);
    if (['/api/fever.php', '/api/fever', '/fever', '/fever/'].includes(url.pathname)) return await handleFever(req, res, url);

    if (!authed(req) && url.pathname !== '/style.css') {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, LOGIN_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (url.pathname.startsWith('/api/')) {
      for (const [method, pattern, handler] of routes) {
        const m = req.method === method && url.pathname.match(pattern);
        if (!m) continue;
        const result = await handler(req, m, url);
        return Array.isArray(result) ? send(res, ...result) : send(res, 200, result);
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    send(res, 405, 'Method not allowed');
  } catch (err) {
    console.error(err);
    send(res, err.status || 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Feedster ${VERSION} listening on http://localhost:${PORT}${PASSWORD ? ' (password protected)' : ''}`);
});

startUpdateChecker();

if (REFRESH_MINUTES > 0) {
  setInterval(() => refreshAll().catch(console.error), REFRESH_MINUTES * 60_000);
  setTimeout(() => refreshAll().catch(console.error), 5_000);
}
