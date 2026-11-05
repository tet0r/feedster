import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { normalizeServer, originPattern, signIn, unreadSummary, badgeText, AuthError } from '../extension/api.js';

// Runs the browser extension's code against a real Feedster, with a stand-in for the browser's
// extension API that records what the toolbar badge would show.

const PORT = 19100 + Math.floor(Math.random() * 800);
const SERVER = `http://127.0.0.1:${PORT}`;
const USER = 'reader';
const PASS = 'extension pass';
const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Local</title><link>/</link>${
  [1, 2, 3].map((i) => `<item><guid>${i}</guid><title>Story ${i}</title><link>/story/${i}</link>
    <pubDate>${new Date(Date.UTC(2026, 10, i)).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

let feedServer;
let app;
let dataDir;

const web = (p, opts = {}) => fetch(SERVER + p, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Feedster': '1' } }).then((r) => r.json());

before(async () => {
  feedServer = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); res.end(FEED); });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedster-ext-'));
  app = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT), FEEDSTER_DATA: dataDir, FEEDSTER_REFRESH_MINUTES: '0', UPDATE_CHECK: 'false', FEEDSTER_PASSWORD: '' },
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 200 && !up; i++) {
    try { up = (await fetch(`${SERVER}/api/state`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!up) throw new Error('Feedster did not start');
  await web('/api/sync', { method: 'PUT', body: JSON.stringify({ username: USER, password: PASS }) });
  await web('/api/feeds', { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${feedServer.address().port}/feed.xml` }) });
});

after(async () => {
  feedServer?.close();
  if (app && app.exitCode === null) await new Promise((r) => { app.once('exit', r); app.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('normalizes the Feedster address people type', () => {
  assert.equal(normalizeServer('feeds.example.com/'), 'https://feeds.example.com');
  assert.equal(normalizeServer('http://nas.local:8080/feedster/'), 'http://nas.local:8080/feedster');
  assert.equal(originPattern('http://nas.local:8080/feedster'), 'http://nas.local:8080/*');
  assert.throws(() => normalizeServer('  '), /Enter your Feedster address/);
});

test('formats the badge', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(42), '42');
  assert.equal(badgeText(1500), '999+');
});

test('signs in with the app password and reports a wrong one clearly', async () => {
  await assert.rejects(signIn(SERVER, USER, 'nope'), (err) => err instanceof AuthError && /Wrong username or app password/.test(err.message));
  await assert.rejects(signIn('http://127.0.0.1:1', USER, PASS), /Can't reach Feedster/);
  assert.match(await signIn(SERVER, USER, PASS), /^reader\/[0-9a-f]+$/);
});

test('reads the unread count and newest unread articles', async () => {
  const token = await signIn(SERVER, USER, PASS);
  const summary = await unreadSummary(SERVER, token);
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.items.map((i) => i.title), ['Story 3', 'Story 2', 'Story 1']);
  assert.equal(summary.items[0].feed, 'Local');
  assert.match(summary.items[0].url, /\/story\/3$/);
});

// ---- the background script, with a stand-in browser API

function fakeBrowser(initial) {
  const store = { ...initial };
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const badge = { text: '', color: '', title: '' };
  const scripts = new Map();
  const granted = new Set(initial.granted || []);
  // Like the browser: changes to storage are announced to onChanged listeners.
  const changed = (keys) => listeners.storage?.(Object.fromEntries(keys.map((k) => [k, {}])), 'local');
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (obj) => { Object.assign(store, obj); changed(Object.keys(obj)); },
        remove: async (keys) => { [].concat(keys).forEach((k) => delete store[k]); changed([].concat(keys)); },
      },
      onChanged: on('storage'),
    },
    permissions: { contains: async ({ origins }) => origins.every((o) => granted.has(o)) },
    scripting: {
      registerContentScripts: async (list) => list.forEach((c) => {
        if (scripts.has(c.id)) throw new Error(`Duplicate script ID '${c.id}'`);
        scripts.set(c.id, c);
      }),
      unregisterContentScripts: async ({ ids }) => ids.forEach((id) => {
        if (!scripts.delete(id)) throw new Error(`Nonexistent script ID '${id}'`);
      }),
    },
    action: {
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
      setTitle: async ({ title }) => { badge.title = title; },
    },
    alarms: { clear: async () => true, create: async (name, info) => { badge.alarm = info.periodInMinutes; }, onAlarm: on('alarm') },
    runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message'), openOptionsPage: () => { badge.openedOptions = true; } },
  };
  const send = (message) => new Promise((resolve) => listeners.message(message, {}, resolve));
  return { store, badge, listeners, send, scripts };
}

