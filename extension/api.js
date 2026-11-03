// Talks to Feedster through its Google Reader API (the one reading apps use), signing in with
// the username and app password from Feedster's Settings -> Reading apps.

export class AuthError extends Error {}

const READING_LIST = 'user/-/state/com.google/reading-list';
const READ = 'user/-/state/com.google/read';

/** "feeds.example.com/" -> "https://feeds.example.com"; keeps a sub-path such as /feedster. */
export function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter your Feedster address');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** The match pattern to ask the browser for access to, e.g. "https://feeds.example.com/*". */
export function originPattern(server) {
  return `${new URL(server).origin}/*`;
}

async function call(server, path, { token, form, timeoutMs = 15_000 } = {}) {
  let res;
  try {
    res = await fetch(`${server}/api/greader.php${path}`, {
      method: form ? 'POST' : 'GET',
      headers: {
        ...(token && { Authorization: `GoogleLogin auth=${token}` }),
        ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? "Feedster didn't respond" : "Can't reach Feedster at that address");
  }
  if (res.status === 401) throw new AuthError('Feedster no longer accepts the saved sign-in. Sign in again in the extension options.');
  if (!res.ok) throw new Error(`Feedster returned HTTP ${res.status}`);
  return res;
}

/** Sign in and return the token to keep (the password itself is not stored). */
export async function signIn(server, username, password) {
  let res;
  try {
    res = await call(server, '/accounts/ClientLogin', { form: { Email: username, Passwd: password } });
  } catch (err) {
    if (err instanceof AuthError) {
      throw new AuthError('Wrong username or app password. Check Settings -> Reading apps in Feedster.');
    }
    throw err;
  }
  const token = (await res.text()).match(/^Auth=(.+)$/m)?.[1]?.trim();
  if (!token) throw new Error("That address doesn't look like Feedster");
  return token;
}

/** Unread count and the newest unread articles. */
export async function unreadSummary(server, token, { recent = 8 } = {}) {
  const [counts, stream] = await Promise.all([
    call(server, '/reader/api/0/unread-count?output=json', { token }).then((r) => r.json()),
    call(server, `/reader/api/0/stream/contents/${READING_LIST}?output=json&n=${recent}&xt=${encodeURIComponent(READ)}`, { token }).then((r) => r.json()),
  ]);
  const count = counts.unreadcounts?.find((c) => c.id === READING_LIST)?.count ?? 0;
  const items = (stream.items || []).map((i) => ({
    title: i.title || '(untitled)',
    feed: i.origin?.title || '',
    url: i.alternate?.[0]?.href || i.canonical?.[0]?.href || '',
    published: (i.published || 0) * 1000,
  }));
  return { count, items };
}

export function badgeText(count) {
  if (!count) return '';
  return count > 999 ? '999+' : String(count);
}
