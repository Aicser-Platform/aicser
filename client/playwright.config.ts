import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// Automatically load test environment variables from client env, deploy/.env, or root .env
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../deploy/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Normalize Docker internal hostnames to host port for host-level test execution
if (process.env.NEXT_PUBLIC_BACKEND_URL?.includes('chat2chart-server')) {
  process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:8001';
}
if (process.env.NEXT_PUBLIC_API_URL?.includes('chat2chart-server')) {
  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8001';
}
if (process.env.API_TARGET?.includes('chat2chart-server')) {
  process.env.API_TARGET = 'http://localhost:8001';
}

const PORT = 3100;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    storageState: './e2e/.auth/storageState.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_EDITION: 'enterprise',
          PORT: String(PORT),
          NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001',
          NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001',
          API_TARGET: process.env.API_TARGET || 'http://localhost:8001',
        },
      },
});
