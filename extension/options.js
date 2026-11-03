import { normalizeServer, originPattern, signIn } from './api.js';

const $ = (sel) => document.querySelector(sel);

function status(text, kind = '') {
  $('#status').textContent = text;
  $('#status').className = kind;
}

async function load() {
  const { server = '', username = '', token, interval = 5, state } = await chrome.storage.local.get(['server', 'username', 'token', 'interval', 'state']);
  $('#server').value = server;
  $('#username').value = username;
  $('#interval').value = String(interval);
  $('#disconnect').hidden = !token;
  $('#password').required = !token;
  if (token && state?.error) status(state.error, 'error');
  else if (token) status(`Connected as ${username}.${state && !state.error ? ` ${state.count ? `${state.count} unread.` : 'All caught up.'}` : ''}`, 'ok');
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  let server;
  try {
    server = normalizeServer($('#server').value);
  } catch (err) {
    status(err.message, 'error');
    return;
  }
  const username = $('#username').value.trim();
  const password = $('#password').value;
  const interval = Number($('#interval').value);
  // Browsers only allow asking for access straight from the click, before any other await.
  chrome.permissions.request({ origins: [originPattern(server)] }).then(async (granted) => {
    if (!granted) {
      status('The extension needs access to your Feedster address to check it.', 'error');
      return;
    }
    $('#connect').disabled = true;
    try {
      const stored = await chrome.storage.local.get(['server', 'username', 'token']);
      let token = stored.token;
      if (password || !token || stored.server !== server || stored.username !== username) {
        if (!password) throw new Error('Enter the app password to sign in.');
        status('Signing in…');
        token = await signIn(server, username, password);
      }
      await chrome.storage.local.set({ server, username, token, interval, state: null });
      $('#password').value = '';
      status('Connected. Checking…', 'ok');
      await chrome.runtime.sendMessage({ type: 'reschedule' });
      await load();
    } catch (err) {
      status(err.message, 'error');
    } finally {
      $('#connect').disabled = false;
    }
  });
});

$('#disconnect').addEventListener('click', async () => {
  const { server } = await chrome.storage.local.get('server');
  await chrome.storage.local.remove(['token', 'state']);
  if (server) await chrome.permissions.remove({ origins: [originPattern(server)] }).catch(() => {});
  await chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  $('#password').value = '';
  await load();
  status('Disconnected.');
});

load();
