import { describe, expect, it, vi } from 'vitest';
import { embedDashboard, embedReport } from '../src/index';
import { AicserSignError, signEmbedUrl } from '../src/server';

const BASE = 'https://app.aicser.test';

function fromEmbed(iframe: HTMLIFrameElement, type: string, payload?: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { source: 'aicser-embed', type, payload },
      origin: BASE,
      source: iframe.contentWindow,
    }),
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('@aicser/embed', () => {
  it('loads the link token and ignores messages from other frames', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onError = vi.fn();
    const h = embedDashboard(el, 'd1', { baseUrl: BASE, token: 'tok', onError });
    expect(h.iframe.src).toBe(`${BASE}/embed/dashboard/d1?token=tok`);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'aicser-embed', type: 'error', payload: { message: 'x' } },
        origin: BASE,
        source: window,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
    h.destroy();
  });

  it('asks the host for a fresh token before the session runs out', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const getToken = vi.fn().mockResolvedValue('fresh');
    const h = embedDashboard(el, 'd1', { baseUrl: BASE, token: 'tok', getToken });
    const post = vi.spyOn(h.iframe.contentWindow!, 'postMessage');
    fromEmbed(h.iframe, 'token-expiring', {});
    await flush();
    expect(getToken).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith({ source: 'aicser-host', type: 'set-token', payload: { token: 'fresh' } }, BASE);
    h.destroy();
  });

  it('reloads with a new link when a single-use link was already opened', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const getToken = vi.fn().mockResolvedValue('second');
    const h = embedDashboard(el, 'd1', { baseUrl: BASE, token: 'first', getToken });
    fromEmbed(h.iframe, 'token-expired', { reason: 'open_failed' });
    await flush();
    expect(h.iframe.src).toContain('token=second');
    h.destroy();
  });

  it('calls onTokenExpired without getToken', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onTokenExpired = vi.fn();
    const h = embedDashboard(el, 'd1', { baseUrl: BASE, token: 'tok', onTokenExpired });
    fromEmbed(h.iframe, 'token-expired', {});
    await flush();
    expect(onTokenExpired).toHaveBeenCalledOnce();
    h.destroy();
  });

  it('queues commands until the content is ready and resolves on confirmation', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = embedDashboard(el, 'd1', { baseUrl: BASE, token: 'tok' });
    const post = vi.spyOn(h.iframe.contentWindow!, 'postMessage');
    const done = h.setFilters([{ field: 'region', operator: 'equals', value: 'EU' }]);
    fromEmbed(h.iframe, 'ready', { route: '/embed' });
    expect(post).not.toHaveBeenCalled();
    fromEmbed(h.iframe, 'ready', { kind: 'dashboard' });
    expect(post).toHaveBeenCalledWith(
      { source: 'aicser-host', type: 'set-filters', payload: { filters: [{ field: 'region', operator: 'equals', value: 'EU' }] } },
      BASE,
    );
    fromEmbed(h.iframe, 'command-result', { command: 'set-filters', ok: true });
    await expect(done).resolves.toBeUndefined();

    const refused = h.exportImage('pdf');
    fromEmbed(h.iframe, 'command-result', { command: 'export', ok: false, error: 'Downloads are turned off for this embed' });
    await expect(refused).rejects.toThrow('Downloads are turned off');
    h.destroy();
  });

  it('fetches the first token when only getToken is given', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = embedDashboard(el, 'd1', { baseUrl: BASE, getToken: async () => 'minted' });
    await flush();
    expect(h.iframe.src).toContain('token=minted');
    h.destroy();
  });

  it('loads a report embed by conversationId:messageId', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const h = embedReport(el, 'conv-1:msg-1', { baseUrl: BASE, token: 'tok' });
    expect(h.iframe.src).toBe(`${BASE}/embed/report/conv-1%3Amsg-1?token=tok`);
    h.destroy();
  });
});

describe('@aicser/embed/server', () => {
  it('signs a dashboard with the default scope', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://app/embed/dashboard/d?token=t', token: 't', expires_at: 'soon' }),
    });
    const signed = await signEmbedUrl({
      baseUrl: 'https://api.example.com/',
      apiKey: 'aiser_sk_test',
      dashboardId: 'd',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(signed.token).toBe('t');
    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      resource_id: 'd',
      scope: 'dashboard',
    });
  });

  it('signs a report when scope and resourceId are set', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://app/embed/report/c:m?token=t',
        token: 't',
        expires_at: 'soon',
      }),
    });
    await signEmbedUrl({
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      scope: 'report',
      resourceId: 'c:m',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      resource_id: 'c:m',
      scope: 'report',
    });
  });

  it('rejects when neither resourceId nor dashboardId is given', async () => {
    await expect(signEmbedUrl({ baseUrl: 'https://api', apiKey: 'k' })).rejects.toBeInstanceOf(
      AicserSignError,
    );
  });
});
