import { unreadSummary, badgeText, AuthError, originPattern } from './api.js';

// Checks Feedster on a timer, keeps the toolbar badge current, and saves the latest result
// so the popup can show it instantly.

const BLUE = '#1f6feb';
const GREY = '#868d96';

async function settings() {
  const { server, token, interval = 5 } = await chrome.storage.local.get(['server', 'token', 'interval']);
  return { server, token, interval };
}

async function show(state) {
  await chrome.storage.local.set({ state });
  if (state.error) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: GREY });
    await chrome.action.setTitle({ title: `Feedster: ${state.error}` });
    return;
  }
  await chrome.action.setBadgeText({ text: badgeText(state.count) });
  await chrome.action.setBadgeBackgroundColor({ color: BLUE });
  await chrome.action.setTitle({ title: state.count ? `Feedster: ${state.count} unread` : 'Feedster: all caught up' });
}

let running = null;

/** Fetch the unread count now. Overlapping calls share one request. */
async function refresh() {
  if (running) return running;
  running = (async () => {
    const { server, token } = await settings();
    if (!server || !token) {
      await chrome.storage.local.set({ state: { notConnected: true } });
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'Feedster: click to connect' });
      return;
    }
    try {
      const { count, items } = await unreadSummary(server, token);
      await show({ count, items, checkedAt: Date.now() });
    } catch (err) {
      await show({ error: err.message, authFailed: err instanceof AuthError, checkedAt: Date.now() });
    }
  })().finally(() => { running = null; });
  return running;
}

async function schedule() {
  const { interval } = await settings();
  await chrome.alarms.clear('refresh');
  await chrome.alarms.create('refresh', { periodInMinutes: Math.max(1, Number(interval) || 5) });
}

const PAGE_SCRIPT = 'feedster-page';

/**
 * Put feedster-page.js on the connected Feedster's pages, so changes made there update the badge
 * at once. It uses the same address pattern the person allowed when connecting.
 */
async function watchPages() {
  const { server, token } = await settings();
  await chrome.scripting.unregisterContentScripts({ ids: [PAGE_SCRIPT] }).catch(() => {});
  if (!server || !token) return;
  const origins = [originPattern(server)];
  if (!await chrome.permissions.contains({ origins })) return;
  await chrome.scripting.registerContentScripts([{ id: PAGE_SCRIPT, matches: origins, js: ['feedster-page.js'], runAt: 'document_idle' }]);
}

// Connecting, switching servers or disconnecting.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.server || changes.token)) watchPages().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') refresh();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await schedule();
  await watchPages().catch(console.error);
  await refresh();
  // First install: go straight to the setup page.
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  await watchPages().catch(console.error);
  await refresh();
});

// The popup asks for a fresh count when opened, the options page after connecting, and
// Feedster's own page (through feedster-page.js) after a change.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'refresh') {
    refresh().then(() => reply({ ok: true }));
    return true; // reply asynchronously
  }
  if (message?.type === 'reschedule') {
    schedule().then(refresh).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});
