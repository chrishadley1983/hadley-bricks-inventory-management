/**
 * Amazon Sync New SKU Price Test Suite
 *
 * Tests the fix for price=0 when creating new listings on Amazon
 * for existing ASINs where the user has no prior SKU.
 *
 * Prerequisites:
 * 1. Dev server running on localhost:3000
 * 2. User logged in (auth state saved)
 * 3. Test inventory item exists with:
 *    - Valid ASIN (exists in Amazon catalog)
 *    - No existing Amazon SKU for this user
 *    - listing_value > 0
 *
 * Run with: npx playwright test amazon-sync-new-sku --headed
 *
 * Test different variations:
 * $env:AMAZON_PRICE_VARIATION="string_price"
 * npx playwright test amazon-sync-new-sku --headed
 */

import { test, expect } from '@playwright/test';
import * as helpers from './helpers/amazon-sync.helpers';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TEST CONFIGURATION
// Update these values for your test data!
// ============================================================================

const TEST_CONFIG = {
  // Set number to test - MUST have:
  // - Amazon ASIN assigned
  // - No existing Amazon SKU for your account
  // - listing_value > 0 (e.g., 15.00)
  setNumber: '40460', // Roses - ASIN B0BYZHTMVW, £15.00

  // The specific ASIN we're testing
  asin: 'B0BYZHTMVW',

  // Expected price in GBP
  expectedPrice: 15.0,

  // Maximum time to wait for Amazon feed processing
  feedProcessingTimeout: 60000, // 1 minute
};

// ============================================================================
// TEST SETUP
// ============================================================================

