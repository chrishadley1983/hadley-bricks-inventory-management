import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '.playwright/.auth/user.json');
const authExists = fs.existsSync(authFile);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'on',
    headless: true, // Run headless by default
  },
  projects: [
    // Main tests with existing auth (skip setup if auth file exists)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authExists ? authFile : undefined,
      },
      testIgnore: /auth\.setup\.ts/,
    },
    // Setup project - only run manually when needed
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        headless: false, // Auth setup needs headed browser
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
