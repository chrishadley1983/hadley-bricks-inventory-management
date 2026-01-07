import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../../.playwright/.auth/user.json');

/**
 * This setup script logs in and saves the auth state.
 * Run manually once: npx playwright test auth.setup --project=chromium
 *
 * For this to work, you need to:
 * 1. Have the dev server running
 * 2. Enter your credentials when the browser opens
 * 3. The auth state will be saved for future test runs
 */
setup('authenticate', async ({ page }) => {
  // Go to login page
  await page.goto('/login');

  // Wait for user to manually log in (giving 2 minutes)
  console.log('\n========================================');
  console.log('Please log in manually in the browser.');
  console.log('You have 2 minutes to complete login.');
  console.log('========================================\n');

  // Wait for redirect to dashboard after login
  await page.waitForURL('**/dashboard**', { timeout: 120000 });

  // Verify we're logged in
  await expect(page.getByText('Sign out')).toBeVisible({ timeout: 10000 });

  // Save signed-in state
  await page.context().storageState({ path: authFile });
  console.log('\nAuth state saved to:', authFile);
});
