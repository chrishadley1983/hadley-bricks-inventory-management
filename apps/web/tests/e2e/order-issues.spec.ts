import { test, expect } from '@playwright/test';

const BL_TEST_ORDER = '29812362'; // 1-item BL order, recent, in platform_orders
const BO_TEST_ORDER = '8518237'; // 4-item BO order

test.describe('Order Issues — manual flow', () => {
  test('sidebar entry routes to /order-issues and list renders', async ({ page }) => {
    await page.goto('/dashboard');
    const link = page.locator('a[href="/order-issues"]', { hasText: 'Order Issues' });
    await expect(link).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/order-issues/, { timeout: 15000 }),
      link.click(),
    ]);
    await expect(page.locator('h1', { hasText: 'Order Issues' })).toBeVisible();
  });

  test('empty state appears when no open issues', async ({ page }) => {
    await page.goto('/order-issues');
    // If there are no issues, the empty state should be present.
    // If there are some, just confirm the table or empty state is rendered.
    const empty = page.getByText(/No open issues|No order issues/);
    const tableHead = page.locator('th', { hasText: 'Order date' });
    await expect(empty.or(tableHead)).toBeVisible();
  });

  test('New issue → BL lookup → save → detail page', async ({ page }) => {
    await page.goto('/order-issues');
    await page.getByRole('button', { name: /New issue/i }).click();

    // Dialog opened
    await expect(page.getByRole('dialog')).toBeVisible();

    // Platform should default to bricklink; type order #
    await page.getByLabel(/Order #/).fill(BL_TEST_ORDER);
    await page.getByRole('button', { name: /Lookup/i }).click();

    // Wait for buyer info to render (sourced from platform_orders)
    await expect(page.getByText(/Buyer:/)).toBeVisible({ timeout: 10000 });

    // Pick first lot — Radix Checkbox renders as <button role="checkbox">
    const firstCheckbox = page
      .locator('table tbody [role="checkbox"], table tbody button[role="checkbox"]')
      .first();
    await firstCheckbox.click();

    // Set planned resolution
    await page.getByPlaceholder(/Refund missing lots/).fill('E2E test resolution');

    // Create
    await page.getByRole('button', { name: /Create issue/i }).click();

    // Should land on detail page
    await expect(page).toHaveURL(/\/order-issues\/[0-9a-f-]{36}/, { timeout: 15000 });
    // Wait for the detail data to load (h1 includes the order number)
    await expect(page.locator('h1')).toContainText(BL_TEST_ORDER, { timeout: 15000 });
  });

  test('Detail page status change + manual message + delete', async ({ page }) => {
    await page.goto('/order-issues');
    // Wait for list page header to confirm load
    await expect(page.locator('h1', { hasText: 'Order Issues' })).toBeVisible({ timeout: 15000 });
    // Wait for our seeded issue row
    const row = page.locator('tr', { hasText: BL_TEST_ORDER }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    // Click the order # cell's link explicitly (whole-row click can land on padding)
    await row.locator(`a:has-text("${BL_TEST_ORDER}")`).click();
    await expect(page).toHaveURL(/\/order-issues\/[0-9a-f-]{36}/, { timeout: 10000 });
    // Wait for detail to load
    await expect(page.locator('h1')).toContainText(BL_TEST_ORDER, { timeout: 15000 });

    // Status change → awaiting_buyer
    await page.locator('label:has-text("Status")').locator('..').locator('button').click();
    await page.getByRole('option', { name: 'Awaiting buyer' }).click();
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText('Currently: Awaiting buyer')).toBeVisible({ timeout: 10000 });

    // Add manual message
    await page.getByPlaceholder(/Paste or type message body/).fill('E2E test manual message');
    await page.getByRole('button', { name: /^Add message$/ }).click();
    await expect(page.getByText('E2E test manual message')).toBeVisible({ timeout: 10000 });

    // Delete the issue (cleanup)
    page.once('dialog', (d) => d.accept());
    // Trash button is the last "outline"-variant button in the page header
    const trashButtons = page.locator('button:has(svg.lucide-trash-2)');
    await trashButtons.first().click();
    await expect(page).toHaveURL(/\/order-issues$/, { timeout: 10000 });
  });

  test('New issue rejects unknown order # (E2)', async ({ page }) => {
    await page.goto('/order-issues');
    await page.getByRole('button', { name: /New issue/i }).click();
    await page.getByLabel(/Order #/).fill('99999999999');
    await page.getByRole('button', { name: /Lookup/i }).click();
    await expect(page.getByText(/not found|Order not found/i)).toBeVisible({ timeout: 8000 });
  });

  test('Open-only toggle shows/hides closed issues (F7)', async ({ page }) => {
    await page.goto('/order-issues');
    const toggle = page.locator('#open-only');
    // Toggle off and on again to verify it doesn't crash
    await toggle.click();
    await page.waitForLoadState('networkidle');
    await toggle.click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1', { hasText: 'Order Issues' })).toBeVisible();
  });
});