test('the toolbar badge follows the unread count, and asks to sign in again when needed', async () => {
  const token = await signIn(SERVER, USER, PASS);
  const browser = fakeBrowser({ server: SERVER, username: USER, token, interval: 5, granted: [originPattern(SERVER)] });
  await import(`../extension/background.js?${Date.now()}`);

  await browser.listeners.installed({ reason: 'install' });
  assert.equal(browser.badge.text, '3');
  assert.equal(browser.badge.title, 'Feedster: 3 unread');
  assert.equal(browser.badge.alarm, 5);
  assert.equal(browser.badge.openedOptions, true, 'first install opens the setup page');
  assert.equal(browser.store.state.items.length, 3, 'the popup has articles to show');
  assert.deepEqual(browser.scripts.get('feedster-page')?.matches, [originPattern(SERVER)], "watches the connected Feedster's pages");
  assert.deepEqual(browser.scripts.get('feedster-page').js, ['feedster-page.js']);
  await browser.listeners.startup();
  assert.equal(browser.scripts.size, 1, 'registering again on startup replaces the script');

  // Reading an article in Feedster lowers the count on the next check.
  const article = (await web('/api/articles?view=unread')).items[0];
  await fetch(`${SERVER}/api/articles/${article.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Feedster': '1' }, body: JSON.stringify({ read: true }) });
  await browser.send({ type: 'refresh' });
  assert.equal(browser.badge.text, '2');

  // A new app password signs the extension out: grey "!" and a prompt to sign in again.
  await web('/api/sync', { method: 'PUT', body: JSON.stringify({ username: USER, password: 'a brand new password' }) });
  await browser.send({ type: 'refresh' });
  assert.equal(browser.badge.text, '!');
  assert.equal(browser.store.state.authFailed, true);
  assert.match(browser.badge.title, /Sign in again/);

  // Not connected at all: no badge, and the title says what to do.
  await chrome.storage.local.remove('token');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(browser.scripts.size, 0, 'disconnecting stops watching Feedster pages');
  await browser.send({ type: 'refresh' });
  assert.equal(browser.badge.text, '');
  assert.equal(browser.badge.title, 'Feedster: click to connect');
});

test('Feedster pages ask for a fresh count once changes settle', async () => {
  const sent = [];
  const page = new EventTarget();
  globalThis.window = page;
  globalThis.location = { href: `${SERVER}/` };
  globalThis.chrome = {
    storage: { local: { get: async () => ({ server: SERVER }) } },
    runtime: { sendMessage: async (m) => { sent.push(m); } },
  };
  try {
    await import(`../extension/feedster-page.js?${Date.now()}`);
    // Marking several articles read while scrolling
    for (let i = 0; i < 5; i++) page.dispatchEvent(new Event('feedster:changed'));
    await new Promise((r) => setTimeout(r, 1300));
    assert.deepEqual(sent, [{ type: 'refresh' }]);

    // Another site on the same host (a different sub-path) is ignored.
    globalThis.location = { href: 'http://127.0.0.1:1/other/' };
    page.dispatchEvent(new Event('feedster:changed'));
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(sent.length, 1);
  } finally {
    delete globalThis.window;
    delete globalThis.location;
  }
});

test("the extension's version matches the release (CI stamps it too)", () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.version, fs.readFileSync('VERSION', 'utf8').trim());
});
