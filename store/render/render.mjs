// Renders the store listing images in store/images from the real extension pages.
//   node store/render/render.mjs
// Needs Chrome or Edge installed (set CHROME=/path/to/chrome to choose one).
// The popup and options pages get a stand-in browser API filled with made-up sample articles.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.join(root, 'store', 'images');

const minutes = (n) => Date.now() - n * 60_000;
const SAMPLE = {
  server: 'https://feeds.example.com',
  username: 'reader',
  token: 'reader/sample',
  interval: 5,
  state: {
    count: 24,
    checkedAt: Date.now(),
    items: [
      { title: 'City council approves new bike lanes along the waterfront', feed: 'Riverside Local', url: 'https://example.com/1', published: minutes(12) },
      { title: 'Ten small changes that make home Wi-Fi noticeably faster', feed: 'Tech Weekly', url: 'https://example.com/2', published: minutes(48) },
      { title: 'Rookie pitcher throws first career shutout in 3-0 win', feed: 'Ballpark Daily', url: 'https://example.com/3', published: minutes(95) },
      { title: 'One-pan lemon garlic chicken for busy weeknights', feed: 'Weeknight Kitchen', url: 'https://example.com/4', published: minutes(180) },
    ],
  },
};

const MOCK = `<script>
  const store = ${JSON.stringify(SAMPLE)};
  window.chrome = {
    storage: { local: {
      get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]])),
      set: async (o) => Object.assign(store, o), remove: async () => {},
    } },
    permissions: { request: async () => true, remove: async () => true },
    runtime: { sendMessage: async () => ({}), openOptionsPage() {} },
    tabs: { query: async () => [], create() {} }, windows: { update() {} },
  };
</script>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  // /ext/* is the extension itself; everything else is a layout page in this folder.
  const file = pathname.startsWith('/ext/')
    ? path.join(root, 'extension', pathname.slice(5))
    : path.join(here, pathname.slice(1));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    const isPage = pathname.startsWith('/ext/') && file.endsWith('.html');
    res.end(isPage ? data.toString().replace('<link rel="stylesheet"', `${MOCK}<link rel="stylesheet"`) : data);
  });
});

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('Chrome or Edge not found; set CHROME to its path');
  return found;
}

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = findChrome();
const shots = [
  ['screenshot-popup.png', 'screenshot-popup.html', 1280, 800],
  ['screenshot-setup.png', 'screenshot-setup.html', 1280, 800],
  ['promo-small.png', 'promo-small.html', 440, 280],
];
fs.mkdirSync(out, { recursive: true });
// A throwaway profile, so a Chrome that is already open doesn't take over the request.
const profile = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'feedster-render-'));
try {
  for (const [name, page, w, h] of shots) {
    // Not execFileSync: that would block this process, and with it the server Chrome is loading from.
    await promisify(execFile)(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
      // Light mode in every frame, whatever this computer is set to.
      '--force-prefers-color-scheme=light', '--blink-settings=preferredColorScheme=1', `--window-size=${w},${h}`, '--virtual-time-budget=3000',
      `--screenshot=${path.join(out, name)}`, `${base}/${page}`,
    ], { timeout: 60_000 });
    console.log(`wrote store/images/${name} (${w}x${h})`);
  }
} finally {
  server.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
