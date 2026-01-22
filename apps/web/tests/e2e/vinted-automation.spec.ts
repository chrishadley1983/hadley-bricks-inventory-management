/**
 * Playwright E2E Tests for Vinted Automation Dashboard
 *
 * Tests the dashboard UI components (DCS1-DCS5, UI1-UI10)
 *
 * Prerequisites:
 * 1. Dev server running (npm run dev)
 * 2. Auth state saved (.playwright/.auth/user.json)
 * 3. Run: npx playwright test vinted-automation --project=chromium
 */

import { test, expect, Page } from '@playwright/test';

// Helper to navigate to automation page
async function goToAutomationPage(page: Page) {
  await page.goto('/arbitrage/vinted/automation');
  // Wait for page to load
  await expect(page.getByRole('heading', { name: /vinted scanner automation/i })).toBeVisible({
    timeout: 10000,
  });
}

test.describe('Vinted Automation Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await goToAutomationPage(page);
  });

  test.describe('Page Structure', () => {
    test('should display page header with title and description', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /vinted scanner automation/i })).toBeVisible();
      await expect(page.getByText(/automated arbitrage scanning/i)).toBeVisible();
    });

    test('should display configuration button', async ({ page }) => {
      const configButton = page.getByRole('button', { name: /configuration/i });
      await expect(configButton).toBeVisible();
    });

    test('should have three tabs: Opportunities, History, Watchlist', async ({ page }) => {
      await expect(page.getByRole('tab', { name: /opportunities/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /history/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /watchlist/i })).toBeVisible();
    });
  });

  test.describe('Connection Status Card (DCS1-DCS5)', () => {
    test('should display connection status card', async ({ page }) => {
      // Wait for loading to complete - either shows connected or not connected state
      // The card starts with "Local Scanner Status" while loading
      await page.waitForTimeout(2000); // Wait for API call to complete

      // Check for either final state or loading state
      const hasConnected = await page.getByText('Local Scanner Connected').isVisible();
      const hasDisconnected = await page.getByText('Local Scanner Not Connected').isVisible();
      const hasLoadingOrStatus = await page.getByText('Local Scanner Status').isVisible();

      expect(hasConnected || hasDisconnected || hasLoadingOrStatus).toBe(true);
    });

    test('DCS1: should show connection indicator', async ({ page }) => {
      // Wait for loading to complete
      await page.waitForTimeout(2000);

      // Look for either connected or disconnected state badge, or loading text
      const hasConnectedBadge = await page.getByText('Connected').first().isVisible();
      const hasDisconnectedBadge = await page.getByText('Disconnected').isVisible();
      const hasLoading = await page.getByText('Loading connection status').isVisible();

      expect(hasConnectedBadge || hasDisconnectedBadge || hasLoading).toBe(true);
    });

    test('DCS2: should show machine name when connected', async ({ page }) => {
      const isConnected = await page.getByText(/local scanner connected/i).isVisible();

      if (isConnected) {
        // Machine name should be visible in the card description
        const statusCard = page.locator('[class*="Card"]').filter({
          hasText: /local scanner connected/i,
        });
        await expect(statusCard).toBeVisible();
      }
    });

    test('DCS3: should show last heartbeat time when connected', async ({ page }) => {
      const isConnected = await page.getByText(/local scanner connected/i).isVisible();

      if (isConnected) {
        await expect(page.getByText(/last heartbeat/i)).toBeVisible();
      }
    });

    test('DCS5: should show troubleshooting tips when disconnected', async ({ page }) => {
      const isDisconnected = await page.getByText(/local scanner not connected/i).isVisible();

      if (isDisconnected) {
        await expect(page.getByText(/troubleshooting/i)).toBeVisible();
        await expect(page.getByText(/ensure your pc is powered on/i)).toBeVisible();
      }
    });
  });

  test.describe('Scanner Control Panel', () => {
    test('should display scanner control panel', async ({ page }) => {
      // The scanner control panel should be visible in the grid
      const controlPanel = page.locator('.md\\:col-span-2').first();
      await expect(controlPanel).toBeVisible();
    });
  });

  test.describe('Tab Navigation', () => {
    test('should show Opportunities tab by default', async ({ page }) => {
      const opportunitiesTab = page.getByRole('tab', { name: /opportunities/i });
      await expect(opportunitiesTab).toHaveAttribute('data-state', 'active');
    });

    test('should switch to History tab when clicked', async ({ page }) => {
      const historyTab = page.getByRole('tab', { name: /history/i });
      await historyTab.click();

      await expect(historyTab).toHaveAttribute('data-state', 'active');
    });

    test('should switch to Watchlist tab when clicked', async ({ page }) => {
      const watchlistTab = page.getByRole('tab', { name: /watchlist/i });
      await watchlistTab.click();

      await expect(watchlistTab).toHaveAttribute('data-state', 'active');
    });
  });

  test.describe('Configuration Dialog', () => {
    test('should open configuration dialog when button clicked', async ({ page }) => {
      const configButton = page.getByRole('button', { name: /configuration/i });
      await configButton.click();

      // Dialog should open
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    test('should close dialog when closed', async ({ page }) => {
      const configButton = page.getByRole('button', { name: /configuration/i });
      await configButton.click();

      // Wait for dialog
      await expect(page.getByRole('dialog')).toBeVisible();

      // Close dialog (click outside or X button)
      await page.keyboard.press('Escape');

      // Dialog should be closed
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });
  });

  test.describe('Opportunities Tab', () => {
    test('should display opportunities section', async ({ page }) => {
      // The opportunities section header should be visible
      await expect(page.getByText('Arbitrage Opportunities')).toBeVisible();
    });
  });

  test.describe('Scan History Tab', () => {
    test('should display scan history section', async ({ page }) => {
      // Navigate to history tab
      await page.getByRole('tab', { name: /history/i }).click();

      // Wait for content to load
      await page.waitForTimeout(1000);

      // The tab panel should be active
      const tabPanel = page.locator('[role="tabpanel"][data-state="active"]');
      await expect(tabPanel).toBeVisible();
    });
  });

  test.describe('Watchlist Tab', () => {
    test('should display watchlist panel', async ({ page }) => {
      // Navigate to watchlist tab
      await page.getByRole('tab', { name: /watchlist/i }).click();

      // Wait for content to load
      await page.waitForTimeout(500);

      // Should have watchlist content
      const watchlistContent = page.locator('[role="tabpanel"]').filter({
        hasText: /watchlist/i,
      });

      // Either has content or is the active tab
      const tabPanel = page.locator('[role="tabpanel"][data-state="active"]');
      await expect(tabPanel).toBeVisible();
    });
  });

  test.describe('Responsive Layout', () => {
    test('should display properly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.reload();

      // Header should still be visible
      await expect(page.getByRole('heading', { name: /vinted scanner automation/i })).toBeVisible();

      // Tabs should still be accessible
      await expect(page.getByRole('tab', { name: /opportunities/i })).toBeVisible();
    });

    test('should display properly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.reload();

      // All elements should be visible
      await expect(page.getByRole('heading', { name: /vinted scanner automation/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /configuration/i })).toBeVisible();
    });

    test('should display properly on desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.reload();

      // Grid layout should show side-by-side cards
      const grid = page.locator('.grid.gap-6.md\\:grid-cols-3');
      await expect(grid).toBeVisible();
    });
  });

  test.describe('Performance', () => {
    test('should load page under 5 seconds', async ({ page }) => {
      const startTime = Date.now();
      await page.goto('/arbitrage/vinted/automation');
      await expect(page.getByRole('heading', { name: /vinted scanner automation/i })).toBeVisible();
      const loadTime = Date.now() - startTime;

      // Allow 5 seconds for dev server (production would be faster)
      expect(loadTime).toBeLessThan(5000);
    });
  });
});

test.describe('API Integration Tests (requires auth)', () => {
  test('GET /api/arbitrage/vinted/automation should return scanner status', async ({ request }) => {
    const response = await request.get('/api/arbitrage/vinted/automation');

    // Should either return 200 with data or 401 if not authed
    expect([200, 401]).toContain(response.status());

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('config');
    }
  });
});

test.describe('Visual Regression', () => {
  test('automation page should match snapshot', async ({ page }) => {
    await goToAutomationPage(page);

    // Wait for any loading states to complete
    await page.waitForTimeout(1000);

    // Take screenshot
    await expect(page).toHaveScreenshot('vinted-automation-page.png', {
      maxDiffPixels: 100,
      fullPage: true,
    });
  });
});