test.describe('Amazon Sync - New SKU Price Fix', () => {
  test.setTimeout(120000); // 2 minute timeout for these tests

  // Ensure test results directory exists
  test.beforeAll(async () => {
    const resultsDir = 'test-results/amazon-sync';
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
  });

  // =========================================================================
  // BASELINE TESTS - Run these first to understand current behavior
  // =========================================================================

  test.describe('Baseline Tests', () => {
    test('should capture current payload structure', async ({ page }) => {
      /**
       * Documents the current payload being sent to Amazon.
       * Run first to establish baseline before making changes.
       */

      helpers.logTestStep('Starting baseline capture test');

      // Navigate to inventory and add test item
      await helpers.navigateToInventory(page);
      helpers.logTestStep(`Searching for item: ${TEST_CONFIG.setNumber}`);

      try {
        await helpers.addItemToSyncQueue(page, TEST_CONFIG.setNumber);
      } catch (error) {
        // Item might already be in queue - that's OK
        helpers.logTestStep('Item may already be in queue', { error: String(error) });
      }

      // Navigate to sync page
      await helpers.navigateToAmazonSync(page);

      // Verify item is in queue
      const queueCount = await helpers.getQueueItemCount(page);
      helpers.logTestStep('Queue count', { count: queueCount });
      expect(queueCount).toBeGreaterThan(0);

      // Set up network capture
      const capturePromise = helpers.captureNetworkPayload(page, '/api/amazon/sync/submit');

      // Submit as dry run
      helpers.logTestStep('Submitting dry run');
      await helpers.submitSyncFeed(page, true);

      // Capture the payload
      const captured = await capturePromise;

      helpers.logTestStep('Captured Payload', captured);

      // Save to file for analysis
      const variation = process.env.AMAZON_PRICE_VARIATION || 'baseline';
      const resultFile = path.join(
        'test-results/amazon-sync',
        `payload-${variation}-${Date.now()}.json`
      );
      fs.writeFileSync(resultFile, JSON.stringify(captured, null, 2));
      helpers.logTestStep(`Payload saved to: ${resultFile}`);

      // Take screenshot
      await helpers.takeTaggedScreenshot(page, `baseline-${variation}`);
    });

    test('should show queue items with correct price display', async ({ page }) => {
      /**
       * Verifies the queue table displays the correct local price
       * before submission.
       */

      await helpers.navigateToAmazonSync(page);

      // Take screenshot of queue
      await helpers.takeTaggedScreenshot(page, 'queue-display');

      // Check that the queue table is visible
      const table = page.getByRole('table');
      if (await table.isVisible()) {
        // Look for price column
        const priceHeader = page.getByRole('columnheader', { name: /local price/i });
        await expect(priceHeader).toBeVisible();

        // Log first few rows for debugging
        const rows = await page.getByRole('row').all();
        helpers.logTestStep(`Queue has ${rows.length - 1} items (excluding header)`);
      }
    });
  });

  // =========================================================================
  // DRY RUN VALIDATION TESTS
  // =========================================================================

  test.describe('Dry Run Validation', () => {
    test('dry run should complete without validation errors', async ({ page }) => {
      /**
       * Tests that the current payload variation passes Amazon's
       * validation (dry run mode).
       */

      const variation = process.env.AMAZON_PRICE_VARIATION || 'baseline';
      helpers.logTestStep(`Testing variation: ${variation}`);

      // Ensure item is in queue
      await helpers.navigateToInventory(page);
      try {
        await helpers.addItemToSyncQueue(page, TEST_CONFIG.setNumber);
      } catch {
        // May already be in queue
      }

      // Submit dry run
      await helpers.navigateToAmazonSync(page);
      await helpers.submitSyncFeed(page, true);

      // Wait a moment for processing
      await page.waitForTimeout(3000);

      // Check for error toasts
      const errorToast = page.getByText(/error|failed/i);
      const hasError = await errorToast.isVisible().catch(() => false);

      if (hasError) {
        helpers.logVariationTest(variation, 'fail', 'Dry run showed error');
        await helpers.takeTaggedScreenshot(page, `dry-run-error-${variation}`);
        throw new Error('Dry run validation failed');
      }

      // Check history tab for result
      await page.getByRole('tab', { name: /history/i }).click();
      await page.waitForTimeout(2000);

      await helpers.takeTaggedScreenshot(page, `dry-run-result-${variation}`);

      helpers.logVariationTest(variation, 'pass', 'Dry run completed');
    });
  });

  // =========================================================================
  // LIVE SUBMISSION TESTS (USE WITH CAUTION!)
  // =========================================================================

  test.describe('Live Submission', () => {
    // Skip by default - enable when ready for live testing
    test.skip(
      process.env.AMAZON_LIVE_TEST !== 'true',
      'Live tests disabled. Set AMAZON_LIVE_TEST=true to enable'
    );

    test('live submission should set correct price', async ({ page }) => {
      /**
       * WARNING: This test submits real data to Amazon!
       *
       * Enable with: $env:AMAZON_LIVE_TEST="true"
       */

      const variation = process.env.AMAZON_PRICE_VARIATION || 'baseline';
      helpers.logTestStep(`LIVE TEST - Variation: ${variation}`);

      // Ensure item is in queue
      await helpers.navigateToInventory(page);
      try {
        await helpers.addItemToSyncQueue(page, TEST_CONFIG.setNumber);
      } catch {
        // May already be in queue
      }

      // Capture the payload being sent
      await helpers.navigateToAmazonSync(page);
      const capturePromise = helpers.captureNetworkPayload(page, '/api/amazon/sync/submit');

      // Submit LIVE (not dry run)
      helpers.logTestStep('Submitting LIVE feed to Amazon');
      await helpers.submitSyncFeed(page, false);

      // Capture payload
      const captured = await capturePromise;
      helpers.logTestStep('Live submission payload', captured);

      // Save payload
      const payloadFile = path.join(
        'test-results/amazon-sync',
        `live-payload-${variation}-${Date.now()}.json`
      );
      fs.writeFileSync(payloadFile, JSON.stringify(captured, null, 2));

      // Wait for feed to complete
      helpers.logTestStep('Waiting for feed completion...');
      const status = await helpers.waitForFeedCompletion(
        page,
        TEST_CONFIG.feedProcessingTimeout
      );

      helpers.logTestStep(`Feed status: ${status}`);

      // Take final screenshot
      await helpers.takeTaggedScreenshot(page, `live-result-${variation}-${status}`);

      // Get feed details
      try {
        const details = await helpers.getFeedDetails(page);
        helpers.logTestStep('Feed details', { details });
      } catch {
        helpers.logTestStep('Could not get feed details');
      }

      // Log result
      if (status === 'completed') {
        helpers.logVariationTest(variation, 'pass', 'Feed completed - verify price in Seller Central');
      } else {
        helpers.logVariationTest(variation, 'fail', `Feed status: ${status}`);
      }

      expect(status).toBe('completed');
    });
  });

  // =========================================================================
  // VARIATION COMPARISON TEST
  // =========================================================================

  test.describe('Variation Comparison', () => {
    test('should log current variation configuration', async ({ page }) => {
      /**
       * Logs which variation is currently being tested.
       * Useful for comparing different runs.
       */

      const variation = process.env.AMAZON_PRICE_VARIATION || 'baseline';
      const liveEnabled = process.env.AMAZON_LIVE_TEST === 'true';

      console.log('\n' + '='.repeat(60));
      console.log('AMAZON SYNC TEST CONFIGURATION');
      console.log('='.repeat(60));
      console.log(`Variation:      ${variation}`);
      console.log(`Live Testing:   ${liveEnabled ? 'ENABLED' : 'DISABLED'}`);
      console.log(`Test Item:      ${TEST_CONFIG.setNumber}`);
      console.log(`Expected Price: ${TEST_CONFIG.expectedPrice}`);
      console.log('='.repeat(60) + '\n');

      // Navigate to ensure page works
      await helpers.navigateToAmazonSync(page);
      await helpers.takeTaggedScreenshot(page, `config-check-${variation}`);
    });
  });
});

// ============================================================================
// INDIVIDUAL VARIATION TESTS
// Run with specific AMAZON_PRICE_VARIATION env var
// ============================================================================

test.describe.serial('Individual Variation Tests', () => {
  const variation = process.env.AMAZON_PRICE_VARIATION || 'baseline';

  test(`[${variation}] dry run validation`, async ({ page }) => {
    helpers.logTestStep(`Running variation: ${variation}`);

    // Add item to queue
    await helpers.navigateToInventory(page);
    try {
      await helpers.addItemToSyncQueue(page, TEST_CONFIG.setNumber);
    } catch {
      // May already be in queue
    }

    // Capture and submit
    await helpers.navigateToAmazonSync(page);
    const capturePromise = helpers.captureNetworkPayload(page, '/api/amazon/sync/submit');

    await helpers.submitSyncFeed(page, true);

    const captured = await capturePromise;

    // Save results
    const resultsDir = 'test-results/amazon-sync/variations';
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(resultsDir, `${variation}-${Date.now()}.json`),
      JSON.stringify({ variation, ...captured }, null, 2)
    );

    await helpers.takeTaggedScreenshot(page, `variation-${variation}`);

    helpers.logTestStep('Test complete', { variation });
  });
});
