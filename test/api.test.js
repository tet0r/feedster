import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Runs a real Feedster against a local feed and drives it the way reading apps do.

const PORT = 18080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const USER = 'reader';
const PASS = 'correct horse';
let feedServer;
let feedUrl;
let app;
let dataDir;

const rss = (n) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Local Feed</title><link>http://example.com/</link>${
  Array.from({ length: n }, (_, i) => `<item><guid>item-${i}</guid><title>Post ${i}</title><link>http://example.com/${i}</link>
    <description>&lt;p&gt;Body ${i}&lt;/p&gt;</description><pubDate>${new Date(Date.UTC(2026, 0, 1 + i)).toUTCString()}</pubDate></item>`).join('')
}</channel></rss>`;

async function web(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  return res.json();
}

let authToken;
async function gr(p, { method = 'GET', form, auth = true } = {}) {
  const res = await fetch(`${BASE}/api/greader.php${p}`, {
    method,
    headers: { ...(auth && { Authorization: `GoogleLogin auth=${authToken}` }), ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, json: () => JSON.parse(text) };
}

const feverKey = crypto.createHash('md5').update(`${USER}:${PASS}`).digest('hex');
async function fever(query, form = {}) {
  const res = await fetch(`${BASE}/api/fever.php?api&${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_key: feverKey, ...form }).toString(),
  });
  return res.json();
}

