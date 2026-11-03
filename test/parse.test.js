import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/feeds.js';

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>https://example.com/</link>${items}</channel></rss>`;

test('parses feeds with thousands of escaped entities', () => {
  const body = '&lt;p&gt;Tom &amp;amp; Jerry&lt;/p&gt;'.repeat(300);
  const items = Array.from({ length: 10 }, (_, i) => `<item><guid>${i}</guid><title>Item ${i}</title><description>${body}</description></item>`).join('');
  const feed = parseFeed(rss(items), 'https://example.com/feed');
  assert.equal(feed.items.length, 10);
  assert.ok(feed.items[0].content.startsWith('<p>Tom &amp; Jerry</p>'));
});

test('does not blow up on billion-laughs DOCTYPE entity bombs', () => {
  const defs = ['<!ENTITY a0 "lollollollollollollollollollol">'];
  for (let i = 1; i < 10; i++) defs.push(`<!ENTITY a${i} "${`&a${i - 1};`.repeat(10)}">`);
  const bomb = `<?xml version="1.0"?><!DOCTYPE rss [${defs.join('')}]><rss version="2.0"><channel><title>&a9;</title></channel></rss>`;
  // Either rejected outright or left unexpanded; never a huge string.
  let title = '';
  try { title = parseFeed(bomb, 'https://example.com/feed').title; } catch { /* rejected */ }
  assert.ok(title.length < 1000);
});
