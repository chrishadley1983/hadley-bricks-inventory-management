/**
 * Amazon Sync E2E Test Helpers
 *
 * Reusable functions for testing the Amazon sync workflow.
 */

import { Page, expect } from '@playwright/test';

// ============================================================================
// NAVIGATION HELPERS
// ============================================================================

export async function navigateToAmazonSync(page: Page) {
  await page.goto('/amazon-sync');
  await expect(page.getByRole('heading', { name: 'Amazon Sync' })).toBeVisible({
    timeout: 10000,
  });
}

export async function navigateToInventory(page: Page) {
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible({
    timeout: 10000,
  });
}

// ============================================================================
// INVENTORY HELPERS
// ============================================================================

export async function findInventoryItemBySetNumber(page: Page, setNumber: string) {
  // Use search to find the item
  const searchInput = page.getByPlaceholder(/search/i);
  await searchInput.fill(setNumber);

  // Wait for debounce
  await page.waitForTimeout(500);

  // Wait for table to update
  await page.waitForTimeout(1000);

  return page.getByRole('row').filter({ hasText: setNumber }).first();
}

export async function addItemToSyncQueue(page: Page, setNumber: string) {
  await navigateToInventory(page);

  const row = await findInventoryItemBySetNumber(page, setNumber);

  // Check if row exists
  if (!(await row.isVisible())) {
    throw new Error(`Inventory item with set number ${setNumber} not found`);
  }

  // Click the Amazon sync button (cloud upload icon)
  // The button should be in the actions column
  const syncButton = row.locator('button').filter({
    has: page.locator('svg'),
  });

  // Find the cloud upload button specifically
  const buttons = await syncButton.all();
  let found = false;

  for (const btn of buttons) {
    const title = await btn.getAttribute('title');
    if (title?.toLowerCase().includes('amazon') || title?.toLowerCase().includes('sync')) {
      await btn.click();
      found = true;
      break;
    }
  }

  if (!found) {
    // Try clicking the first button with cloud icon
    await buttons[0]?.click();
  }

  // Wait for toast confirmation
  await expect(page.getByText(/added to queue/i)).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// QUEUE HELPERS
// ============================================================================

export async function getQueueItemCount(page: Page): Promise<number> {
  await navigateToAmazonSync(page);

  // Get badge count from the heading
  const badge = page.locator('h1 span').filter({ hasText: /\d+/ });

  if (await badge.isVisible()) {
    const text = await badge.textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  return 0;
}

export async function clearSyncQueue(page: Page) {
  await navigateToAmazonSync(page);

  const clearButton = page.getByRole('button', { name: /clear queue/i });

  if (await clearButton.isEnabled()) {
    await clearButton.click();

    // Confirm in dialog
    const confirmButton = page.getByRole('dialog').getByRole('button', { name: /clear all/i });
    await confirmButton.click();

    // Wait for completion
    await page.waitForTimeout(1000);
  }
}

// ============================================================================
// SUBMIT HELPERS
// ============================================================================

export async function submitSyncFeed(page: Page, dryRun: boolean = true) {
  await navigateToAmazonSync(page);

  // Ensure dry run toggle is set correctly
  const dryRunSwitch = page.locator('#dry-run');

  // Wait for switch to be visible
  await expect(dryRunSwitch).toBeVisible({ timeout: 5000 });

  const isChecked = await dryRunSwitch.isChecked();

  if (dryRun && !isChecked) {
    await dryRunSwitch.click();
  } else if (!dryRun && isChecked) {
    await dryRunSwitch.click();
  }

  // Click submit button
  const submitButton = page.getByRole('button').filter({
    hasText: dryRun ? /validate/i : /sync to amazon/i,
  });

  await submitButton.click();

  // Wait for submission to process
  await page.waitForTimeout(3000);
}

// ============================================================================
// NETWORK CAPTURE HELPERS
// ============================================================================

export interface CapturedPayload {
  request: unknown;
  response: unknown;
  timestamp: string;
}

export function captureNetworkPayload(
  page: Page,
  urlPattern: string
): Promise<CapturedPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for request to ${urlPattern}`));
    }, 30000);

    page.on('response', async (response) => {
      if (response.url().includes(urlPattern)) {
        clearTimeout(timeout);

        const request = response.request();
        let requestBody: unknown = null;
        let responseBody: unknown = null;

        try {
          const postData = request.postData();
          if (postData) {
            requestBody = JSON.parse(postData);
          }
        } catch {
          requestBody = request.postData();
        }

        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        resolve({
          request: requestBody,
          response: responseBody,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });
}

// ============================================================================
// FEED RESULT HELPERS
// ============================================================================

export async function waitForFeedCompletion(
  page: Page,
  maxWaitMs: number = 60000
): Promise<string> {
  await page.getByRole('tab', { name: /history/i }).click();

  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < maxWaitMs) {
    // Refresh to get latest status
    await page.reload();
    await page.getByRole('tab', { name: /history/i }).click();
    await page.waitForTimeout(1000);

    // Check first row status
    const firstRow = page.getByRole('row').nth(1); // Skip header
    const statusCell = firstRow.locator('td').nth(2); // Adjust index as needed

    const statusText = await statusCell.textContent();

    if (statusText?.toLowerCase().includes('completed') || statusText?.toLowerCase().includes('done')) {
      return 'completed';
    }

    if (statusText?.toLowerCase().includes('error') || statusText?.toLowerCase().includes('failed')) {
      return 'failed';
    }

    await page.waitForTimeout(pollInterval);
  }

  return 'timeout';
}

export async function getFeedDetails(page: Page, feedRowIndex: number = 0) {
  await page.getByRole('tab', { name: /history/i }).click();

  // Click on the feed row to open details
  const feedRow = page.getByRole('row').nth(feedRowIndex + 1); // +1 to skip header
  await feedRow.click();

  // Wait for dialog
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

  // Get dialog content
  const dialogContent = await page.getByRole('dialog').textContent();

  return dialogContent;
}

// ============================================================================
// SCREENSHOT HELPERS
// ============================================================================

export async function takeTaggedScreenshot(
  page: Page,
  tag: string,
  fullPage: boolean = true
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-results/amazon-sync/${tag}-${timestamp}.png`;

  await page.screenshot({ path: filename, fullPage });
  console.log(`Screenshot saved: ${filename}`);

  return filename;
}

// ============================================================================
// LOGGING HELPERS
// ============================================================================

export function logTestStep(step: string, details?: unknown) {
  console.log(`\n=== ${step} ===`);
  if (details) {
    console.log(JSON.stringify(details, null, 2));
  }
}

export function logVariationTest(variation: string, result: 'pass' | 'fail', notes?: string) {
  const emoji = result === 'pass' ? '\u2705' : '\u274C';
  console.log(`\n${emoji} Variation: ${variation} - ${result.toUpperCase()}`);
  if (notes) {
    console.log(`   Notes: ${notes}`);
  }
}
