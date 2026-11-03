import { unreadSummary, badgeText, AuthError } from './api.js';

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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') refresh();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await schedule();
  await refresh();
  // First install: go straight to the setup page.
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  await refresh();
});

// The popup asks for a fresh count when opened; the options page after connecting.
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
