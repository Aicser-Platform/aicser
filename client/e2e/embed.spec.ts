import path from 'path';
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Embedded analytics, end to end (docs/embed-and-sdk-guide.md):
 *   public link  — Settings → Embed token, opened as-is, reusable
 *   signed link  — minted by a host backend with an API key (POST /api/embed/sign), opened
 *                  inside a host page's iframe, exchanged once for an in-memory session
 *   allowed sites — the session exchange refuses other sites; the page's frame-ancestors CSP
 *                  makes the browser refuse to frame it there
 *   host bridge  — postMessage protocol the @aicser/embed SDK speaks (ready, commands)
 *
 * The viewer runs with no sign-in cookies, like an anonymous visitor on a customer's site.
 * Locked-filter SQL rewriting is covered by server/tests/modules/embed (no data source needed).
 */

const STORAGE_STATE = path.resolve(__dirname, '.auth/storageState.json');
// https: the embed's frame-ancestors only lists https:// sites.
const HOST_ORIGIN = 'https://host.localhost';
const OTHER_ORIGIN = 'https://other.localhost';
const DASHBOARD_TITLE = `E2E embed ${Date.now()}`;
// The embed hides the dashboard header (title, logo); the viewer root is what renders.
const VIEWER = '#dashboard-viewer-root';

let api: APIRequestContext;
let baseURL: string;
let dashboardId = '';
let apiKeyId = '';
let apiKey = '';
const skipReasons: string[] = [];

type HostMessage = { source?: string; type?: string; payload?: Record<string, unknown> };

/** The embed's link token (Settings → Embed). */
async function createLinkToken(body: Record<string, unknown>): Promise<{ id: string; token: string; url: string }> {
  const res = await api.post('/api/embed/tokens', {
    data: { name: 'e2e embed', scopes: ['dashboard'], resource_id: dashboardId, ...body },
  });
  expect(res.status(), await res.text()).toBe(200);
  const json = await res.json();
  return { id: json.id, token: json.token, url: embedPath(json.token) };
}

/** What a host app's backend does per page view: sign with its API key, no Aicser sign-in. */
async function signEmbed(body: Record<string, unknown> = {}): Promise<{ token: string; url: string }> {
  const hostBackend = await playwrightRequest.newContext({ baseURL });
  try {
    const res = await hostBackend.post('/api/embed/sign', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: { resource_id: dashboardId, scope: 'dashboard', expires_in_minutes: 5, ...body },
    });
    expect(res.status(), await res.text()).toBe(200);
    const json = await res.json();
    expect(json.single_use).toBe(true);
    return { token: json.token, url: embedPath(json.token) };
  } finally {
    await hostBackend.dispose();
  }
}

function embedPath(token: string): string {
  return `/embed/dashboard/${dashboardId}?token=${encodeURIComponent(token)}`;
}

/**
 * Serves a stand-in for the customer's site at `origin` that frames the embed and records
 * every message the embed posts to it (window.__embedMessages).
 */
