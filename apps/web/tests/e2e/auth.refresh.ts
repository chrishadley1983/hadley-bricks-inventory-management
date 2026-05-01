/**
 * Programmatic E2E auth refresh.
 *
 * Generates a Supabase magic link via the admin API, then drives a real browser
 * through the action_link → /api/auth/callback → /dashboard flow so the proper
 * SSR cookies are set, then dumps the storage state for the chromium project.
 *
 * Usage: E2E_BASE_URL=http://localhost:3002 npx playwright test auth.refresh --project=setup
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   E2E_USER_EMAIL (defaults to chrishadley1983@gmail.com)
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../../.playwright/.auth/user.json');
const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? 'chris@hadleybricks.co.uk';

setup('refresh auth via dev-signin route', async ({ page }) => {
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  await page.goto(`${baseUrl}/api/auth/dev-signin?email=${encodeURIComponent(TEST_EMAIL)}`);
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  await expect(page.getByText('Sign out').first()).toBeVisible({ timeout: 15000 });
  await page.context().storageState({ path: authFile });
  console.log('[e2e-auth] saved storage state to', authFile);
});
