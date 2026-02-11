import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '.playwright/.auth/user.json');
const authExists = fs.existsSync(authFile);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3005',
    trace: 'off',
    screenshot: 'on',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authExists ? authFile : undefined,
      },
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  // No webServer - use existing dev server on port 3000
});