async function openHostPage(page: Page, origin: string, embedUrl: string): Promise<void> {
  const src = new URL(embedUrl, baseURL).toString();
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <iframe id="aicser" src="${src}" style="width:1200px;height:800px;border:0"></iframe>
        <script>
          window.__embedMessages = [];
          window.addEventListener('message', (e) => {
            if (e.data && e.data.source === 'aicser-embed') window.__embedMessages.push(e.data);
          });
          window.sendToEmbed = (type, payload) =>
            document.getElementById('aicser').contentWindow.postMessage({ source: 'aicser-host', type, payload }, '*');
        </script>
      </body></html>`,
    }),
  );
  await page.goto(`${origin}/`);
}

async function waitForMessage(page: Page, match: (m: HostMessage) => boolean, timeout = 30_000): Promise<HostMessage> {
  const handle = await page.waitForFunction(
    (fn) => {
      const msgs = (window as unknown as { __embedMessages: HostMessage[] }).__embedMessages || [];
      // eslint-disable-next-line no-new-func
      return msgs.find(new Function('m', `return (${fn})(m)`) as (m: HostMessage) => boolean) || null;
    },
    match.toString(),
    { timeout },
  );
  return (await handle.jsonValue()) as HostMessage;
}

// The embed layout posts its own `ready` ({ route }) first; the dashboard's comes once it has loaded.
const isDashboardReady = (m: HostMessage) => m.type === 'ready' && m.payload?.kind === 'dashboard';

test.use({
  storageState: { cookies: [], origins: [] },
  // The stand-in host sites are routed, not served, so Chrome counts them as public and refuses to
  // frame localhost (Local Network Access). Real host sites and Aicser are both public.
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
});

test.describe('Embedded dashboards', () => {
  test.beforeAll(async ({}, testInfo) => {
    baseURL = String(testInfo.project.use.baseURL);
    api = await playwrightRequest.newContext({ baseURL, storageState: STORAGE_STATE });

    const dash = await api.post('/api/dashboards/', { data: { title: DASHBOARD_TITLE } });
    expect(dash.status(), await dash.text()).toBe(201);
    dashboardId = String((await dash.json()).id);

    // Plan gates: embedding is Pro+, API keys need api_access. Skip rather than fail on a Free org.
    const probe = await api.post('/api/embed/tokens', {
      data: { name: 'e2e probe', scopes: ['dashboard'], resource_id: dashboardId },
    });
    if (probe.status() === 402) skipReasons.push('embed_analytics not in this org plan');
    else if (probe.ok()) await api.delete(`/api/embed/tokens/${(await probe.json()).id}`);

    const key = await api.post('/api/users/api-keys', { data: { name: 'e2e embed signer' } });
    if (key.ok()) {
      const json = await key.json();
      apiKeyId = String(json.id);
      apiKey = String(json.key || json.api_key || json.token || '');
    }
  });

  test.afterAll(async () => {
    if (apiKeyId) await api.delete(`/api/users/api-keys/${apiKeyId}`);
    if (dashboardId) await api.delete(`/api/dashboards/${dashboardId}?purge=true`);
    await api.dispose();
  });

  test.beforeEach(() => {
    test.skip(skipReasons.length > 0, skipReasons.join('; '));
  });

  test('public link opens on its own and can be reopened', async ({ page }) => {
    const { url } = await createLinkToken({});
    await page.goto(url);
    await expect(page.locator(VIEWER)).toBeVisible({ timeout: 30_000 });
    // Not single-use: the link stays in the address bar and works again.
    expect(new URL(page.url()).searchParams.get('token')).toBeTruthy();
    await page.reload();
    await expect(page.locator(VIEWER)).toBeVisible({ timeout: 30_000 });
  });

  test('revoked link no longer opens', async ({ page }) => {
    const { id, url } = await createLinkToken({});
    const revoked = await api.delete(`/api/embed/tokens/${id}`);
    expect(revoked.ok(), await revoked.text()).toBe(true);
    await page.goto(url);
    await expect(page.getByText('This embed link was turned off by its owner.')).toBeVisible({ timeout: 30_000 });
  });

  test.describe('signed link (host backend + iframe)', () => {
    test.beforeEach(() => {
      test.skip(!apiKey, 'could not create an API key (api_access plan feature?)');
    });

    test('renders in the host iframe, posts ready, and drops the link from its URL', async ({ page }) => {
      const { url } = await signEmbed();
      await openHostPage(page, HOST_ORIGIN, url);
      const frame = page.frameLocator('#aicser');
      await expect(frame.locator(VIEWER)).toBeVisible({ timeout: 30_000 });

      const ready = await waitForMessage(page, isDashboardReady);
      expect(ready.payload).toMatchObject({ dashboardId, download: 'none' });

      const embedFrame = page.frames().find((f) => f.url().includes(`/embed/dashboard/${dashboardId}`));
      expect(embedFrame, 'embed frame').toBeTruthy();
      expect(new URL(embedFrame!.url()).searchParams.get('token')).toBeNull();
    });

    test('opens only once: a copied link is refused', async ({ page, browser }) => {
      const { url } = await signEmbed();
      await openHostPage(page, HOST_ORIGIN, url);
      await expect(page.frameLocator('#aicser').locator(VIEWER)).toBeVisible({
        timeout: 30_000,
      });

      const other = await browser.newPage({ storageState: { cookies: [], origins: [] } });
      try {
        await openHostPage(other, HOST_ORIGIN, url);
        await expect(other.frameLocator('#aicser').getByText(/already opened/)).toBeVisible({ timeout: 30_000 });
        const err = await waitForMessage(other, (m) => m.type === 'error');
        expect(err.payload).toMatchObject({ code: 'session_failed' });
        // The SDK's getToken() answers this by minting a fresh link.
        await waitForMessage(other, (m) => m.type === 'token-expired');
      } finally {
        await other.close();
      }
    });

    test('answers host commands over postMessage', async ({ page }) => {
      const { url } = await signEmbed();
      await openHostPage(page, HOST_ORIGIN, url);
      await waitForMessage(page, isDashboardReady);

      await page.evaluate(() => (window as unknown as { sendToEmbed: (t: string) => void }).sendToEmbed('refresh'));
      const refreshed = await waitForMessage(page, (m) => m.type === 'command-result' && m.payload?.command === 'refresh');
      expect(refreshed.payload).toMatchObject({ ok: true });

      // download: 'none' — exports are refused inside the embed, not just hidden.
      await page.evaluate(() =>
        (window as unknown as { sendToEmbed: (t: string, p: unknown) => void }).sendToEmbed('export', { format: 'png' }),
      );
      const exported = await waitForMessage(page, (m) => m.type === 'command-result' && m.payload?.command === 'export');
      expect(exported.payload).toMatchObject({ ok: false, error: 'Downloads are turned off for this embed' });

      await page.evaluate(() =>
        (window as unknown as { sendToEmbed: (t: string, p: unknown) => void }).sendToEmbed('set-page', { pageId: 'nope' }),
      );
      const paged = await waitForMessage(page, (m) => m.type === 'command-result' && m.payload?.command === 'set-page');
      expect(paged.payload).toMatchObject({ ok: false, error: 'No page with that id' });
    });

    test('allowed domains: shows on that site only', async ({ page, browser }) => {
      const allowed = { allowed_domains: ['host.localhost'] };

      // The page tells browsers which sites may frame it.
      const { token: headerToken } = await signEmbed(allowed);
      const direct = await page.request.get(embedPath(headerToken));
      expect(direct.headers()['content-security-policy']).toContain('frame-ancestors');
      expect(direct.headers()['content-security-policy']).toContain('host.localhost');

      const { url } = await signEmbed(allowed);
      await openHostPage(page, HOST_ORIGIN, url);
      await expect(page.frameLocator('#aicser').locator(VIEWER)).toBeVisible({
        timeout: 30_000,
      });

      // Opened on its own (no parent site) — refused by the session exchange.
      const { url: standaloneUrl } = await signEmbed(allowed);
      const standalone = await browser.newPage({ storageState: { cookies: [], origins: [] } });
      try {
        await standalone.goto(standaloneUrl);
        await expect(standalone.getByText('This embed only opens inside the website it was made for.')).toBeVisible({
          timeout: 30_000,
        });
      } finally {
        await standalone.close();
      }

      // Framed by another site — the browser refuses to render it (frame-ancestors).
      const { url: otherUrl } = await signEmbed(allowed);
      const other = await browser.newPage({ storageState: { cookies: [], origins: [] } });
      try {
        await openHostPage(other, OTHER_ORIGIN, otherUrl);
        await other.waitForTimeout(5_000);
        await expect(other.frameLocator('#aicser').locator(VIEWER)).toHaveCount(0);
        const msgs = await other.evaluate(() => (window as unknown as { __embedMessages: HostMessage[] }).__embedMessages);
        expect(msgs.some(isDashboardReady)).toBe(false);
      } finally {
        await other.close();
      }
    });

    test('rejects a request without a valid API key', async () => {
      const hostBackend = await playwrightRequest.newContext({ baseURL });
      try {
        const res = await hostBackend.post('/api/embed/sign', {
          headers: { Authorization: 'Bearer aiser_sk_not_a_real_key' },
          data: { resource_id: dashboardId },
        });
        expect(res.status()).toBe(401);
      } finally {
        await hostBackend.dispose();
      }
    });
  });
});
