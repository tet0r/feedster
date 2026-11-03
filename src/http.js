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
