import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { discover } from '../src/feeds.js';

// A local "website" with one route per discovery situation.
const FEED = '<?xml version="1.0"?><rss version="2.0"><channel><title>Found</title><item><guid>1</guid><title>One</title></item></channel></rss>';
const PAGES = {
  '/linked/': [200, 'text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/custom/feed-file"></head></html>'],
  '/custom/feed-file': [200, 'application/rss+xml', FEED],
  '/r/sub/': [200, 'text/html', '<html>no links here</html>'],
  '/r/sub/.rss': [200, 'application/atom+xml', FEED],
  '/blocked/': [403, 'text/html', 'Forbidden'],
  '/blocked/feed': [200, 'application/rss+xml', FEED],
  '/walled/': [403, 'text/html', 'Forbidden'],
  '/plain/': [200, 'text/html', '<html>nothing</html>'],
};
let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const [status, type, body] = PAGES[req.url] || [404, 'text/html', 'Not found'];
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('follows a <link rel="alternate"> on the page', async () => {
  assert.equal((await discover(`${base}/linked/`)).url, `${base}/custom/feed-file`);
});

test('tries feed paths relative to the page (reddit-style /.rss)', async () => {
  assert.equal((await discover(`${base}/r/sub/`)).url, `${base}/r/sub/.rss`);
});

test('keeps looking when the page itself refuses feed readers', async () => {
  assert.equal((await discover(`${base}/blocked/`)).url, `${base}/blocked/feed`);
});

test('explains when a site blocks readers and has no reachable feed', async () => {
  await assert.rejects(discover(`${base}/walled/`), /blocks feed readers \(HTTP 403\).*paste its address/);
});

test('explains when a site has no feed', async () => {
  await assert.rejects(discover(`${base}/plain/`), /No feed found on 127\.0\.0\.1.*paste its address/);
});
