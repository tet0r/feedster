import { XMLParser } from 'fast-xml-parser';
import { db, tx } from './db.js';

const USER_AGENT = 'Feedster/1.0 (+self-hosted feed reader)';
const FETCH_TIMEOUT_MS = 20_000;

// fast-xml-parser counts every entity (even &lt; and &amp;) toward a 1,000-per-document
// limit by default, which ordinary feeds with escaped HTML easily exceed. Lift that count;
// DOCTYPE-defined entities stay capped in size, number and total expanded length.
const entityLimits = {
  enabled: true,
  maxTotalExpansions: 10_000_000,
  maxExpansionDepth: 10,
  maxEntitySize: 10_000,
  maxEntityCount: 100,
  maxExpandedLength: 100_000,
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: entityLimits,
  htmlEntities: true,
  trimValues: true,
  // Keep these as arrays even when a feed has a single entry.
  isArray: (name) => ['item', 'entry', 'link', 'category', 'media:content', 'enclosure'].includes(name),
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function text(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return String(v).trim();
}

function toTime(v) {
  const t = Date.parse(text(v));
  return Number.isFinite(t) ? t : null;
}

function resolveUrl(href, base) {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstImage(html, base) {
  const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? resolveUrl(m[1], base) : null;
}

function atomLink(links, rel = 'alternate') {
  const list = asArray(links);
  const hit = list.find((l) => (l['@_rel'] || 'alternate') === rel && (rel !== 'alternate' || !l['@_type'] || l['@_type'].includes('html')))
    || (rel === 'alternate' ? list.find((l) => !l['@_rel']) : null);
  return hit ? hit['@_href'] : null;
}

function mediaImage(item) {
  const thumb = item['media:thumbnail'] || item['media:group']?.['media:thumbnail'];
  if (thumb) return asArray(thumb)[0]['@_url'];
  const media = asArray(item['media:content'] || item['media:group']?.['media:content'])
    .find((m) => (m['@_medium'] === 'image') || (m['@_type'] || '').startsWith('image/'));
  if (media) return media['@_url'];
  const enc = asArray(item.enclosure).find((e) => (e['@_type'] || '').startsWith('image/'));
  if (enc) return enc['@_url'];
  // Non-standard but common: <image href="…"/>, <image>url</image>, <itunes:image href="…"/>
  const img = item.image || item['itunes:image'];
  if (img) return typeof img === 'object' ? img['@_href'] || img['@_url'] || text(img.url) || text(img) || null : text(img);
  return null;
}

/** Parse RSS 2.0 / RSS 1.0 / Atom / JSON Feed into a normalized shape. */
export function parseFeed(body, feedUrl) {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) return parseJsonFeed(JSON.parse(trimmed), feedUrl);

  const doc = parser.parse(body);

  if (doc.feed) {
    const f = doc.feed;
    const siteUrl = resolveUrl(atomLink(f.link), feedUrl);
    return {
      title: text(f.title),
      siteUrl,
      items: asArray(f.entry).map((e) => {
        const url = resolveUrl(atomLink(e.link), siteUrl || feedUrl);
        const content = text(e.content) || text(e.summary) || text(e['media:group']?.['media:description']);
        return {
          guid: text(e.id) || url || text(e.title),
          url,
          title: text(e.title),
          author: text(e.author?.name ?? e.author),
          content,
          image: mediaImage(e) || firstImage(content, url),
          published: toTime(e.published) ?? toTime(e.updated),
        };
      }),
    };
  }

  const channel = doc.rss?.channel || doc['rdf:RDF']?.channel;
  if (!channel) throw new Error('Not a recognizable RSS/Atom feed');
  const rawItems = asArray(doc.rss ? channel.item : doc['rdf:RDF'].item);
  const siteUrl = resolveUrl(text(asArray(channel.link).find((l) => typeof l !== 'object' || l['#text'])), feedUrl);

  return {
    title: text(channel.title),
    siteUrl,
    items: rawItems.map((i) => {
      const url = resolveUrl(text(i.link) || (i.guid?.['@_isPermaLink'] !== 'false' ? text(i.guid) : ''), siteUrl || feedUrl);
      const content = text(i['content:encoded']) || text(i.description);
      return {
        guid: text(i.guid) || url || text(i.title),
        url,
        title: text(i.title),
        author: text(i['dc:creator']) || text(i.author),
        content,
        image: mediaImage(i) || firstImage(content, url),
        published: toTime(i.pubDate) ?? toTime(i['dc:date']),
      };
    }),
  };
}

function parseJsonFeed(j, feedUrl) {
  return {
    title: j.title || '',
    siteUrl: resolveUrl(j.home_page_url, feedUrl),
    items: asArray(j.items).map((i) => ({
      guid: String(i.id ?? i.url),
      url: resolveUrl(i.url, feedUrl),
      title: i.title || '',
      author: i.authors?.[0]?.name || i.author?.name || '',
      content: i.content_html || (i.content_text ? `<p>${escapeHtml(i.content_text)}</p>` : '') || i.summary || '',
      image: i.image || i.banner_image || null,
      published: toTime(i.date_published) ?? toTime(i.date_modified),
    })),
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function httpGet(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res;
}

const looksLikeFeed = (body) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(body) || /^\s*\{[\s\S]*"version"\s*:\s*"https:\/\/jsonfeed/.test(body);

// Big sites whose pages don't link to their feeds. Each one was checked to serve a feed to Feedster.
const KNOWN_FEEDS = {
  'mlb.com': 'https://www.mlb.com/feeds/news/rss.xml',
  'espn.com': 'https://www.espn.com/espn/rss/news',
  'bbc.com': 'https://feeds.bbci.co.uk/news/rss.xml',
  'bbc.co.uk': 'https://feeds.bbci.co.uk/news/rss.xml',
  'cnn.com': 'http://rss.cnn.com/rss/cnn_topstories.rss',
  'nytimes.com': 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
};

function knownFeed(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return KNOWN_FEEDS[host] || null;
}

function feedLinks(html, baseUrl) {
  const found = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attr = (name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    if (/alternate/i.test(attr('rel') || '') && /(rss|atom|feed)\+?(xml|json)/i.test(attr('type') || '')) {
      const href = resolveUrl(attr('href'), baseUrl);
      if (href) found.push(href);
    }
  }
  return found;
}

/** Common feed locations, starting with ones relative to the page (reddit /r/x/.rss, medium /feed/@user). */
function guessedFeeds(pageUrl) {
  const u = new URL(pageUrl);
  const dir = u.pathname.replace(/\/+$/, '');
  const paths = [];
  if (dir) paths.push(`${dir}/.rss`, `${dir}/feed`, `${dir}/rss`, `${dir}/feed.xml`, `${dir}/rss.xml`, `/feed${dir}`);
  paths.push('/feed', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml', '/feed.json', '/?feed=rss2', '/feeds/posts/default');
  return paths.map((p) => new URL(p, u.origin).href);
}

async function fetchFeed(url) {
  try {
    const res = await httpGet(url);
    if (!res.ok) return null;
    const body = await res.text();
    return looksLikeFeed(body) ? { url: res.url || url, body } : null;
  } catch {
    return null;
  }
}

/** First candidate (in order) that turns out to be a feed; all are fetched at once. */
async function firstFeed(candidates) {
  const unique = [...new Set(candidates)];
  const results = unique.map(fetchFeed);
  for (const r of results) {
    const hit = await r;
    if (hit) return hit;
  }
  return null;
}

/**
 * Find a feed from whatever the user typed: a feed URL, or a page that links to one,
 * or a site whose feed sits at a common or known address.
 */
export async function discover(inputUrl) {
  let url = inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error("That doesn't look like a web address"); }

  let page = null;
  let status = null;
  try {
    const res = await httpGet(url);
    status = res.status;
    if (res.ok) page = { url: res.url || url, body: await res.text() };
  } catch (err) {
    throw new Error(`Couldn't reach ${host} (${err.cause?.code || err.message})`);
  }
  if (page && looksLikeFeed(page.body)) return page;

  // A site may refuse its homepage to feed readers but still serve its feed, so keep looking.
  const base = page?.url || url;
  const hit = (page && await firstFeed(feedLinks(page.body, base)))
    || await firstFeed([...(knownFeed(base) ? [knownFeed(base)] : []), ...guessedFeeds(base)]);
  if (hit) return hit;

  if (status === 401 || status === 403 || status === 429) {
    throw new Error(`${host} blocks feed readers (HTTP ${status}) and no feed was found. If the site has a feed, paste its address instead.`);
  }
  if (!page) throw new Error(`${host} returned HTTP ${status}`);
  throw new Error(`No feed found on ${host}. If the site has one (often linked as "RSS"), paste its address instead.`);
}

const insertArticle = db.prepare(`
  INSERT INTO articles (feed_id, guid, url, title, author, content, image, published, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (feed_id, guid) DO UPDATE SET
    title = excluded.title, content = excluded.content, url = excluded.url, image = excluded.image
`);
const articleExists = db.prepare('SELECT 1 FROM articles WHERE feed_id = ? AND guid = ?');

function storeItems(feedId, items, { markRead = false } = {}) {
  const now = Date.now();
  let added = 0;
  tx(() => {
    // Items without dates keep their feed order by spacing them out by a millisecond.
    items.forEach((item, idx) => {
      if (!item.guid) return;
      const isNew = !articleExists.get(feedId, item.guid);
      insertArticle.run(feedId, item.guid, item.url, item.title || stripTags(item.content).slice(0, 120) || '(untitled)',
        item.author || null, item.content, item.image, item.published ?? now - idx, now);
      if (isNew) added++;
    });
    if (markRead) db.prepare('UPDATE articles SET read = 1 WHERE feed_id = ?').run(feedId);
  });
  return added;
}

export async function subscribe(inputUrl, folderId = null) {
  const { url, body } = await discover(inputUrl);
  const existing = db.prepare('SELECT id FROM feeds WHERE url = ?').get(url);
  if (existing) return { id: existing.id, existed: true };

  const parsed = parseFeed(body, url);
  const title = parsed.title || new URL(url).hostname;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO feeds (url, title, site_url, folder_id, last_fetched, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(url, title, parsed.siteUrl, folderId, Date.now(), Date.now());
  const id = Number(lastInsertRowid);
  storeItems(id, parsed.items);
  return { id, existed: false };
}

export async function refreshFeed(feed) {
  try {
    const headers = {};
    if (feed.etag) headers['If-None-Match'] = feed.etag;
    if (feed.last_modified) headers['If-Modified-Since'] = feed.last_modified;
    const res = await httpGet(feed.url, headers);
    if (res.status === 304) {
      db.prepare('UPDATE feeds SET last_fetched = ?, last_error = NULL WHERE id = ?').run(Date.now(), feed.id);
      return 0;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseFeed(await res.text(), feed.url);
    const added = storeItems(feed.id, parsed.items);
    db.prepare('UPDATE feeds SET etag = ?, last_modified = ?, last_fetched = ?, last_error = NULL, site_url = COALESCE(site_url, ?) WHERE id = ?')
      .run(res.headers.get('etag'), res.headers.get('last-modified'), Date.now(), parsed.siteUrl, feed.id);
    return added;
  } catch (err) {
    db.prepare('UPDATE feeds SET last_fetched = ?, last_error = ? WHERE id = ?').run(Date.now(), String(err.message || err), feed.id);
    return 0;
  }
}

let refreshing = null;

/** Refresh every feed (or one), a few at a time. Concurrent callers share the same run. */
export function refreshAll(feedId = null) {
  if (feedId) {
    const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedId);
    return feed ? refreshFeed(feed) : Promise.resolve(0);
  }
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const queue = db.prepare('SELECT * FROM feeds').all();
    let added = 0;
    const worker = async () => {
      while (queue.length) added += await refreshFeed(queue.shift());
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    pruneOld();
    return added;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function isRefreshing() {
  return Boolean(refreshing);
}

/** Drop read, unstarred articles past the retention window. */
function pruneOld() {
  const days = Number(process.env.FEEDSTER_RETENTION_DAYS || 90);
  if (!days) return;
  db.prepare('DELETE FROM articles WHERE read = 1 AND starred = 0 AND published < ?').run(Date.now() - days * 86_400_000);
}

// ---- OPML ----

export function exportOpml() {
  const folders = db.prepare('SELECT * FROM folders ORDER BY position, name').all();
  const feeds = db.prepare('SELECT * FROM feeds ORDER BY title COLLATE NOCASE').all();
  const outline = (f) => `<outline type="rss" text="${escapeHtml(f.title)}" title="${escapeHtml(f.title)}" xmlUrl="${escapeHtml(f.url)}"${f.site_url ? ` htmlUrl="${escapeHtml(f.site_url)}"` : ''}/>`;
  const lines = [];
  for (const folder of folders) {
    lines.push(`    <outline text="${escapeHtml(folder.name)}" title="${escapeHtml(folder.name)}">`);
    for (const f of feeds.filter((x) => x.folder_id === folder.id)) lines.push(`      ${outline(f)}`);
    lines.push('    </outline>');
  }
  for (const f of feeds.filter((x) => !x.folder_id)) lines.push(`    ${outline(f)}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Feedster subscriptions</title><dateCreated>${new Date().toUTCString()}</dateCreated></head>
  <body>
${lines.join('\n')}
  </body>
</opml>
`;
}

/** Import an OPML file: creates folders and feeds immediately, then fetches them in the background. */
export function importOpml(xml) {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', processEntities: entityLimits, isArray: (n) => n === 'outline' }).parse(xml);
  const root = doc.opml?.body?.outline;
  if (!root) throw new Error('Not a valid OPML file');

  const getFolder = (name) => {
    db.prepare('INSERT OR IGNORE INTO folders (name, position) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM folders))').run(name);
    return db.prepare('SELECT id FROM folders WHERE name = ?').get(name).id;
  };
  const insertFeed = db.prepare('INSERT OR IGNORE INTO feeds (url, title, site_url, folder_id, created_at) VALUES (?, ?, ?, ?, ?)');

  let imported = 0;
  const walk = (outlines, folderId) => {
    for (const o of asArray(outlines)) {
      if (o.xmlUrl) {
        imported += Number(insertFeed.run(o.xmlUrl, o.title || o.text || o.xmlUrl, o.htmlUrl || null, folderId, Date.now()).changes);
      } else if (o.outline) {
        // Nested folders are flattened into their top-level folder.
        walk(o.outline, folderId ?? getFolder(o.title || o.text || 'Imported'));
      }
    }
  };
  tx(() => walk(root, null));
  refreshAll().catch(() => {});
  return imported;
}
