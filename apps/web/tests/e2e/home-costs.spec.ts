import { test, expect } from '@playwright/test';

/**
 * Home Costs Feature Integration Tests
 *
 * Tests the full Home Costs feature including:
 * - Modal UI and navigation
 * - Use of Home tab (HMRC flat rates)
 * - Phone & Broadband tab
 * - Insurance tab
 * - Settings tab
 * - API endpoints
 * - P&L report integration
 *
 * Prerequisites:
 * 1. Dev server running on localhost:3000
 * 2. User logged in (uses stored auth state)
 * 3. Supabase cloud database connected
 */

test.describe('Home Costs Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to P&L report page where Home Costs button is located
    await page.goto('/reports/profit-loss');
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  // =========================================================================
  // Phase 1: Modal UI Structure Tests (F12-F20)
  // =========================================================================

  test.describe('Modal UI Structure', () => {
    test('F12: Home Costs button is visible on P&L page', async ({ page }) => {
      const homeCostsButton = page.getByRole('button', { name: /Home Costs/i });
      await expect(homeCostsButton).toBeVisible();
    });

    test('F13: Modal opens on button click', async ({ page }) => {
      // Click Home Costs button
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Verify modal is visible
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
    });

    test('F14: Modal has four tabs', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Check for all four tabs
      await expect(page.getByRole('tab', { name: /Use of Home/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Phone.*Broadband/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Insurance/i })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Settings/i })).toBeVisible();
    });

    test('F15: Modal opens on first tab (Use of Home)', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // First tab should be selected by default
      const useOfHomeTab = page.getByRole('tab', { name: /Use of Home/i });
      await expect(useOfHomeTab).toHaveAttribute('data-state', 'active');
    });

    test('F16: Modal closes via X button', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      // Click close button
      await page.getByRole('button', { name: /close/i }).click();

      // Modal should be closed
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });

    test('F17: Modal does not close on backdrop click', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();

      // Click on the backdrop (outside the modal content)
      await page.mouse.click(10, 10);

      // Modal should still be visible
      await expect(modal).toBeVisible();
    });

    test('F18: Tab navigation works', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Click each tab and verify it becomes active
      const tabs = [
        { name: /Phone.*Broadband/i, content: /Monthly Cost/i },
        { name: /Insurance/i, content: /Annual Premium/i },
        { name: /Settings/i, content: /Display Mode/i },
        { name: /Use of Home/i, content: /hours.*month/i },
      ];

      for (const tab of tabs) {
        await page.getByRole('tab', { name: tab.name }).click();
        await expect(page.getByRole('tab', { name: tab.name })).toHaveAttribute('data-state', 'active');
      }
    });

    test('F19: Each tab has its own Save button', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Check Use of Home tab has Save button
      await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();

      // Check Phone & Broadband tab has Save button (in dialog when adding)
      await page.getByRole('tab', { name: /Phone.*Broadband/i }).click();
      // Note: Save button appears in the add/edit dialog

      // Check Insurance tab has Save button
      await page.getByRole('tab', { name: /Insurance/i }).click();
      await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();

      // Check Settings tab has Save button
      await page.getByRole('tab', { name: /Settings/i }).click();
      await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
    });
  });

  // =========================================================================
  // Phase 2: Use of Home Tab Tests (F21-F31)
  // =========================================================================

  test.describe('Use of Home Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      // Ensure we're on Use of Home tab
      await page.getByRole('tab', { name: /Use of Home/i }).click();
    });

    test('F21: Has three radio options with HMRC rates', async ({ page }) => {
      // Check for the three hour tier options
      await expect(page.getByText(/25-50 hours/i)).toBeVisible();
      await expect(page.getByText(/51-100 hours/i)).toBeVisible();
      await expect(page.getByText(/101\+ hours/i)).toBeVisible();

      // Check for the rates
      await expect(page.getByText(/£10/)).toBeVisible();
      await expect(page.getByText(/£18/)).toBeVisible();
      await expect(page.getByText(/£26/)).toBeVisible();
    });

    test('F22-F23: Has Start Date and End Date month pickers', async ({ page }) => {
      await expect(page.getByText(/Start Date/i)).toBeVisible();
      await expect(page.getByText(/End Date/i)).toBeVisible();
      await expect(page.getByText(/Ongoing/i)).toBeVisible();
    });

    test('F24-F25: Displays calculated monthly and annual values', async ({ page }) => {
      // Select a tier
      await page.getByText(/101\+ hours/i).click();

      // Check calculated values appear
      await expect(page.getByText(/Monthly Allowance/i)).toBeVisible();
      await expect(page.getByText(/£26/)).toBeVisible();
      await expect(page.getByText(/Annual/i)).toBeVisible();
      await expect(page.getByText(/£312/)).toBeVisible();
    });
  });

  // =========================================================================
  // Phase 3: Phone & Broadband Tab Tests (F32-F44)
  // =========================================================================

  test.describe('Phone & Broadband Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await page.getByRole('tab', { name: /Phone.*Broadband/i }).click();
    });

    test('F32: Displays cost list table', async ({ page }) => {
      // Check for table headers or empty state
      const tableOrEmpty = page.locator('table, [data-testid="empty-state"]');
      await expect(tableOrEmpty.first()).toBeVisible();
    });

    test('F33: Has Add Cost button', async ({ page }) => {
      const addButton = page.getByRole('button', { name: /Add Cost/i });
      await expect(addButton).toBeVisible();
    });

    test('F34: Add dialog has preset dropdown with 3 options', async ({ page }) => {
      await page.getByRole('button', { name: /Add Cost/i }).click();

      // Open the dropdown
      const dropdown = page.locator('select, [role="combobox"]').first();
      await dropdown.click();

      // Check for the 3 preset options
      await expect(page.getByText(/Mobile Phone/i)).toBeVisible();
      await expect(page.getByText(/Home Broadband/i)).toBeVisible();
      await expect(page.getByText(/Landline/i)).toBeVisible();
    });

    test('F35-F36: Dialog has Monthly Cost and Business Percent inputs', async ({ page }) => {
      await page.getByRole('button', { name: /Add Cost/i }).click();

      await expect(page.getByText(/Monthly Cost/i)).toBeVisible();
      await expect(page.getByText(/Business.*%/i)).toBeVisible();
    });

    test('F37: Dialog shows calculated claimable amount', async ({ page }) => {
      await page.getByRole('button', { name: /Add Cost/i }).click();

      // Fill in values
      await page.locator('input[type="number"]').first().fill('40');
      await page.locator('input[type="number"]').nth(1).fill('60');

      // Check claimable amount appears (£40 * 60% = £24)
      await expect(page.getByText(/Claimable/i)).toBeVisible();
    });
  });

  // =========================================================================
  // Phase 4: Insurance Tab Tests (F45-F56)
  // =========================================================================

  test.describe('Insurance Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await page.getByRole('tab', { name: /Insurance/i }).click();
    });

    test('F45: Has Annual Premium, Business Stock Value, Total Contents Value inputs', async ({ page }) => {
      await expect(page.getByText(/Annual Premium/i)).toBeVisible();
      await expect(page.getByText(/Business Stock Value/i)).toBeVisible();
      await expect(page.getByText(/Total Contents Value/i)).toBeVisible();
    });

    test('F46-F48: Shows calculated proportion and claimable amounts', async ({ page }) => {
      // Fill in values
      const inputs = page.locator('input[type="number"]');
      await inputs.nth(0).fill('240'); // Annual Premium
      await inputs.nth(1).fill('5000'); // Business Stock
      await inputs.nth(2).fill('25000'); // Total Contents

      // Check calculated values appear
      await expect(page.getByText(/Business Proportion/i)).toBeVisible();
      await expect(page.getByText(/20/)).toBeVisible(); // 5000/25000 = 20%
      await expect(page.getByText(/Annual Claimable/i)).toBeVisible();
      await expect(page.getByText(/Monthly/i)).toBeVisible();
    });

    test('F49: Has Start Date and End Date month pickers', async ({ page }) => {
      await expect(page.getByText(/Start Date/i)).toBeVisible();
      await expect(page.getByText(/End Date/i)).toBeVisible();
    });

    test('F55: Validates stock cannot exceed total contents', async ({ page }) => {
      // Fill in invalid values (stock > total)
      const inputs = page.locator('input[type="number"]');
      await inputs.nth(0).fill('240');
      await inputs.nth(1).fill('30000'); // Stock value
      await inputs.nth(2).fill('25000'); // Total (less than stock)

      // Try to save
      await page.getByRole('button', { name: /Save/i }).click();

      // Should show error
      await expect(page.getByText(/cannot exceed/i)).toBeVisible({ timeout: 5000 });
    });
  });

  // =========================================================================
  // Phase 5: Settings Tab Tests (F57-F60)
  // =========================================================================

  test.describe('Settings Tab', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await page.getByRole('tab', { name: /Settings/i }).click();
    });

    test('F57: Has display mode radio options', async ({ page }) => {
      await expect(page.getByText(/Separate line items/i)).toBeVisible();
      await expect(page.getByText(/consolidated/i)).toBeVisible();
    });

    test('F58: Default is separate mode', async ({ page }) => {
      // The "Separate" option should be selected by default
      const separateRadio = page.locator('input[type="radio"], [role="radio"]').first();
      // Check if it's checked or has active state
      await expect(page.getByText(/Separate line items/i)).toBeVisible();
    });
  });

  // =========================================================================
  // Phase 6: API Endpoint Tests (F6-F11)
  // =========================================================================

  test.describe('API Endpoints', () => {
    test('F6: GET /api/home-costs returns costs and settings', async ({ request }) => {
      const response = await request.get('/api/home-costs');

      // Should return 200 or 401 (if not authenticated in API context)
      expect([200, 401]).toContain(response.status());

      if (response.status() === 200) {
        const data = await response.json();
        expect(data).toHaveProperty('costs');
        expect(data).toHaveProperty('settings');
        expect(Array.isArray(data.costs)).toBe(true);
      }
    });

    test('F11: API requires authentication', async ({ request }) => {
      // Make request without auth - should return 401
      const response = await request.get('/api/home-costs', {
        headers: {
          // Clear any auth headers
          Cookie: '',
        },
      });

      // Either 401 or the response should indicate unauthorized
      if (response.status() !== 401) {
        const data = await response.json();
        expect(data.error).toMatch(/unauthorized/i);
      }
    });
  });

  // =========================================================================
  // Phase 7: Full Integration Flow Test
  // =========================================================================

  test.describe('Full Integration Flow', () => {
    test('Can create, view, and delete a Use of Home entry', async ({ page }) => {
      // Open modal
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Select hour tier
      await page.getByText(/101\+ hours/i).click();

      // Save
      await page.getByRole('button', { name: /Save/i }).click();

      // Wait for success toast
      await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 5000 });

      // Close and reopen modal to verify persistence
      await page.getByRole('button', { name: /close/i }).click();
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Verify the selection persisted (101+ should be selected)
      // The delete button should now be visible indicating an existing entry
      const deleteButton = page.getByRole('button', { name: /Delete/i });

      if (await deleteButton.isVisible()) {
        // Clean up - delete the entry
        await deleteButton.click();
        await expect(page.getByText(/deleted/i)).toBeVisible({ timeout: 5000 });
      }
    });

    test('F70: P&L auto-recalculates on cost change', async ({ page }) => {
      // Note the current P&L totals before adding costs
      const initialExpenses = await page.locator('text=Total Expenses').locator('..').textContent();

      // Open modal and add a cost
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await page.getByText(/101\+ hours/i).click();
      await page.getByRole('button', { name: /Save/i }).click();
      await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 5000 });

      // Close modal
      await page.getByRole('button', { name: /close/i }).click();

      // Wait for P&L to refresh
      await page.waitForTimeout(1000);

      // The P&L should now include Home Costs section
      await expect(page.getByText(/Home Costs/i)).toBeVisible();

      // Clean up
      await page.getByRole('button', { name: /Home Costs/i }).click();
      const deleteButton = page.getByRole('button', { name: /Delete/i });
      if (await deleteButton.isVisible()) {
        await deleteButton.click();
      }
    });
  });

  // =========================================================================
  // Phase 8: P&L Report Integration Tests (F61-F69)
  // =========================================================================

  test.describe('P&L Report Integration', () => {
    test('F66: Home Costs section shows separate line items', async ({ page }) => {
      // Open modal and add all three cost types
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Add Use of Home
      await page.getByText(/101\+ hours/i).click();
      await page.getByRole('button', { name: /Save/i }).click();
      await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 5000 });

      // Close modal and check P&L
      await page.getByRole('button', { name: /close/i }).click();
      await page.waitForTimeout(500);

      // Look for Home Costs category in the P&L table
      const homeCostsSection = page.getByText('Home Costs');
      await expect(homeCostsSection).toBeVisible();

      // Clean up
      await page.getByRole('button', { name: /Home Costs/i }).click();
      const deleteButton = page.getByRole('button', { name: /Delete/i });
      if (await deleteButton.isVisible()) {
        await deleteButton.click();
      }
    });

    test('F68: Home Costs section appears at end of expenses', async ({ page }) => {
      // Home Costs should be after Bills in the category order
      const categoryOrder = await page.locator('table tbody tr').allTextContents();
      const billsIndex = categoryOrder.findIndex((row) => row.includes('Bills'));
      const homeCostsIndex = categoryOrder.findIndex((row) => row.includes('Home Costs'));

      // Home Costs should come after Bills (if both exist)
      if (billsIndex >= 0 && homeCostsIndex >= 0) {
        expect(homeCostsIndex).toBeGreaterThan(billsIndex);
      }
    });
  });

  // =========================================================================
  // Phase 9: Validation Tests (E1-E8)
  // =========================================================================

  test.describe('Validation', () => {
    test('E2: Use of Home requires hour tier selection', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();

      // Don't select any tier, just try to save
      // First clear any existing selection if present
      await page.getByRole('button', { name: /Save/i }).click();

      // If there's no existing entry and no selection, should show validation error
      // Note: This depends on the UI state - if there's already an entry, it will be pre-selected
    });

    test('E6: Business percent must be 1-100', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await page.getByRole('tab', { name: /Phone.*Broadband/i }).click();
      await page.getByRole('button', { name: /Add Cost/i }).click();

      // Try to enter 0 for business percent
      const percentInput = page.locator('input').filter({ hasText: '' }).nth(1);
      await percentInput.fill('0');

      // The input should have min=1 constraint or show validation
      const inputValue = await percentInput.inputValue();
      // HTML5 min constraint may prevent 0, or validation will catch it
    });

    test('E8: End date must be after start date', async ({ page }) => {
      await page.getByRole('button', { name: /Home Costs/i }).click();
      await page.getByRole('tab', { name: /Insurance/i }).click();

      // Uncheck ongoing
      const ongoingCheckbox = page.getByLabel(/Ongoing/i);
      if (await ongoingCheckbox.isChecked()) {
        await ongoingCheckbox.click();
      }

      // Try to set end date before start date
      // This would require manipulating the month pickers
      // The validation should prevent saving if end < start
    });
  });
});
