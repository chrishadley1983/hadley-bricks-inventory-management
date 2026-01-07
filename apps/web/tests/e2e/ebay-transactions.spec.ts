import { test, expect } from '@playwright/test';

/**
 * eBay Transactions Page Tests
 *
 * These tests require:
 * 1. Dev server running on localhost:3000
 * 2. User logged in (we'll use stored auth state)
 * 3. eBay connected with transactions synced
 */

test.describe('eBay Transactions Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to transactions page
    await page.goto('/transactions');
  });

  test('should load transactions page', async ({ page }) => {
    // Check page title
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  });

  test('should show Monzo and eBay tabs', async ({ page }) => {
    // Check tabs exist
    await expect(page.getByRole('tab', { name: 'Monzo' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'eBay' })).toBeVisible();
  });

  test('should switch to eBay tab and show transactions', async ({ page }) => {
    // Click eBay tab
    await page.getByRole('tab', { name: 'eBay' }).click();

    // Wait for the page to update
    await page.waitForTimeout(1000);

    // Check for eBay-specific elements
    await expect(page.getByText('Sales')).toBeVisible();
    await expect(page.getByText('Fees')).toBeVisible();
    await expect(page.getByText('Refunds')).toBeVisible();

    // Check for Sync button
    await expect(page.getByRole('button', { name: /Sync Transactions/i })).toBeVisible();
  });

  test('should fetch eBay transactions via API', async ({ page }) => {
    // Click eBay tab first
    await page.getByRole('tab', { name: 'eBay' }).click();

    // Wait for API call
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ebay/transactions') &&
        response.status() === 200
    );

    // Reload to trigger fresh fetch
    await page.reload();
    await page.getByRole('tab', { name: 'eBay' }).click();

    try {
      const response = await responsePromise;
      const data = await response.json();

      console.log('API Response:', JSON.stringify(data, null, 2).substring(0, 500));

      // Verify response structure
      expect(data).toHaveProperty('transactions');
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('total');
      expect(data).toHaveProperty('summary');
      expect(data.summary).toHaveProperty('totalSales');
      expect(data.summary).toHaveProperty('totalFees');
      expect(data.summary).toHaveProperty('totalRefunds');
      expect(data.summary).toHaveProperty('netRevenue');

      console.log(`Total transactions: ${data.pagination.total}`);
      console.log(`Returned transactions: ${data.transactions.length}`);
      console.log(`Summary - Sales: £${data.summary.totalSales.toFixed(2)}, Fees: £${data.summary.totalFees.toFixed(2)}, Refunds: £${data.summary.totalRefunds.toFixed(2)}`);
    } catch (error) {
      console.error('API call failed or timed out:', error);
      // Take screenshot for debugging
      await page.screenshot({ path: 'test-results/ebay-transactions-error.png' });
      throw error;
    }
  });

  test('should display transaction count in UI', async ({ page }) => {
    // Click eBay tab
    await page.getByRole('tab', { name: 'eBay' }).click();

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: 'test-results/ebay-transactions-page.png' });

    // Log the transactions count from UI
    const transactionsCard = page.locator('text=Transactions').first();
    const countElement = transactionsCard.locator('..').locator('.text-2xl');

    if (await countElement.isVisible()) {
      const count = await countElement.textContent();
      console.log(`UI shows transaction count: ${count}`);
    }
  });
});

// Test that runs without auth - just checks API response format
test.describe('eBay Transactions API (no auth)', () => {
  test('should return 401 without auth', async ({ request }) => {
    const response = await request.get('/api/ebay/transactions');
    expect(response.status()).toBe(401);
  });
});
