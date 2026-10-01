import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Feature smoke sweep: opens every page (and every Settings tab) as the e2e user and records
 * what went wrong — crashes, error screens, failed API calls (plan gates are 402/403) and
 * console errors. Appends one JSON line per page to test-results/smoke-report.jsonl for triage.
 */

const PAGES = [
  '/chat', '/feed', '/feed/saved', '/feed/publish', '/discover', '/dashboards', '/shared/dashboards',
  '/chart-designer', '/alerts', '/query-editor', '/sheets', '/notebooks', '/spatial',
  '/models', '/ai-decisions', '/data', '/knowledge', '/warehouse', '/pipelines', '/pipelines/new',
  '/catalog', '/semantic-layer', '/model', '/projects', '/ai-search',
  '/ai-analytics', '/support', '/feedback',
];

const SETTINGS_TABS = [
  'profile', 'notifications', 'security', 'general', 'project', 'organization', 'team', 'roles',
  'billing-subscription', 'identity', 'ai-residency', 'license', 'data-sources', 'integrations',
  'api-keys', 'embed', 'audit', 'agent-capabilities', 'kpi-definitions', 'ai-quality',
  'ai-decision-layer', 'ai-audit-log', 'briefings',
];

const ERROR_SCREEN = /Application error|Something went wrong|This page could not be found|Unhandled Runtime Error|404/i;
const PLAN_GATE = /upgrade|not included in your plan|available on (the )?(pro|team|business|enterprise)|plan limit|reached (your|the) .*limit|requires? (a|the) .*plan/i;
const IGNORED_URL = /\/_next\/|\.(png|svg|ico|woff2?|css|js|map)(\?|$)|sentry|telemetry|hot-update|\/sw\.js/;

type Finding = {
  route: string;
  finalUrl: string;
  errorScreen?: string;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: { method: string; url: string; status: number; body?: string }[];
  planGateText?: string;
};

const REPORT = path.resolve(__dirname, '../test-results/smoke-report.jsonl');

async function sweep(page: Page, route: string): Promise<Finding> {
  const f: Finding = { route, finalUrl: '', pageErrors: [], consoleErrors: [], failedRequests: [] };
  page.on('pageerror', (e) => f.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') f.consoleErrors.push(m.text().slice(0, 300));
  });
  const pending: Promise<void>[] = [];
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() < 400 || IGNORED_URL.test(url)) return;
    pending.push(
      r.text().then(
        (body) => { f.failedRequests.push({ method: r.request().method(), url, status: r.status(), body: body.slice(0, 300) }); },
        () => { f.failedRequests.push({ method: r.request().method(), url, status: r.status() }); },
      ),
    );
  });

  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await Promise.all(pending);

  f.finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
  const main = page.locator('main').first();
  const text = (await main.count()) ? await main.innerText().catch(() => '') : await page.locator('body').innerText();
  const err = text.match(ERROR_SCREEN);
  if (err) f.errorScreen = text.slice(Math.max(0, (err.index ?? 0) - 80), (err.index ?? 0) + 160).replace(/\s+/g, ' ');
  const gate = text.match(PLAN_GATE);
  if (gate) f.planGateText = text.slice(Math.max(0, (gate.index ?? 0) - 100), (gate.index ?? 0) + 160).replace(/\s+/g, ' ');
  return f;
}


for (const route of [...PAGES, ...SETTINGS_TABS.map((t) => `/settings?tab=${t}`)]) {
  test(`smoke ${route}`, async ({ page }) => {
    const f = await sweep(page, route);
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.appendFileSync(REPORT, JSON.stringify(f) + '\n');
    expect.soft(f.finalUrl.startsWith('/login'), 'session redirected to login').toBe(false);
    expect.soft(f.pageErrors, 'uncaught page errors').toEqual([]);
    expect.soft(f.errorScreen, 'error screen rendered').toBeUndefined();
    expect.soft(f.failedRequests.filter((r) => r.status >= 500), '5xx responses').toEqual([]);
  });
}