before(async () => {
  feedServer = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); res.end(rss(5)); });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
  feedUrl = `http://127.0.0.1:${feedServer.address().port}/feed.xml`;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedster-test-'));
  app = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT), FEEDSTER_DATA: dataDir, FEEDSTER_REFRESH_MINUTES: '0', UPDATE_CHECK: 'false', FEEDSTER_PASSWORD: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/state`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  await web('/api/folders', { method: 'POST', body: JSON.stringify({ name: 'Tech' }) });
  await web('/api/feeds', { method: 'POST', body: JSON.stringify({ url: feedUrl, folderId: 1 }) });
});

after(async () => {
  feedServer?.close();
  // Wait for the server to exit so Windows releases the database file before it is removed.
  if (app && app.exitCode === null) await new Promise((r) => { app.once('exit', r); app.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('APIs refuse everyone until app sync is set up', async () => {
  assert.equal((await gr('/accounts/ClientLogin', { method: 'POST', form: { Email: USER, Passwd: PASS }, auth: false })).status, 401);
  assert.equal((await fever('groups')).auth, 0);
  const bad = await web('/api/sync', { method: 'PUT', body: JSON.stringify({ username: USER, password: 'short' }) });
  assert.match(bad.error, /8 characters/);
  const ok = await web('/api/sync', { method: 'PUT', body: JSON.stringify({ username: USER, password: PASS }) });
  assert.deepEqual(ok, { username: USER, enabled: true });
});

test('Google Reader: sign in', async () => {
  assert.equal((await gr('/accounts/ClientLogin', { method: 'POST', form: { Email: USER, Passwd: 'wrong' }, auth: false })).status, 401);
  const login = await gr('/accounts/ClientLogin', { method: 'POST', form: { Email: USER, Passwd: PASS }, auth: false });
  assert.equal(login.status, 200);
  authToken = login.text.match(/Auth=(.+)/)[1];
  assert.equal((await gr('/reader/api/0/token')).status, 200);
  assert.equal((await gr('/reader/api/0/user-info')).json().userName, USER);

  const saved = authToken;
  authToken = 'nope';
  assert.equal((await gr('/reader/api/0/subscription/list?output=json')).status, 401);
  authToken = saved;
});

test('Google Reader: subscriptions, folders and unread counts', async () => {
  const subs = (await gr('/reader/api/0/subscription/list?output=json')).json().subscriptions;
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, 'feed/1');
  assert.deepEqual(subs[0].categories, [{ id: 'user/-/label/Tech', label: 'Tech' }]);

  const tags = (await gr('/reader/api/0/tag/list?output=json')).json().tags.map((t) => t.id);
  assert.ok(tags.includes('user/-/state/com.google/starred'));
  assert.ok(tags.includes('user/-/label/Tech'));

  const counts = Object.fromEntries((await gr('/reader/api/0/unread-count?output=json')).json().unreadcounts.map((c) => [c.id, c.count]));
  assert.equal(counts['feed/1'], 5);
  assert.equal(counts['user/-/label/Tech'], 5);
  assert.equal(counts['user/-/state/com.google/reading-list'], 5);
});

test('Google Reader: NetNewsWire-style sync of unread ids, contents and read state', async () => {
  const unread = (await gr('/reader/api/0/stream/items/ids?output=json&s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=1000')).json().itemRefs;
  assert.equal(unread.length, 5);

  // Contents requested with long-form ids, as most clients send them.
  const longIds = unread.slice(0, 2).map((r) => `tag:google.com,2005:reader/item/${Number(r.id).toString(16).padStart(16, '0')}`);
  const form = new URLSearchParams();
  for (const id of longIds) form.append('i', id);
  const items = (await gr('/reader/api/0/stream/items/contents?output=json', { method: 'POST', form })).json().items;
  assert.equal(items.length, 2);
  assert.equal(items[0].id, longIds[0]);
  assert.equal(items[0].origin.streamId, 'feed/1');
  assert.match(items[0].summary.content, /<p>Body \d<\/p>/);
  assert.ok(items[0].categories.includes('user/-/label/Tech'));

  // Mark one read and star another from the "app", then check the web app agrees.
  await gr('/reader/api/0/edit-tag', { method: 'POST', form: { i: longIds[0], a: 'user/-/state/com.google/read' } });
  await gr('/reader/api/0/edit-tag', { method: 'POST', form: { i: unread[1].id, a: 'user/-/state/com.google/starred' } });
  const state = await web('/api/state');
  assert.equal(state.totals.unread, 4);
  assert.equal(state.totals.starred, 1);

  const starred = (await gr('/reader/api/0/stream/items/ids?output=json&s=user/-/state/com.google/starred&n=1000')).json().itemRefs;
  assert.deepEqual(starred.map((r) => r.id), [unread[1].id]);

  // And the other way: a change in the web app shows up in the app.
  await web(`/api/articles/${unread[0].id}`, { method: 'PATCH', body: JSON.stringify({ read: false }) });
  const after = (await gr('/reader/api/0/stream/items/ids?output=json&s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=1000')).json().itemRefs;
  assert.equal(after.length, 5);
});

test('Google Reader: Reeder-style stream contents with paging', async () => {
  const page1 = (await gr('/reader/api/0/stream/contents/feed%2F1?output=json&n=3')).json();
  assert.equal(page1.items.length, 3);
  assert.ok(page1.continuation);
  const page2 = (await gr(`/reader/api/0/stream/contents/user/-/label/Tech?output=json&n=3&c=${page1.continuation}`)).json();
  assert.equal(page2.items.length, 2);
  assert.equal(page2.continuation, undefined);
  const titles = [...page1.items, ...page2.items].map((i) => i.title);
  assert.equal(new Set(titles).size, 5);
});

test('Google Reader: manage subscriptions and mark all read', async () => {
  await gr('/reader/api/0/subscription/edit', { method: 'POST', form: { ac: 'edit', s: 'feed/1', t: 'Renamed', a: 'user/-/label/News' } });
  let subs = (await gr('/reader/api/0/subscription/list?output=json')).json().subscriptions;
  assert.equal(subs[0].title, 'Renamed');
  assert.equal(subs[0].categories[0].label, 'News');

  await gr('/reader/api/0/rename-tag', { method: 'POST', form: { s: 'user/-/label/News', dest: 'user/-/label/Daily' } });
  subs = (await gr('/reader/api/0/subscription/list?output=json')).json().subscriptions;
  assert.equal(subs[0].categories[0].label, 'Daily');

  await gr('/reader/api/0/mark-all-as-read', { method: 'POST', form: { s: 'feed/1', ts: String(Date.now() * 1000) } });
  assert.equal((await web('/api/state')).totals.unread, 0);

  const added = (await gr('/reader/api/0/subscription/quickadd', { method: 'POST', form: { quickadd: `${feedUrl}?second` } })).json();
  assert.equal(added.numResults, 1);
  assert.equal((await web('/api/state')).feeds.length, 2);
  await gr('/reader/api/0/subscription/edit', { method: 'POST', form: { ac: 'unsubscribe', s: added.streamId } });
  assert.equal((await web('/api/state')).feeds.length, 1);
});

test('Fever: groups, feeds, items and marking', async () => {
  assert.equal((await fetch(`${BASE}/api/fever.php?api`, { method: 'POST', body: 'api_key=wrong', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).then((r) => r.json())).auth, 0);

  const groups = await fever('groups');
  assert.equal(groups.auth, 1);
  assert.equal(groups.api_version, 3);
  assert.deepEqual(groups.groups.map((g) => g.title), ['Tech', 'Daily']);
  assert.deepEqual(groups.feeds_groups, [{ group_id: 2, feed_ids: '1' }]);

  const feeds = await fever('feeds');
  assert.equal(feeds.feeds[0].title, 'Renamed');
  assert.equal((await fever('favicons')).favicons.length, 1);

  const items = await fever('items&since_id=0');
  assert.equal(items.items.length, 5);
  assert.equal(items.total_items, 5);
  assert.ok(items.items.every((i) => i.is_read === 1));
  assert.equal((await fever(`items&since_id=${items.items[4].id}`)).items.length, 0);
  assert.equal((await fever('items&with_ids=1,2')).items.length, 2);

  const id = items.items[0].id;
  const unread = await fever(`mark=item&as=unread&id=${id}`);
  assert.equal(unread.unread_item_ids, String(id));
  const saved = await fever(`mark=item&as=saved&id=${id}`);
  assert.ok(saved.saved_item_ids.split(',').includes(String(id)));

  await fever(`mark=group&as=read&id=0&before=${Math.floor(Date.now() / 1000) + 5}`);
  assert.equal((await fever('unread_item_ids')).unread_item_ids, '');
});

test('turning app sync off signs apps out', async () => {
  await web('/api/sync', { method: 'PUT', body: JSON.stringify({}) });
  assert.equal((await gr('/reader/api/0/subscription/list?output=json')).status, 401);
  assert.equal((await fever('groups')).auth, 0);
});
