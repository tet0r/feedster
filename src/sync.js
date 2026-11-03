import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

// Credentials that reading apps use with the Google Reader and Fever APIs.
// Separate from the web sign-in so a phone app never holds that password.

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function syncStatus() {
  return { username: getSetting('sync_user') || '', enabled: Boolean(getSetting('sync_hash')) };
}

export function setSyncCredentials(username, password) {
  if (!username || !password) {
    for (const k of ['sync_user', 'sync_hash', 'sync_token', 'fever_key']) setSetting(k, null);
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('sync_user', username);
  setSetting('sync_hash', `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`);
  // A new password signs every app out.
  setSetting('sync_token', `${username}/${crypto.randomBytes(20).toString('hex')}`);
  // Fever clients send md5("username:password") and nothing else, so that is what is stored for them.
  setSetting('fever_key', crypto.createHash('md5').update(`${username}:${password}`).digest('hex'));
}

/** Returns the session token for valid credentials, otherwise null. */
export function login(username, password) {
  const stored = getSetting('sync_hash');
  if (!stored || !username || !password || !safeEqual(username, getSetting('sync_user'))) return null;
  const [salt, hash] = stored.split(':');
  return safeEqual(crypto.scryptSync(password, salt, 32).toString('hex'), hash) ? getSetting('sync_token') : null;
}

export function checkToken(token) {
  const stored = getSetting('sync_token');
  return Boolean(stored && token && safeEqual(token, stored));
}

export function checkFeverKey(key) {
  const stored = getSetting('fever_key');
  return Boolean(stored && key && safeEqual(String(key).toLowerCase(), stored));
}
