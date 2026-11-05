const $ = (sel) => document.querySelector(sel);

function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Build an element; props may include className, textContent and data-* keys. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('data-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

/** A message with one action button, shown instead of the article list. */
function message(text, { kind = '', button, act }) {
  $('#message').replaceChildren(
    el('p', { className: kind, textContent: text }),
    el('button', { className: `btn${act === 'settings' && !kind ? ' primary' : ''}`, textContent: button, 'data-act': act }),
  );
  $('#message').hidden = false;
  $('#list').replaceChildren();
}

function render(state, server) {
  $('#message').hidden = true;
  $('#open').hidden = !server;
  if (!server || state?.notConnected) {
    $('#count').textContent = '';
    message('Connect the extension to your Feedster to see your unread count here.', { button: 'Connect to Feedster', act: 'settings' });
    return;
  }
  if (!state) {
    $('#count').textContent = 'Checking…';
    return;
  }
  if (state.error) {
    $('#count').textContent = '';
    message(state.error, state.authFailed
      ? { kind: 'error', button: 'Sign in again', act: 'settings' }
      : { kind: 'error', button: 'Try again', act: 'refresh' });
    return;
  }
  $('#count').replaceChildren(...(state.count
    ? [el('b', { textContent: state.count.toLocaleString() }), ' unread']
    : ['All caught up']));
  const list = $('#list');
  list.replaceChildren(...(state.items || []).map((item) => el('button', {
    className: 'item',
    title: item.url ? `Open “${item.title}”` : item.title,
    'data-url': item.url,
  }, [
    el('div', { className: 't', textContent: item.title }),
    el('div', { className: 'm', textContent: [item.feed, item.published ? timeAgo(item.published) : ''].filter(Boolean).join(' · ') }),
  ])));
}

async function load() {
  const { server, state } = await chrome.storage.local.get(['server', 'state']);
  render(state, server);
  return server;
}

/** Switch to a Feedster tab that is already open, or open one. */
async function openFeedster() {
  const { server } = await chrome.storage.local.get('server');
  if (!server) return;
  const tabs = await chrome.tabs.query({ url: `${new URL(server).origin}/*` }).catch(() => []);
  const tab = tabs.find((t) => t.url?.startsWith(server));
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: `${server}/` });
  }
  window.close();
}

async function refresh() {
  $('#refresh').disabled = true;
  await chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  await load();
  $('#refresh').disabled = false;
}

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'settings') { chrome.runtime.openOptionsPage(); window.close(); }
  if (act === 'refresh') refresh();
  const item = e.target.closest('.item');
  if (/^https?:\/\//i.test(item?.dataset.url || '')) { chrome.tabs.create({ url: item.dataset.url }); window.close(); }
});
$('#open').addEventListener('click', openFeedster);
$('#refresh').addEventListener('click', refresh);
$('#settings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

// Show the last known count at once, then check for a fresh one.
load().then((server) => { if (server) refresh(); });
