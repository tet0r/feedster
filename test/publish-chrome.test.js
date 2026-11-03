import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Drives scripts/publish-chrome.mjs against a stand-in for Google's token endpoint and the
// Chrome Web Store API, checking the service-account sign-in and the upload/poll/publish order.

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const calls = [];
let server;
let base;
let zipPath;

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, size: body.length, type: req.headers['content-type'] });
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.url === '/token') {
      const assertion = new URLSearchParams(body.toString()).get('assertion');
      const [h, c, sig] = assertion.split('.');
      const valid = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig, 'base64url');
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!valid || claims.scope !== 'https://www.googleapis.com/auth/chromewebstore' || claims.iss !== 'ci@example.iam.gserviceaccount.com') return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: 'ya29.test', expires_in: 3600 });
    }
    if (req.headers.authorization !== 'Bearer ya29.test') return json(401, { error: 'unauthenticated' });
    if (req.url === '/upload/v2/publishers/pub-1/items/ext-1:upload') return json(200, { uploadState: 'IN_PROGRESS' });
    if (req.url === '/v2/publishers/pub-1/items/ext-1:fetchStatus') return json(200, { lastAsyncUploadState: 'SUCCEEDED' });
    if (req.url === '/v2/publishers/pub-1/items/ext-1:publish') return json(200, { state: 'PENDING_REVIEW' });
    json(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.CWS_API_BASE = base;
  zipPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cws-')), 'ext.zip');
  fs.writeFileSync(zipPath, Buffer.from('PK fake zip contents'));
});
after(() => server.close());

test('signs in as the service account, uploads, waits for processing, then publishes', async () => {
  const { publish } = await import('../scripts/publish-chrome.mjs');
  const serviceAccount = {
    client_email: 'ci@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: `${base}/token`,
  };
  const result = await publish({ zipPath, serviceAccount, publisherId: 'pub-1', extensionId: 'ext-1', pollMs: 1 });
  assert.deepEqual(result, { state: 'PENDING_REVIEW' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'POST /token',
    'POST /upload/v2/publishers/pub-1/items/ext-1:upload',
    'GET /v2/publishers/pub-1/items/ext-1:fetchStatus',
    'POST /v2/publishers/pub-1/items/ext-1:publish',
  ]);
  const upload = calls[1];
  assert.equal(upload.type, 'application/zip');
  assert.equal(upload.size, fs.statSync(zipPath).size, 'the whole zip is sent');
});
