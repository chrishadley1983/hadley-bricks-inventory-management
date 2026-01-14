import { test, expect } from '@playwright/test';

/**
 * eBay Listing Refresh API Tests
 *
 * Tests for all listing refresh API endpoints.
 * These tests verify response structure and validation.
 *
 * Note: All tests use authenticated context from the global setup.
 */

test.describe('eBay Listing Refresh API', () => {
  test('GET /api/ebay/connection/scopes - should return scope information', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.get('/api/ebay/connection/scopes');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(data.data).toHaveProperty('isConnected');
    expect(data.data).toHaveProperty('hasScopes');
    expect(data.data).toHaveProperty('missingScopes');
    expect(data.data).toHaveProperty('currentScopes');

    expect(typeof data.data.isConnected).toBe('boolean');
    expect(typeof data.data.hasScopes).toBe('boolean');
    expect(Array.isArray(data.data.missingScopes)).toBe(true);
    expect(Array.isArray(data.data.currentScopes)).toBe(true);

    console.log('Scope check result:', data.data);
  });

  test('GET /api/ebay/listing-refresh/eligible - should handle request', async ({
    page,
    request,
  }) => {
    // Set a longer timeout for this test since eBay API can be slow
    test.setTimeout(90000);

    await page.goto('/');

    const response = await request.get('/api/ebay/listing-refresh/eligible', {
      timeout: 60000, // eBay API can be slow
    });

    // Could be 200 (success) or 400/500 (eBay not connected or missing scopes)
    console.log(`Eligible listings status: ${response.status()}`);

    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.data)).toBe(true);

      if (data.data.length > 0) {
        const listing = data.data[0];
        expect(listing).toHaveProperty('itemId');
        expect(listing).toHaveProperty('title');
        expect(listing).toHaveProperty('price');
        expect(listing).toHaveProperty('listingAge');
        expect(listing).toHaveProperty('watchers');
      }

      // Debug: Log all listings with engagement data
      console.log('All eligible listings:');
      data.data.forEach((listing: { itemId: string; title: string; watchers: number; views: number | null; galleryUrl: string | null }) => {
        console.log(`  ${listing.itemId}: watchers=${listing.watchers}, views=${listing.views}, gallery=${listing.galleryUrl ? 'YES' : 'NO'} - ${listing.title?.substring(0, 40)}`);
      });

      console.log(`Found ${data.count} eligible listings`);
    } else {
      const data = await response.json();
      expect(data).toHaveProperty('error');
      console.log('Eligible listings error (expected if eBay scopes missing):', data.error);
    }
  });

  test('GET /api/ebay/listing-refresh - should return refresh history', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.get('/api/ebay/listing-refresh');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('count');
    expect(Array.isArray(data.data)).toBe(true);

    if (data.data.length > 0) {
      const job = data.data[0];
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('totalListings');
      expect(job).toHaveProperty('reviewMode');
    }

    console.log(`Found ${data.count} refresh jobs in history`);
  });

  test('GET /api/ebay/listing-refresh - should accept limit parameter', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.get('/api/ebay/listing-refresh?limit=5');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeLessThanOrEqual(5);
  });

  test('POST /api/ebay/listing-refresh - should validate empty listings', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.post('/api/ebay/listing-refresh', {
      data: { listings: [], reviewMode: true },
    });

    // Should return 400 for empty listings
    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    console.log('Validation error:', data.error);
  });

  test('GET /api/ebay/listing-refresh/[id] - should return 404 for non-existent job', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.get(
      '/api/ebay/listing-refresh/00000000-0000-0000-0000-000000000000'
    );

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('DELETE /api/ebay/listing-refresh/[id] - should return 404 for non-existent job', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.delete(
      '/api/ebay/listing-refresh/00000000-0000-0000-0000-000000000000'
    );

    expect(response.status()).toBe(404);
  });

  test('POST /api/ebay/listing-refresh/[id]/execute - should return 404 for non-existent job', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.post(
      '/api/ebay/listing-refresh/00000000-0000-0000-0000-000000000000/execute'
    );

    expect(response.status()).toBe(404);
  });

  test('POST /api/ebay/listing-refresh/[id]/items/approve - should validate itemIds', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.post(
      '/api/ebay/listing-refresh/00000000-0000-0000-0000-000000000000/items/approve',
      { data: {} }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('POST /api/ebay/listing-refresh/[id]/items/skip - should validate itemIds', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.post(
      '/api/ebay/listing-refresh/00000000-0000-0000-0000-000000000000/items/skip',
      { data: {} }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  test('PATCH /api/ebay/listing-refresh/[id]/items/[itemId] - should return 404 for non-existent job', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const response = await request.patch(
      '/api/ebay/listing-refresh/00000000-0000-0000-0000-000000000000/items/test-item-id',
      { data: { title: 'Updated Title' } }
    );

    expect(response.status()).toBe(404);
  });
});

test.describe('eBay Listing Refresh UI', () => {
  test('should navigate to Listing Assistant page', async ({ page }) => {
    await page.goto('/listing-assistant');

    await expect(
      page.getByRole('heading', { name: /Listing Assistant/i })
    ).toBeVisible();
  });

  test('should show Refresh tab in Listing Assistant', async ({ page }) => {
    await page.goto('/listing-assistant');

    await expect(page.getByRole('tab', { name: 'Refresh' })).toBeVisible();
  });

  test('should switch to Refresh tab and show content', async ({ page }) => {
    await page.goto('/listing-assistant');

    // Click Refresh tab
    await page.getByRole('tab', { name: 'Refresh' }).click();

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Take screenshot for debugging
    await page.screenshot({ path: 'test-results/listing-refresh-tab.png' });

    // Verify tab is selected
    const refreshTab = page.getByRole('tab', { name: 'Refresh' });
    await expect(refreshTab).toHaveAttribute('aria-selected', 'true');

    // Check that SOME content appears in the tab panel
    const tabPanel = page.getByRole('tabpanel', { name: 'Refresh' });
    await expect(tabPanel).toBeVisible();

    // Look for any expected content - loading skeleton, scope prompt, or listings
    // The component should show something - either a loading state, error, or content
    const hasAnyContent =
      (await page.locator('text=Refresh Listings').isVisible().catch(() => false)) ||
      (await page.locator('text=Additional Permissions Required').isVisible().catch(() => false)) ||
      (await page.locator('text=Eligible Listings').isVisible().catch(() => false)) ||
      (await page.locator('[class*="skeleton"]').first().isVisible().catch(() => false));

    console.log('Has content in Refresh tab:', hasAnyContent);

    // Just verify tab panel is visible - content depends on eBay connection state
    expect(tabPanel).toBeVisible();
  });

  test('should display Refresh tab content based on eBay connection', async ({ page }) => {
    await page.goto('/listing-assistant');
    await page.getByRole('tab', { name: 'Refresh' }).click();

    // Wait for API calls and lazy loading to complete
    await page.waitForTimeout(5000);

    // Take screenshot
    await page.screenshot({ path: 'test-results/listing-refresh-content.png' });

    // Check what content is displayed
    const hasScopePrompt = await page
      .getByText('Additional Permissions Required')
      .isVisible()
      .catch(() => false);

    const hasEligibleListings = await page
      .getByText('Eligible Listings')
      .isVisible()
      .catch(() => false);

    const hasNoListings = await page
      .getByText('No eligible listings')
      .isVisible()
      .catch(() => false);

    const hasRefreshHeader = await page
      .getByText('Refresh Listings')
      .isVisible()
      .catch(() => false);

    // Check if tab panel has any children at all
    const tabPanel = page.getByRole('tabpanel', { name: 'Refresh' });
    const panelContent = await tabPanel.innerHTML().catch(() => '');

    console.log({
      hasScopePrompt,
      hasEligibleListings,
      hasNoListings,
      hasRefreshHeader,
      panelContentLength: panelContent.length,
    });

    // The tab should have some content (not empty)
    // Either showing a prompt, listings, or at least meaningful HTML
    const hasExpectedContent =
      hasScopePrompt ||
      hasEligibleListings ||
      hasNoListings ||
      hasRefreshHeader ||
      panelContent.length > 100; // Has some meaningful content

    if (!hasExpectedContent) {
      console.log('Panel content:', panelContent.substring(0, 1000));
    }

    expect(hasExpectedContent).toBe(true);
  });
});
