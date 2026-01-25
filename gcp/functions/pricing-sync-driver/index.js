/**
 * Cloud Function: Pricing Sync Driver
 *
 * A driver function that handles resumable pricing sync jobs.
 * Called by Cloud Scheduler, it loops calling the Vercel API endpoint
 * every 30 seconds until the job returns { complete: true }.
 *
 * Supports job types:
 * - ebay-pricing: /api/cron/ebay-pricing
 * - bricklink-pricing: /api/cron/bricklink-pricing
 * - amazon-pricing: /api/cron/amazon-pricing
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const functions = require('@google-cloud/functions-framework');

// Configuration
const APP_URL = process.env.APP_URL || 'https://hadley-bricks.vercel.app';
const MAX_ITERATIONS = 120; // 120 * 30s = 1 hour max
const ITERATION_DELAY_MS = 30000; // 30 seconds between calls

// Job type to endpoint mapping
const JOB_ENDPOINTS = {
  'ebay-pricing': '/api/cron/ebay-pricing',
  'bricklink-pricing': '/api/cron/bricklink-pricing',
  'amazon-pricing': '/api/cron/amazon-pricing',
};

/**
 * Get the CRON_SECRET from Secret Manager
 */
async function getCronSecret() {
  const client = new SecretManagerServiceClient();
  const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;

  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/hadley-bricks-cron-secret/versions/latest`,
  });

  return version.payload.data.toString('utf8');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the Vercel API endpoint
 */
async function callEndpoint(endpoint, cronSecret) {
  const url = `${APP_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await response.json();

  return {
    status: response.status,
    body,
  };
}

/**
 * Main Cloud Function entry point
 *
 * Expected request body from Cloud Scheduler:
 * {
 *   "jobType": "ebay-pricing" | "bricklink-pricing" | "amazon-pricing"
 * }
 */
functions.http('pricingSyncDriver', async (req, res) => {
  const startTime = Date.now();
  const { jobType } = req.body || {};

  console.log(`[PricingSyncDriver] Starting job: ${jobType}`);

  // Validate job type
  if (!jobType || !JOB_ENDPOINTS[jobType]) {
    console.error(`[PricingSyncDriver] Invalid job type: ${jobType}`);
    res.status(400).json({
      error: 'Invalid job type',
      validTypes: Object.keys(JOB_ENDPOINTS),
    });
    return;
  }

  const endpoint = JOB_ENDPOINTS[jobType];

  try {
    // Get the cron secret from Secret Manager
    const cronSecret = await getCronSecret();
    console.log(`[PricingSyncDriver] Retrieved cron secret`);

    let iteration = 0;
    let lastResponse = null;

    // Loop until complete or max iterations reached
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      const iterationStart = Date.now();

      console.log(
        `[PricingSyncDriver] Iteration ${iteration}/${MAX_ITERATIONS} for ${jobType}`
      );

      try {
        const result = await callEndpoint(endpoint, cronSecret);
        lastResponse = result;

        console.log(
          `[PricingSyncDriver] Response: status=${result.status}, complete=${result.body?.complete}`
        );

        // Check if job is complete
        if (result.body?.complete === true) {
          const totalDuration = Date.now() - startTime;
          console.log(
            `[PricingSyncDriver] Job ${jobType} complete! Total duration: ${Math.round(totalDuration / 1000)}s, iterations: ${iteration}`
          );

          res.status(200).json({
            success: true,
            jobType,
            iterations: iteration,
            totalDurationMs: totalDuration,
            lastResponse: result.body,
          });
          return;
        }

        // Check for non-200 responses
        if (result.status !== 200) {
          console.warn(
            `[PricingSyncDriver] Non-200 response: ${result.status}, will retry...`
          );
        }
      } catch (fetchError) {
        console.error(
          `[PricingSyncDriver] Fetch error on iteration ${iteration}:`,
          fetchError.message
        );
        // Continue to next iteration after delay
      }

      // Wait before next iteration
      const iterationDuration = Date.now() - iterationStart;
      const delayNeeded = Math.max(0, ITERATION_DELAY_MS - iterationDuration);

      if (delayNeeded > 0 && iteration < MAX_ITERATIONS) {
        console.log(`[PricingSyncDriver] Waiting ${delayNeeded}ms before next iteration...`);
        await sleep(delayNeeded);
      }
    }

    // Max iterations reached without completion
    const totalDuration = Date.now() - startTime;
    console.warn(
      `[PricingSyncDriver] Max iterations (${MAX_ITERATIONS}) reached for ${jobType}`
    );

    res.status(200).json({
      success: false,
      warning: 'Max iterations reached',
      jobType,
      iterations: MAX_ITERATIONS,
      totalDurationMs: totalDuration,
      lastResponse: lastResponse?.body,
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[PricingSyncDriver] Fatal error:`, error);

    res.status(500).json({
      error: error.message || 'Unknown error',
      jobType,
      totalDurationMs: totalDuration,
    });
  }
});
