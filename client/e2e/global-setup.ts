import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const STORAGE_STATE_PATH = path.resolve(__dirname, '.auth/storageState.json');

export default async function globalSetup(config: FullConfig) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set to run the e2e suite. ' +
        'These are never hard-coded in this repo -- set them in your shell or CI secrets ' +
        'before running `npm run test:e2e`.'
    );
  }

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3001';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form[name="auth"] button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}
