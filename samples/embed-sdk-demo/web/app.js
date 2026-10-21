// Browser side of the host app. The SDK (@aicser/embed, from npm) is served by whichever backend
// runs this page at /sdk/. Tokens come from that backend's /api/embed-token, which signs them with
// its SDK (Node: @aicser/embed/server, Python: aicser-embed); the API key never reaches the browser.
import { embedChart, embedChat, embedDashboard } from '/sdk/index.js';

const $ = (id) => document.getElementById(id);
let config;
let handle = null;
let tokensMinted = 0;

function log(text, kind = '') {
  const li = document.createElement('li');
  li.className = kind;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  li.append(time, text);
  $('log').prepend(li);
}

/** What the SDK calls for every new link: on mount, before expiry, and after a failed open. */
async function getToken() {
  const res = await fetch('/api/embed-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: $('scope').value, customer: $('customer').value }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Signing failed (${res.status})`);
  tokensMinted += 1;
  $('token-count').textContent = String(tokensMinted);
  $('token-info').textContent = `…${body.token.slice(-16)} · expires ${body.expiresAt || '?'}`;
  log(`getToken() → new signed link #${tokensMinted} (${config.signer})`, 'ok');
  return body.token;
}

function mount() {
  handle?.destroy();
  const scope = $('scope').value;
  const options = {
    baseUrl: config.appUrl,
    getToken,
    autoResize: true,
    style: { height: '480px' },
    onReady: (m) => log(`ready ${JSON.stringify(m.payload ?? {})}`, m.payload?.kind ? 'ok' : ''),
    onResize: (h) => log(`resize → ${h}px`),
    onFilterChange: (f) => log(`viewer changed filters ${JSON.stringify(f)}`),
    onError: (msg, code) => log(`error [${code ?? '-'}] ${msg}`, 'err'),
    onTokenExpired: () => log('token expired and could not be renewed', 'err'),
  };
  const container = $('embed');
  if (scope === 'chat') handle = mountChat(container, options);
  else if (scope === 'chart') handle = embedChart(container, config.chartId, options);
  else handle = embedDashboard(container, config.dashboardId, options);
  for (const type of ['token-expiring', 'token-expired', 'token-updated']) {
    handle.on(type, (payload) => log(`${type} ${JSON.stringify(payload ?? {})}`));
  }
  log(`mounted ${scope} for customer "${$('customer').value}"`);
}

/**
 * The assistant chat. It can't be signed per visitor (POST /api/embed/sign has no chat scope), so it
 * uses the chat token from Settings → Embed → Assistants → Get embed code, which every visitor shares.
 */
function mountChat(container, options) {
  const { getToken: _signed, ...rest } = options;
  const chat = embedChat(container, { ...rest, token: config.chatToken, assistantId: config.assistantId });
  // @aicser/embed 0.3.1 and older drop assistantId (0.3.2 adds it); without it the chat only works for people signed in to Aicser.
  const src = new URL(chat.iframe.src);
  if (!src.searchParams.has('assistant_id')) {
    src.searchParams.set('assistant_id', config.assistantId);
    chat.iframe.src = src.toString();
    log('this SDK version ignores assistantId, added assistant_id to the iframe URL');
  }
  return chat;
}

/** Runs a host command and logs what the embed answered (command-result). */
async function run(label, fn) {
  if (!handle) return log('Mount first', 'err');
  try {
    await fn(handle);
    log(`${label} ✓`, 'ok');
  } catch (err) {
    log(`${label} ✗ ${err.message}`, 'err');
  }
}

async function init() {
  config = await (await fetch('/api/config')).json();
  $('backend').innerHTML =
    `Server: <strong>${config.backend}</strong> · signing with <code>${config.signer}</code> · ` +
    `browser SDK <code>@aicser/embed</code> · Aicser at <code>${config.appUrl}</code>`;
  document.title = `Aicser embed demo (${config.backend})`;

  for (const c of config.customers) $('customer').add(new Option(c, c));
  if (config.dashboardId) $('scope').add(new Option(`Dashboard ${config.dashboardId.slice(0, 8)}…`, 'dashboard'));
  if (config.chartId) $('scope').add(new Option(`Chart ${config.chartId.slice(0, 8)}…`, 'chart'));
  if (config.assistantId && config.chatToken) $('scope').add(new Option('Assistant chat', 'chat'));
  if (!$('scope').options.length) {
    log('Set AICSER_DASHBOARD_ID, AICSER_CHART_ID or AICSER_ASSISTANT_ID + AICSER_CHAT_TOKEN in .env', 'err');
    return;
  }
  if (config.lockedFilterField) {
    log(`each customer is locked to ${config.lockedFilterField} = <customer> on the server`);
  }

  $('mount').onclick = mount;
  $('customer').onchange = () => handle && mount(); // a different login → a new signed link
  $('destroy').onclick = () => {
    handle?.destroy();
    handle = null;
    $('embed').innerHTML = '<p class="muted">Destroyed. Press Mount.</p>';
    log('destroy()');
  };
  $('refresh').onclick = () => run('refresh()', (h) => h.refresh());
  $('renew').onclick = () => run('setToken(getToken())', async (h) => h.setToken(await getToken()));
  $('export-png').onclick = () => run("exportImage('png')", (h) => h.exportImage('png'));
  $('export-pdf').onclick = () => run("exportImage('pdf')", (h) => h.exportImage('pdf'));
  $('set-filters').onclick = () =>
    run('setFilters()', (h) => h.setFilters(JSON.parse($('filters').value || '[]')));
  $('clear-filters').onclick = () => run('setFilters([])', (h) => h.setFilters([]));
  $('set-page').onclick = () => run('setPage()', (h) => h.setPage($('page-id').value.trim()));
  $('clear-log').onclick = () => ($('log').innerHTML = '');
}

init().catch((err) => log(`init failed: ${err.message}`, 'err'));
