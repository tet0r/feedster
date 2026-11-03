import dns from 'node:dns/promises';
import net from 'node:net';

// Network helpers for fetching addresses that come from feeds, which are third-party content.

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
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
