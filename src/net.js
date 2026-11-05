import dns from 'node:dns/promises';
import net from 'node:net';

// Network helpers for fetching addresses that come from feeds, which are third-party content.

// Addresses that aren't the public internet. BlockList also matches IPv4 addresses written
// as IPv6 (::ffff:127.0.0.1, which URLs spell [::ffff:7f00:1]).
const PRIVATE = new net.BlockList();
for (const [range, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) PRIVATE.addSubnet(range, bits, 'ipv4');
for (const [range, bits] of [['::', 127], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(range, bits, 'ipv6');

export function isPrivateAddress(ip) {
  const family = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  if (!family) return true;
  const mapped = family === 'ipv6' && /^::ffff:/i.test(ip) && !net.isIPv4(ip.slice(7));
  if (mapped) {
    // ::ffff:7f00:1 → 127.0.0.1
    const [hi, lo] = ip.slice(7).split(':').map((h) => parseInt(h, 16));
    return isPrivateAddress([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  return PRIVATE.check(ip, family);
}

/** True for loopback, private and link-local addresses, and for names that resolve to one (or not at all). */
export async function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  try {
    return (await dns.lookup(host, { all: true })).some((a) => isPrivateAddress(a.address));
  } catch {
    return true; // unresolvable: don't try it
  }
}

const MAX_REDIRECTS = 5;

/**
 * fetch() for addresses that come from feeds. Redirects are followed one at a time so that each
 * hop gets the same checks: web addresses only, and no local-network hosts unless allowPrivate.
 * The response's url is the last hop, as with redirect: 'follow'.
 */
export async function fetchChecked(url, init, allowPrivate) {
  for (let hop = 0; ; hop++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('not a web address');
    if (!allowPrivate && await isPrivateHost(u.hostname)) throw new Error('the address is on a private network');
    const res = await fetch(u.href, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) return res;
    res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
    url = new URL(location, u).href;
  }
}

/** The start of a response body, without downloading the rest. */
export async function readHead(res, limit) {
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, limit);
}

/**
 * Whether a response is a bot check (Cloudflare's "Just a moment…" page and the like) or a rate
 * limit. Feed readers can't complete those; the right response is to back off, not retry harder.
 */
export function isBlocked(res) {
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  if (res.status === 429) return true;
  return (res.status === 403 || res.status === 503) && /cloudflare|ddos-guard|sucuri|akamai/i.test(res.headers.get('server') || '');
}

/** Retry-After as milliseconds (seconds or an HTTP date), or null. */
export function retryAfterMs(res) {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
