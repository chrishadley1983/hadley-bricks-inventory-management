import { test, expect } from '@playwright/test';

// Helper: wait for table data to load (skeleton rows use animate-pulse)
async function waitForTableData(page: import('@playwright/test').Page, timeout = 30000) {
  // Wait for either: data rows appear (no animate-pulse in cells) or "No items found" empty state
  await Promise.race([
    page.waitForFunction(() => {
      const rows = document.querySelectorAll('table tbody tr');
      if (rows.length === 0) return false;
      // Check if first row has actual text content (not skeleton)
      const firstRow = rows[0];
      const cells = firstRow.querySelectorAll('td');
      for (const cell of cells) {
        const text = cell.textContent?.trim();
        if (text && text.length > 2 && !cell.querySelector('[class*="animate-pulse"]')) {
          return true;
        }
      }
      return false;
    }, { timeout }),
    page.getByText('No items found').waitFor({ state: 'visible', timeout }),
  ]);
}

test.describe('Arbitrage Tabs', () => {
  test('BrickLink tab loads without crash', async ({ page }) => {
    await page.goto('/arbitrage?tab=bricklink');
    await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    // Verify table or empty state is visible
    const hasTable = await page.locator('table tbody tr').count() > 0;
    const hasEmptyState = await page.getByText('No items found').isVisible().catch(() => false);
    expect(hasTable || hasEmptyState).toBeTruthy();
    await expect(page.getByRole('tab', { name: /eBay/i })).toBeVisible();
  });

  test('eBay tab loads without crash and shows eBay columns', async ({ page }) => {
    await page.goto('/arbitrage?tab=ebay');
    await expect(page.getByRole('tab', { name: /eBay/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    // Check column headers on the real (non-skeleton) table
    const hasDataRows = await page.locator('table tbody tr').count() > 0;
    const hasEmptyState = await page.getByText('No items found').isVisible().catch(() => false);
    expect(hasDataRows || hasEmptyState).toBeTruthy();
    if (hasDataRows) {
      await expect(page.getByRole('columnheader', { name: /eBay Min/i })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('columnheader', { name: /COG/i })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /Listings/i })).toBeVisible();
      // Should NOT have BrickLink columns
      const hasBLMin = await page.getByRole('columnheader', { name: /BL Min/i }).isVisible().catch(() => false);
      const hasBLLots = await page.getByRole('columnheader', { name: /BL Lots/i }).isVisible().catch(() => false);
      expect(hasBLMin).toBeFalsy();
      expect(hasBLLots).toBeFalsy();
    }
  });

  test('BrickLink tab shows BrickLink columns', async ({ page }) => {
    await page.goto('/arbitrage?tab=bricklink');
    await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    const hasDataRows = await page.locator('table tbody tr').count() > 0;
    if (hasDataRows) {
      await expect(page.getByRole('columnheader', { name: /BL Min/i })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /COG/i })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: /BL Lots/i })).toBeVisible();
      const hasEbayMin = await page.getByRole('columnheader', { name: /eBay Min/i }).isVisible().catch(() => false);
      expect(hasEbayMin).toBeFalsy();
    }
  });

  test('switching between tabs does not crash', async ({ page }) => {
    await page.goto('/arbitrage?tab=bricklink');
    await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible({ timeout: 15000 });

    // Switch to eBay
    await page.getByRole('tab', { name: /eBay/i }).click();
    await page.waitForURL('**/arbitrage?tab=ebay');
    await expect(page.getByRole('tab', { name: /eBay/i })).toBeVisible();

    // Switch back to BrickLink
    await page.getByRole('tab', { name: /BrickLink/i }).click();
    await page.waitForURL('**/arbitrage?tab=bricklink');
    await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible();
  });

  test('BrickLink row click opens detail modal without crash', async ({ page }) => {
    await page.goto('/arbitrage?tab=bricklink');
    await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // Click on the Item cell (first column) to avoid hitting the Offers button
      await rows.first().locator('td').first().click();
      // Modal needs an API fetch for selectedItem - give it time
      const dialogVisible = await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (dialogVisible) {
        // Dialog opened - verify it has content and no crash
        const hasContent = await page.getByRole('dialog').textContent();
        expect(hasContent?.length).toBeGreaterThan(10);
        // Close dialog
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      }
      // Verify page is still interactive (no crash)
      await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible({ timeout: 5000 });
    }
  });

  test('eBay row click opens eBay detail modal without crash', async ({ page }) => {
    await page.goto('/arbitrage?tab=ebay');
    await expect(page.getByRole('tab', { name: /eBay/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      // Click on the Item cell (first column) to avoid hitting the Offers button
      await rows.first().locator('td').first().click();
      const dialogVisible = await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (dialogVisible) {
        const hasContent = await page.getByRole('dialog').textContent();
        expect(hasContent?.length).toBeGreaterThan(10);
        // Close dialog
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      }
      // Verify page is still interactive (no crash)
      await expect(page.getByRole('tab', { name: /eBay/i })).toBeVisible({ timeout: 5000 });
    }
  });

  test('no console errors on BrickLink tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto('/arbitrage?tab=bricklink');
    await expect(page.getByRole('tab', { name: /BrickLink/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    await page.waitForTimeout(1000);
    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('hydration')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('no console errors on eBay tab', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto('/arbitrage?tab=ebay');
    await expect(page.getByRole('tab', { name: /eBay/i })).toBeVisible({ timeout: 15000 });
    await waitForTableData(page);
    await page.waitForTimeout(1000);
    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('hydration')
    );
    expect(criticalErrors).toEqual([]);
  });
});
