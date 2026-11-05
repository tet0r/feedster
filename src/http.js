export function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

export async function readBody(req, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Query string and form-encoded body merged, for APIs that mix the two. */
export async function formParams(req, url) {
  const params = new URLSearchParams(url.search);
  if (req.method === 'POST') {
    const type = req.headers['content-type'] || '';
    const raw = await readBody(req);
    if (raw && !type.includes('json')) {
      for (const [k, v] of new URLSearchParams(raw)) params.append(k, v);
    }
  }
  return params;
}

// Sign-in attempts per client address. After too many wrong passwords that address waits, so
// passwords can't be guessed quickly. Behind a reverse proxy every client shares the proxy's address.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map();

const clientKey = (req) => req.socket.remoteAddress || '';

export function tooManyFailures(req) {
  const entry = failures.get(clientKey(req));
  if (!entry) return false;
  if (Date.now() - entry.since > FAILURE_WINDOW_MS) { failures.delete(clientKey(req)); return false; }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(req) {
  const key = clientKey(req);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.since > FAILURE_WINDOW_MS) failures.set(key, { count: 1, since: Date.now() });
  else entry.count++;
}

export const clearFailures = (req) => failures.delete(clientKey(req));
