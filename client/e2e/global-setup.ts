import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { chromium, type FullConfig } from '@playwright/test';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../deploy/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const STORAGE_STATE_PATH = path.resolve(__dirname, '.auth/storageState.json');

export default async function globalSetup(config: FullConfig) {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set to run the e2e suite.\n' +
        'These are never hard-coded in this repo. You can set them in client/.env.local (recommended) ' +
        'or export them in your shell/CI secrets before running `npm run test:e2e`.\n' +
        'Example (in client/.env.local):\n' +
        '  E2E_TEST_EMAIL="your_email@example.com"\n' +
        '  E2E_TEST_PASSWORD="your_password"\n' +
        '  E2E_BASE_URL="http://localhost:3001" # (if using running Docker client)\n'
    );
  }

  const baseURL =
    config.projects[0]?.use?.baseURL ??
    (config as any).use?.baseURL ??
    process.env.E2E_BASE_URL ??
    'http://localhost:3100';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.locator('#auth_identifier, #identifier, input[type="email"]').first().fill(email);
  await page.locator('#auth_password, #password, input[type="password"]').first().fill(password);
  await page.locator('form[name="auth"] button[type="submit"], button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}
