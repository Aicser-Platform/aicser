// Node backend for the demo host app: signs embed links with @aicser/embed/server (npm).
// No framework, so the only dependency is the SDK under test.
import { createReadStream, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AicserSignError, signEmbedUrl } from '@aicser/embed/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(here, '..', 'web');
const SDK_DIR = path.dirname(fileURLToPath(import.meta.resolve('@aicser/embed')));
const SDK_VERSION = JSON.parse(readFileSync(path.join(SDK_DIR, '..', 'package.json'), 'utf8')).version;

const env = (name, fallback = '') => (process.env[name] || fallback).trim();
const list = (name) => env(name).split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(env('PORT', '4000'));
const config = {
  apiUrl: env('AICSER_API_URL', 'http://localhost:8001'),
  appUrl: env('AICSER_APP_URL', 'http://localhost:3001'),
  apiKey: env('AICSER_API_KEY'),
  dashboardId: env('AICSER_DASHBOARD_ID'),
  chartId: env('AICSER_CHART_ID'),
  assistantId: env('AICSER_ASSISTANT_ID'),
  chatToken: env('AICSER_CHAT_TOKEN'),
  lockedFilterField: env('LOCKED_FILTER_FIELD'),
  customers: list('CUSTOMERS').length ? list('CUSTOMERS') : ['acme'],
  allowedDomains: list('ALLOWED_DOMAINS'),
  download: env('DOWNLOAD', 'image'),
  expiresInMinutes: Number(env('EXPIRES_IN_MINUTES', '60')),
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serveFile(res, root, rel) {
  const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root + path.sep)) return send(res, 404, { error: 'Not found' });
  const stream = createReadStream(file);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    stream.pipe(res);
  });
  stream.on('error', () => send(res, 404, { error: 'Not found' }));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

/**
 * In your app this sits behind your own login: the customer (and so the locked filter) comes
 * from the signed-in user's session, never from the request body. The demo's picker stands in.
 */
async function embedToken(req, res) {
  const { scope = 'dashboard', customer } = await readJson(req);
  if (!config.customers.includes(customer)) return send(res, 403, { error: 'Unknown customer' });
  const resourceId = scope === 'chart' ? config.chartId : config.dashboardId;
  try {
    const { token, expiresAt } = await signEmbedUrl({
      baseUrl: config.apiUrl,
      apiKey: config.apiKey,
      scope,
      resourceId,
      lockedFilters: config.lockedFilterField ? [{ field: config.lockedFilterField, value: customer }] : [],
      expiresInMinutes: config.expiresInMinutes,
      allowedDomains: config.allowedDomains,
      download: config.download,
    });
    send(res, 200, { token, expiresAt });
  } catch (err) {
    const status = err instanceof AicserSignError ? err.status : 502;
    console.error(`sign failed (${status}): ${err.message}`);
    send(res, status, { error: err.message });
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && pathname === '/api/embed-token') return await embedToken(req, res);
    if (pathname === '/api/config') {
      return send(res, 200, {
        backend: 'Node.js',
        signer: `@aicser/embed/server ${SDK_VERSION} (npm)`,
        appUrl: config.appUrl,
        dashboardId: config.dashboardId,
        chartId: config.chartId,
        // A chat token is a public link (it ends up in the iframe URL), so it can go to the browser.
        assistantId: config.assistantId,
        chatToken: config.chatToken,
        customers: config.customers,
        lockedFilterField: config.lockedFilterField,
      });
    }
    // The browser SDK straight from node_modules: the exact npm build under test.
    if (pathname.startsWith('/sdk/')) return serveFile(res, SDK_DIR, pathname.slice('/sdk/'.length));
    return serveFile(res, WEB_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  if (!config.apiKey) console.warn('AICSER_API_KEY is not set — signing will fail.');
  console.log(`Node demo (@aicser/embed ${SDK_VERSION}) on http://localhost:${PORT}`);
});
