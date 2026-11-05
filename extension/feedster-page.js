// Runs on the Feedster pages the extension is connected to. Feedster announces each change it
// makes (marking read, mark all as read, starring, new articles) with a "feedster:changed" event,
// and this asks the extension to check the count straight away instead of at the next timer.

const SETTLE_MS = 1000;
let timer = null;

window.addEventListener('feedster:changed', async () => {
  // Only the Feedster the extension is signed in to (the address may include a sub-path).
  const { server } = await chrome.storage.local.get('server');
  if (!server || !location.href.startsWith(server)) return;
  // Marking articles read while scrolling sends many changes; check once they settle.
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
    } catch { /* the extension was updated or removed; this page has a stale copy */ }
  }, SETTLE_MS);
});
