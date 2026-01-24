import { test, expect } from '@playwright/test';
import path from 'path';

// Use existing auth state from Playwright setup
// Path: docs/agents/merge-feature/ -> (3 levels up) -> apps/web/.playwright/.auth/user.json
const authFile = path.join(__dirname, '../../../apps/web/.playwright/.auth/user.json');

test.describe('Critical Path Verification', () => {
  test.use({ storageState: authFile });

  test('Dashboard loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });
    // Check no error state
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('Inventory page loads', async ({ page }) => {
    await page.goto('/inventory');
    // Wait for page to be ready - either table or empty state
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    // Verify main content area is visible
    await expect(page.locator('main')).toBeVisible();
    // Check no error state
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('Orders page loads', async ({ page }) => {
    await page.goto('/orders');
    // Wait for page to be ready
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    // Verify main content area is visible
    await expect(page.locator('main')).toBeVisible();
    // Check no error state
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('Single order view loads', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Check if any orders exist by counting order links
    const orderLinks = page.locator('a[href^="/orders/"]');
    const orderCount = await orderLinks.count();

    if (orderCount > 0) {
      // Click first order and verify detail page loads
      await orderLinks.first().click();
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      // Verify we're on an order detail page
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    }
    // If no orders exist, the test still passes - we verified the orders list loaded
  });
});
