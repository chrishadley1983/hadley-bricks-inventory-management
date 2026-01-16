# Two-Phase Amazon Sync Implementation Plan

## Problem Statement

When updating both price and quantity on an existing Amazon listing, the current single-feed approach submits both changes simultaneously. Amazon accepts the feed but may apply the changes at different speeds:

- **Quantity**: Typically updates within seconds
- **Price**: Can take anywhere from seconds to **up to 30 minutes** to propagate

This creates a race condition where a customer can purchase at the old (lower) price before the new price is visible, but after the quantity has been incremented.

**Real Example**: Set 40700 was synced with price £44.99 and quantity 1. The feed was accepted at 16:09:30, but the item sold at £33.99 (old price) because the quantity updated before the price propagated.

## Proposed Solution

Implement a **two-phase sync** option that guarantees price is live before quantity is updated:

1. **Phase 1**: Submit price-only update
2. **Verification**: Poll until price is confirmed live on Amazon (up to 30 minutes)
3. **Phase 2**: Submit quantity update (only after price verified)
4. **Failure Notification**: Email alert if verification times out (business-critical)

## Current Architecture

The system already has infrastructure for multi-phase operations:

| Component | Status | Notes |
|-----------|--------|-------|
| Price verification for new SKUs | ✅ Exists | `verifyFeedPrices()` method |
| Status flow with verification | ✅ Exists | `done_verifying` → `verified` |
| Listings API for price queries | ✅ Exists | `AmazonListingsClient.getListing()` |
| Per-item status tracking | ✅ Exists | `amazon_sync_feed_items` table |
| Auto-polling in UI | ✅ Exists | `useSyncFeed()` hook |
| Email notifications | ❌ New | Need to implement email service |

## Implementation Plan

### Phase 0: Email Notification Service (New Pattern)

**Rationale**: With a 30-minute verification window, the user cannot be expected to wait at the screen. Email notifications are essential for:
- Verification timeout failures (business-critical - items stuck without quantity)
- Successful completion confirmation
- Any errors during the two-phase process

**File**: `apps/web/src/lib/email/email.service.ts`

```typescript
/**
 * Email Service
 *
 * Handles transactional email notifications for business-critical events.
 * Uses Resend (recommended) or alternative provider.
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private defaultFrom = 'Hadley Bricks <notifications@hadleybricks.com>';

  async send(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await resend.emails.send({
        from: this.defaultFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      if (error) {
        console.error('[EmailService] Failed to send email:', error);
        return { success: false, error: error.message };
      }

      console.log('[EmailService] Email sent:', data?.id);
      return { success: true };
    } catch (err) {
      console.error('[EmailService] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /**
   * Send two-phase sync failure notification
   */
  async sendTwoPhaseFailure(params: {
    userEmail: string;
    feedId: string;
    failedSkus: string[];
    submittedPrice: number;
    verificationDuration: number;
    itemDetails: Array<{ sku: string; asin: string; setNumber: string; itemName: string }>;
  }): Promise<void> {
    const { userEmail, feedId, failedSkus, submittedPrice, verificationDuration, itemDetails } = params;

    const itemList = itemDetails
      .map(item => `• ${item.setNumber} - ${item.itemName} (SKU: ${item.sku})`)
      .join('\n');

    const html = `
      <h2>⚠️ Amazon Two-Phase Sync Failed</h2>

      <p><strong>Price verification timed out after ${Math.round(verificationDuration / 60000)} minutes.</strong></p>

      <p>The price update was submitted but could not be verified as live on Amazon within the timeout period.
      <strong>Quantity has NOT been updated</strong> to prevent selling at the old price.</p>

      <h3>Affected Items:</h3>
      <pre>${itemList}</pre>

      <h3>Details:</h3>
      <ul>
        <li><strong>Feed ID:</strong> ${feedId}</li>
        <li><strong>Submitted Price:</strong> £${submittedPrice.toFixed(2)}</li>
        <li><strong>Failed SKUs:</strong> ${failedSkus.join(', ')}</li>
      </ul>

      <h3>Required Action:</h3>
      <ol>
        <li>Check Amazon Seller Central to verify if the price is now visible</li>
        <li>If price is correct, manually update quantity or retry sync</li>
        <li>If price is still old, investigate Amazon feed processing</li>
      </ol>

      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}">View Feed Details</a></p>
    `;

    const text = `
Amazon Two-Phase Sync Failed

Price verification timed out after ${Math.round(verificationDuration / 60000)} minutes.

The price update was submitted but could not be verified as live on Amazon.
QUANTITY HAS NOT BEEN UPDATED to prevent selling at the old price.

Affected Items:
${itemList}

Details:
- Feed ID: ${feedId}
- Submitted Price: £${submittedPrice.toFixed(2)}
- Failed SKUs: ${failedSkus.join(', ')}

Required Action:
1. Check Amazon Seller Central to verify if the price is now visible
2. If price is correct, manually update quantity or retry sync
3. If price is still old, investigate Amazon feed processing

View Feed: ${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}
    `;

    await this.send({
      to: userEmail,
      subject: `⚠️ Amazon Sync Failed: Price verification timeout for ${failedSkus.length} item(s)`,
      html,
      text,
    });
  }

  /**
   * Send feed rejection failure notification
   * Used when Amazon rejects the price or quantity feed
   */
  async sendFeedRejectionFailure(params: {
    userEmail: string;
    feedId: string;
    phase: 'price' | 'quantity';
    errorMessage: string;
    errorCode?: string;
    itemDetails: Array<{ sku: string; asin: string; setNumber: string; itemName: string }>;
  }): Promise<void> {
    const { userEmail, feedId, phase, errorMessage, errorCode, itemDetails } = params;

    const itemList = itemDetails
      .map(item => `• ${item.setNumber} - ${item.itemName} (SKU: ${item.sku})`)
      .join('\n');

    const phaseLabel = phase === 'price' ? 'Price' : 'Quantity';
    const consequence = phase === 'price'
      ? 'Neither price nor quantity has been updated.'
      : 'Price was updated but quantity was NOT updated.';

    const html = `
      <h2>❌ Amazon Two-Phase Sync Failed - ${phaseLabel} Feed Rejected</h2>

      <p><strong>Amazon rejected the ${phase} feed.</strong></p>

      <p>${consequence}</p>

      <h3>Error Details:</h3>
      <ul>
        <li><strong>Error:</strong> ${errorMessage}</li>
        ${errorCode ? `<li><strong>Code:</strong> ${errorCode}</li>` : ''}
      </ul>

      <h3>Affected Items:</h3>
      <pre>${itemList}</pre>

      <h3>Required Action:</h3>
      <ol>
        <li>Review the error message above</li>
        <li>Check Amazon Seller Central for additional details</li>
        <li>Fix the issue and retry the sync</li>
      </ol>

      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}">View Feed Details</a></p>
    `;

    const text = `
Amazon Two-Phase Sync Failed - ${phaseLabel} Feed Rejected

Amazon rejected the ${phase} feed.

${consequence}

Error: ${errorMessage}
${errorCode ? `Code: ${errorCode}` : ''}

Affected Items:
${itemList}

Required Action:
1. Review the error message above
2. Check Amazon Seller Central for additional details
3. Fix the issue and retry the sync

View Feed: ${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}
    `;

    await this.send({
      to: userEmail,
      subject: `❌ Amazon Sync Failed: ${phaseLabel} feed rejected`,
      html,
      text,
    });
  }

  /**
   * Send two-phase sync success notification
   */
  async sendTwoPhaseSuccess(params: {
    userEmail: string;
    feedId: string;
    itemCount: number;
    priceVerificationTime: number;
    itemDetails: Array<{ sku: string; asin: string; setNumber: string; itemName: string; price: number }>;
  }): Promise<void> {
    const { userEmail, feedId, itemCount, priceVerificationTime, itemDetails } = params;

    const itemList = itemDetails
      .map(item => `• ${item.setNumber} - ${item.itemName} @ £${item.price.toFixed(2)}`)
      .join('\n');

    const html = `
      <h2>✅ Amazon Two-Phase Sync Complete</h2>

      <p><strong>${itemCount} item(s) successfully synced to Amazon.</strong></p>

      <p>Price was verified live after ${Math.round(priceVerificationTime / 1000)} seconds,
      then quantity was updated.</p>

      <h3>Synced Items:</h3>
      <pre>${itemList}</pre>

      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}">View Feed Details</a></p>
    `;

    await this.send({
      to: userEmail,
      subject: `✅ Amazon Sync Complete: ${itemCount} item(s) synced`,
      html,
    });
  }
}

export const emailService = new EmailService();
```

**File**: `apps/web/src/lib/email/templates/two-phase-failure.tsx` (Optional React Email template)

```tsx
import { Html, Head, Body, Container, Heading, Text, Link, Section, Hr } from '@react-email/components';

interface TwoPhaseFailureEmailProps {
  feedId: string;
  failedSkus: string[];
  submittedPrice: number;
  verificationDuration: number;
  itemDetails: Array<{ sku: string; setNumber: string; itemName: string }>;
  appUrl: string;
}

export function TwoPhaseFailureEmail(props: TwoPhaseFailureEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Arial, sans-serif' }}>
        <Container>
          <Heading as="h2">⚠️ Amazon Two-Phase Sync Failed</Heading>
          {/* ... template content ... */}
        </Container>
      </Body>
    </Html>
  );
}
```

**Database**: Add user email preferences table (optional, for future)

```sql
-- User notification preferences (future enhancement)
CREATE TABLE user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_two_phase_failure BOOLEAN DEFAULT true,
  email_two_phase_success BOOLEAN DEFAULT true,
  email_address TEXT, -- Override from auth.users if needed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

**Environment Variables**:
```bash
# Email (Resend recommended - $0 for 3,000 emails/month)
RESEND_API_KEY=re_xxxxxxxxxxxx
NOTIFICATION_EMAIL=chris@hadleybricks.com  # Fallback recipient
```

**Estimated effort**: 2 hours

---

### Phase 0.5: Pushover Notification Service (Optional)

**Rationale**: With a 30-minute verification window, instant push notifications provide faster awareness than email alone. Pushover delivers notifications to desktop (free) and mobile (£5 one-time purchase).

**Benefits over email:**
- **Instant delivery** - notifications appear within seconds
- **Desktop + mobile** - see notifications wherever you are
- **Low cost** - desktop free, mobile is one-time £5 purchase
- **No domain setup** - works immediately with API key

**File**: `apps/web/src/lib/notifications/pushover.service.ts`

```typescript
/**
 * Pushover Notification Service
 *
 * Sends instant push notifications for business-critical events.
 * Works with Pushover desktop (free) and mobile app (£5 one-time).
 *
 * Setup:
 * 1. Create account at https://pushover.net/
 * 2. Get your User Key from the dashboard
 * 3. Create an Application and get API Token
 * 4. Download desktop client: https://pushover.net/clients/desktop
 * 5. Optional: Buy mobile app (£5) for phone notifications
 */

interface PushoverMessage {
  message: string;
  title?: string;
  /** Priority: -2 (lowest) to 2 (emergency). Default: 0 (normal) */
  priority?: -2 | -1 | 0 | 1 | 2;
  /** URL to include in the notification */
  url?: string;
  /** Title for the URL */
  urlTitle?: string;
  /** Notification sound (see Pushover docs for options) */
  sound?: string;
}

interface PushoverResponse {
  status: number;
  request: string;
  errors?: string[];
}

export class PushoverService {
  private readonly apiUrl = 'https://api.pushover.net/1/messages.json';
  private readonly userKey: string;
  private readonly apiToken: string;
  private readonly enabled: boolean;

  constructor() {
    this.userKey = process.env.PUSHOVER_USER_KEY || '';
    this.apiToken = process.env.PUSHOVER_API_TOKEN || '';
    this.enabled = !!(this.userKey && this.apiToken);

    if (!this.enabled) {
      console.log('[PushoverService] Disabled - missing PUSHOVER_USER_KEY or PUSHOVER_API_TOKEN');
    }
  }

  /**
   * Check if Pushover is configured and enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a push notification via Pushover
   */
  async send(params: PushoverMessage): Promise<{ success: boolean; error?: string }> {
    if (!this.enabled) {
      console.log('[PushoverService] Skipping - not configured');
      return { success: true }; // Silent skip if not configured
    }

    try {
      const body = new URLSearchParams({
        token: this.apiToken,
        user: this.userKey,
        message: params.message,
        ...(params.title && { title: params.title }),
        ...(params.priority !== undefined && { priority: params.priority.toString() }),
        ...(params.url && { url: params.url }),
        ...(params.urlTitle && { url_title: params.urlTitle }),
        ...(params.sound && { sound: params.sound }),
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const data: PushoverResponse = await response.json();

      if (data.status !== 1) {
        console.error('[PushoverService] Failed:', data.errors);
        return { success: false, error: data.errors?.join(', ') || 'Unknown error' };
      }

      console.log('[PushoverService] Notification sent:', data.request);
      return { success: true };
    } catch (err) {
      console.error('[PushoverService] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /**
   * Send two-phase sync failure notification
   */
  async sendSyncFailure(params: {
    feedId: string;
    itemCount: number;
    reason: string;
    phase: 'price_verification' | 'price_rejected' | 'quantity_rejected';
  }): Promise<void> {
    const { feedId, itemCount, reason, phase } = params;

    const phaseLabels = {
      price_verification: 'Price verification timeout',
      price_rejected: 'Price feed rejected',
      quantity_rejected: 'Quantity feed rejected',
    };

    await this.send({
      title: `⚠️ Amazon Sync Failed`,
      message: `${phaseLabels[phase]}: ${reason}\n${itemCount} item(s) affected`,
      priority: 1, // High priority - will play sound/vibrate
      url: `${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}`,
      urlTitle: 'View Feed Details',
      sound: 'siren', // Urgent sound for failures
    });
  }

  /**
   * Send two-phase sync success notification
   */
  async sendSyncSuccess(params: {
    feedId: string;
    itemCount: number;
    verificationTime: number;
  }): Promise<void> {
    const { feedId, itemCount, verificationTime } = params;
    const timeStr = verificationTime > 60000
      ? `${Math.round(verificationTime / 60000)} min`
      : `${Math.round(verificationTime / 1000)} sec`;

    await this.send({
      title: `✅ Amazon Sync Complete`,
      message: `${itemCount} item(s) synced successfully\nPrice verified in ${timeStr}`,
      priority: 0, // Normal priority
      url: `${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${feedId}`,
      urlTitle: 'View Feed Details',
    });
  }
}

export const pushoverService = new PushoverService();
```

**Integration with existing email notifications:**

Update the two-phase service method to send both email AND Pushover:

```typescript
// In submitTwoPhaseFeed method, update failure handlers:

// After emailService.sendTwoPhaseFailure(...):
await pushoverService.sendSyncFailure({
  feedId: priceFeed.id,
  itemCount: verificationResult.failedSkus.length,
  reason: `Price not visible after ${priceVerificationTimeout / 60000} mins`,
  phase: 'price_verification',
});

// After emailService.sendFeedRejectionFailure(...) for price:
await pushoverService.sendSyncFailure({
  feedId: priceFeed.id,
  itemCount: itemsWithPriceChanges.length,
  reason: currentPriceFeed.error_message || 'Feed rejected',
  phase: 'price_rejected',
});

// After emailService.sendFeedRejectionFailure(...) for quantity:
await pushoverService.sendSyncFailure({
  feedId: quantityFeed.id,
  itemCount: aggregatedItems.length,
  reason: currentQuantityFeed.error_message || 'Feed rejected',
  phase: 'quantity_rejected',
});

// After emailService.sendTwoPhaseSuccess(...):
await pushoverService.sendSyncSuccess({
  feedId: priceFeed.id,
  itemCount: aggregatedItems.length,
  verificationTime: verificationResult.verificationDuration ?? 0,
});
```

**Environment Variables**:
```bash
# Pushover (Optional - desktop free, mobile £5 one-time)
# Get these from https://pushover.net/
PUSHOVER_USER_KEY=uxxxxxxxxxxxxxxxxxxxxxxxxxx
PUSHOVER_API_TOKEN=axxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Setup Instructions**:
1. Create account at https://pushover.net/
2. Copy your **User Key** from the dashboard
3. Click "Create an Application/API Token"
   - Name: "Hadley Bricks"
   - Type: Application
4. Copy the **API Token**
5. Add both to `.env.local`
6. Download desktop client: https://pushover.net/clients/desktop
7. (Optional) Purchase mobile app for phone notifications

**Estimated effort**: 30 minutes

---

### Phase 1: Database Schema Updates

**File**: `supabase/migrations/YYYYMMDD_two_phase_sync.sql`

```sql
-- Add two-phase sync tracking columns to amazon_sync_feeds
ALTER TABLE amazon_sync_feeds
ADD COLUMN sync_mode TEXT DEFAULT 'single' CHECK (sync_mode IN ('single', 'two_phase')),
ADD COLUMN phase TEXT CHECK (phase IN ('price', 'quantity', NULL)),
ADD COLUMN parent_feed_id UUID REFERENCES amazon_sync_feeds(id),
ADD COLUMN price_verified_at TIMESTAMPTZ;

-- Add index for parent-child feed relationships
CREATE INDEX idx_amazon_sync_feeds_parent ON amazon_sync_feeds(parent_feed_id)
WHERE parent_feed_id IS NOT NULL;

-- Add two-phase tracking to feed items
ALTER TABLE amazon_sync_feed_items
ADD COLUMN phase TEXT CHECK (phase IN ('price', 'quantity', NULL)),
ADD COLUMN price_feed_id UUID REFERENCES amazon_sync_feeds(id),
ADD COLUMN quantity_feed_id UUID REFERENCES amazon_sync_feeds(id);

COMMENT ON COLUMN amazon_sync_feeds.sync_mode IS 'single = current behavior, two_phase = price then quantity';
COMMENT ON COLUMN amazon_sync_feeds.phase IS 'For two_phase mode: which phase this feed represents';
COMMENT ON COLUMN amazon_sync_feeds.parent_feed_id IS 'Links quantity feed to its parent price feed';
```

**Estimated effort**: 30 minutes

---

### Phase 2: Type Definitions

**File**: `apps/web/src/lib/amazon/amazon-sync.types.ts`

Add new types:

```typescript
/**
 * Sync mode determines how price and quantity updates are submitted
 */
export type SyncMode = 'single' | 'two_phase';

/**
 * Phase within a two-phase sync
 */
export type SyncPhase = 'price' | 'quantity';

/**
 * Extended feed status for two-phase sync
 */
export type TwoPhaseStatus =
  | 'price_pending'      // Price feed not yet submitted
  | 'price_submitted'    // Price feed submitted to Amazon
  | 'price_processing'   // Amazon processing price feed
  | 'price_verifying'    // Waiting for price to propagate
  | 'price_verified'     // Price confirmed live - ready for quantity
  | 'quantity_pending'   // Quantity feed not yet submitted
  | 'quantity_submitted' // Quantity feed submitted
  | 'quantity_processing'// Amazon processing quantity
  | 'completed'          // Both phases complete
  | 'failed';            // Either phase failed

/**
 * Options for feed submission
 */
export interface SubmitFeedOptions {
  dryRun: boolean;
  syncMode: SyncMode;
  /** For two_phase: max time to wait for price verification (ms) */
  priceVerificationTimeout?: number;
  /** For two_phase: polling interval for price verification (ms) */
  priceVerificationInterval?: number;
}

/**
 * Two-phase sync result
 */
export interface TwoPhaseResult {
  priceFeed: SyncFeed;
  quantityFeed?: SyncFeed;
  status: TwoPhaseStatus;
  priceVerifiedAt?: string;
  error?: string;
}
```

**Estimated effort**: 20 minutes

---

### Phase 3: Service Layer - Price-Only Feed Builder

**File**: `apps/web/src/lib/amazon/amazon-sync.service.ts`

Add new private method to build price-only patches:

```typescript
/**
 * Build patches for price-only update (Phase 1 of two-phase sync)
 *
 * Only updates purchasable_offer, excludes fulfillment_availability
 */
private buildPriceOnlyPatches(item: AggregatedQueueItem): ListingsFeedPatch[] {
  const purchasableOffer = buildPurchasableOffer(item.price);

  return [
    {
      op: 'replace',
      path: '/attributes/purchasable_offer',
      value: purchasableOffer,
    },
    // Also update list_price for UK marketplace compliance
    {
      op: 'replace',
      path: '/attributes/list_price',
      value: [
        {
          marketplace_id: 'A1F83G8C2ARO7P',
          currency: 'GBP',
          value_with_tax: item.price,
        },
      ],
    },
  ];
}

/**
 * Build patches for quantity-only update (Phase 2 of two-phase sync)
 */
private buildQuantityOnlyPatches(item: AggregatedQueueItem): ListingsFeedPatch[] {
  return [
    {
      op: 'replace',
      path: '/attributes/fulfillment_availability',
      value: [
        {
          fulfillment_channel_code: 'DEFAULT',
          quantity: item.totalQuantity,
        },
      ],
    },
  ];
}
```

**Estimated effort**: 30 minutes

---

### Phase 4: Service Layer - Two-Phase Submit Method

**File**: `apps/web/src/lib/amazon/amazon-sync.service.ts`

Add new public method:

```typescript
/**
 * Submit feed using two-phase sync (price first, then quantity)
 *
 * Flow:
 * 1. Submit price-only feed
 * 2. Poll until Amazon accepts
 * 3. Verify price is live on listing
 * 4. Submit quantity-only feed
 * 5. Poll until complete
 *
 * @param options - Submission options
 * @returns Result with both feeds and final status
 */
async submitTwoPhaseFeed(options: {
  dryRun: boolean;
  userEmail: string; // Required for failure notifications
  priceVerificationTimeout?: number;
  priceVerificationInterval?: number;
}): Promise<TwoPhaseResult> {
  const {
    dryRun,
    userEmail,
    priceVerificationTimeout = 30 * 60 * 1000, // 30 minutes default (Amazon can take this long)
    priceVerificationInterval = 30 * 1000,      // 30 seconds between checks
  } = options;

  console.log('[AmazonSyncService] Starting two-phase sync');

  // Get credentials and aggregated items
  const credentials = await this.getAmazonCredentials();
  if (!credentials) {
    throw new Error('Amazon credentials not configured');
  }

  const aggregatedItems = await this.getAggregatedQueueItems();
  if (aggregatedItems.length === 0) {
    throw new Error('No items in the sync queue');
  }

  // Filter to only items with price changes
  const itemsWithPriceChanges = aggregatedItems.filter(item => {
    // If we don't know the Amazon price, assume it needs updating
    if (item.existingAmazonQuantity === 0 && !item.isNewSku) {
      return true;
    }
    // TODO: Could add more sophisticated price change detection here
    return true;
  });

  // ========================================
  // PHASE 1: Price-only feed
  // ========================================
  console.log('[AmazonSyncService] Phase 1: Submitting price-only feed');

  const priceFeed = await this.submitPriceOnlyFeed(
    itemsWithPriceChanges,
    credentials,
    dryRun
  );

  if (dryRun) {
    return {
      priceFeed,
      status: 'price_verified', // Dry run assumes success
    };
  }

  // Poll until price feed is processed
  let currentPriceFeed = priceFeed;
  while (
    currentPriceFeed.status === 'submitted' ||
    currentPriceFeed.status === 'processing'
  ) {
    await this.delay(5000); // 5 second polling interval
    currentPriceFeed = await this.pollFeedStatus(priceFeed.id);
  }

  if (currentPriceFeed.status === 'error' || currentPriceFeed.error_count > 0) {
    // Send failure email for price feed rejection
    await emailService.sendFeedRejectionFailure({
      userEmail,
      feedId: priceFeed.id,
      phase: 'price',
      errorMessage: currentPriceFeed.error_message || 'Price feed rejected by Amazon',
      itemDetails: itemsWithPriceChanges.map(item => ({
        sku: item.amazonSku,
        asin: item.asin,
        setNumber: item.itemNames[0]?.split(' ')[0] ?? item.asin,
        itemName: item.itemNames[0] ?? 'Unknown',
      })),
    });

    return {
      priceFeed: currentPriceFeed,
      status: 'failed',
      error: currentPriceFeed.error_message || 'Price feed failed. Email notification sent.',
    };
  }

  // ========================================
  // VERIFICATION: Wait for price to be live
  // ========================================
  console.log('[AmazonSyncService] Verifying prices are live on Amazon');

  const verificationResult = await this.waitForPriceVerification(
    itemsWithPriceChanges,
    priceVerificationTimeout,
    priceVerificationInterval
  );

  if (!verificationResult.allVerified) {
    // Update price feed status
    await this.updateFeedRecord(priceFeed.id, {
      status: 'verification_failed',
      error_message: `Price verification failed for: ${verificationResult.failedSkus.join(', ')}`,
    });

    // CRITICAL: Send failure email notification
    // Items are stuck - price submitted but quantity NOT updated
    await emailService.sendTwoPhaseFailure({
      userEmail,
      feedId: priceFeed.id,
      failedSkus: verificationResult.failedSkus,
      submittedPrice: itemsWithPriceChanges[0]?.price ?? 0,
      verificationDuration: priceVerificationTimeout,
      itemDetails: itemsWithPriceChanges.map(item => ({
        sku: item.amazonSku,
        asin: item.asin,
        setNumber: item.itemNames[0]?.split(' ')[0] ?? item.asin, // Extract set number
        itemName: item.itemNames[0] ?? 'Unknown',
      })),
    });

    return {
      priceFeed: await this.getFeed(priceFeed.id),
      status: 'failed',
      error: `Price not visible on Amazon after ${priceVerificationTimeout / 60000} minutes. Email notification sent.`,
    };
  }

  // Update price feed as verified
  await this.updateFeedRecord(priceFeed.id, {
    status: 'verified',
    price_verified_at: new Date().toISOString(),
  });

  // ========================================
  // PHASE 2: Quantity-only feed
  // ========================================
  console.log('[AmazonSyncService] Phase 2: Submitting quantity-only feed');

  const quantityFeed = await this.submitQuantityOnlyFeed(
    aggregatedItems,
    credentials,
    priceFeed.id
  );

  // Poll until quantity feed is processed
  let currentQuantityFeed = quantityFeed;
  while (
    currentQuantityFeed.status === 'submitted' ||
    currentQuantityFeed.status === 'processing'
  ) {
    await this.delay(5000);
    currentQuantityFeed = await this.pollFeedStatus(quantityFeed.id);
  }

  // Handle quantity feed result
  if (currentQuantityFeed.status === 'done') {
    // SUCCESS: Clear queue and send success email
    await this.clearQueueForFeed(aggregatedItems);

    await emailService.sendTwoPhaseSuccess({
      userEmail,
      feedId: priceFeed.id,
      itemCount: aggregatedItems.length,
      priceVerificationTime: verificationResult.verificationDuration ?? 0,
      itemDetails: aggregatedItems.map(item => ({
        sku: item.amazonSku,
        asin: item.asin,
        setNumber: item.itemNames[0]?.split(' ')[0] ?? item.asin,
        itemName: item.itemNames[0] ?? 'Unknown',
        price: item.price,
      })),
    });

    return {
      priceFeed: await this.getFeed(priceFeed.id),
      quantityFeed: currentQuantityFeed,
      status: 'completed',
      priceVerifiedAt: verificationResult.verifiedAt,
    };
  }

  // FAILURE: Quantity feed was rejected - price IS updated but quantity is NOT
  // This is a critical state that requires manual intervention
  await emailService.sendFeedRejectionFailure({
    userEmail,
    feedId: quantityFeed.id,
    phase: 'quantity',
    errorMessage: currentQuantityFeed.error_message || 'Quantity feed rejected by Amazon',
    itemDetails: aggregatedItems.map(item => ({
      sku: item.amazonSku,
      asin: item.asin,
      setNumber: item.itemNames[0]?.split(' ')[0] ?? item.asin,
      itemName: item.itemNames[0] ?? 'Unknown',
    })),
  });

  return {
    priceFeed: await this.getFeed(priceFeed.id),
    quantityFeed: currentQuantityFeed,
    status: 'failed',
    priceVerifiedAt: verificationResult.verifiedAt,
    error: 'Quantity feed failed. Price was updated but quantity was NOT. Email notification sent.',
  };
}

/**
 * Wait for prices to be verified on Amazon
 */
private async waitForPriceVerification(
  items: AggregatedQueueItem[],
  timeout: number,
  interval: number
): Promise<{
  allVerified: boolean;
  verifiedAt?: string;
  verificationDuration?: number;
  failedSkus: string[];
}> {
  const credentials = await this.getAmazonCredentials();
  if (!credentials) {
    throw new Error('No credentials');
  }

  const listingsClient = new AmazonListingsClient(credentials);
  const startTime = Date.now();
  const failedSkus: string[] = [];

  while (Date.now() - startTime < timeout) {
    let allVerified = true;
    failedSkus.length = 0;

    for (const item of items) {
      const listing = await listingsClient.getListing(
        item.amazonSku,
        'A1F83G8C2ARO7P',
        ['offers']
      );

      const offer = listing?.offers?.find(
        (o) => o.marketplaceId === 'A1F83G8C2ARO7P'
      );
      const livePrice = offer?.price?.amount;

      if (livePrice === undefined || Math.abs(livePrice - item.price) > 0.01) {
        allVerified = false;
        failedSkus.push(item.amazonSku);
        console.log(
          `[AmazonSyncService] Price not yet live for ${item.amazonSku}: ` +
          `expected ${item.price}, got ${livePrice}`
        );
      }
    }

    if (allVerified) {
      return {
        allVerified: true,
        verifiedAt: new Date().toISOString(),
        verificationDuration: Date.now() - startTime,
        failedSkus: [],
      };
    }

    console.log(
      `[AmazonSyncService] Waiting for price verification... ` +
      `(${Math.round((Date.now() - startTime) / 1000)}s elapsed)`
    );
    await this.delay(interval);
  }

  return {
    allVerified: false,
    failedSkus,
  };
}

/**
 * Submit price-only feed
 */
private async submitPriceOnlyFeed(
  items: AggregatedQueueItem[],
  credentials: AmazonCredentials,
  dryRun: boolean
): Promise<SyncFeed> {
  // Create feed record
  const feed = await this.createFeedRecord(items.length, dryRun);

  // Update with sync mode and phase
  await this.updateFeedRecord(feed.id, {
    sync_mode: 'two_phase',
    phase: 'price',
  });

  // Build price-only payload
  const messages = items.map((item, index) => ({
    messageId: index + 1,
    sku: item.amazonSku,
    operationType: 'PATCH' as const,
    productType: item.productType,
    patches: this.buildPriceOnlyPatches(item),
  }));

  const payload = {
    header: {
      sellerId: credentials.sellerId,
      version: '2.0',
      issueLocale: 'en_GB',
    },
    messages,
  };

  // Update feed with payload
  await this.updateFeedRecord(feed.id, {
    request_payload: payload as unknown as Json,
  });

  // Create feed items
  await this.createFeedItems(feed.id, items);

  if (dryRun) {
    // Validate via Listings API
    const listingsClient = new AmazonListingsClient(credentials);
    const validationResults = await this.validateItems(listingsClient, items);
    await this.updateFeedItemsWithValidation(feed.id, validationResults);

    const successCount = validationResults.filter(r => r.status === 'VALID').length;
    await this.updateFeedRecord(feed.id, {
      status: 'done',
      success_count: successCount,
      error_count: validationResults.length - successCount,
      completed_at: new Date().toISOString(),
    });
  } else {
    // Submit to Amazon
    const feedsClient = new AmazonFeedsClient(credentials);
    const { feedId, feedDocumentId } = await feedsClient.submitFeed(
      payload,
      'JSON_LISTINGS_FEED',
      ['A1F83G8C2ARO7P']
    );

    await this.updateFeedRecord(feed.id, {
      amazon_feed_id: feedId,
      amazon_feed_document_id: feedDocumentId,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });
  }

  return this.getFeed(feed.id);
}

/**
 * Submit quantity-only feed
 */
private async submitQuantityOnlyFeed(
  items: AggregatedQueueItem[],
  credentials: AmazonCredentials,
  parentFeedId: string
): Promise<SyncFeed> {
  // Create feed record linked to parent
  const { data: feed, error } = await this.supabase
    .from('amazon_sync_feeds')
    .insert({
      user_id: this.userId,
      feed_type: 'JSON_LISTINGS_FEED',
      is_dry_run: false,
      marketplace_id: 'A1F83G8C2ARO7P',
      status: 'pending',
      total_items: items.length,
      sync_mode: 'two_phase',
      phase: 'quantity',
      parent_feed_id: parentFeedId,
    })
    .select()
    .single();

  if (error || !feed) {
    throw new Error(`Failed to create quantity feed: ${error?.message}`);
  }

  // Build quantity-only payload
  const messages = items.map((item, index) => ({
    messageId: index + 1,
    sku: item.amazonSku,
    operationType: 'PATCH' as const,
    productType: item.productType,
    patches: this.buildQuantityOnlyPatches(item),
  }));

  const payload = {
    header: {
      sellerId: credentials.sellerId,
      version: '2.0',
      issueLocale: 'en_GB',
    },
    messages,
  };

  // Update feed with payload
  await this.updateFeedRecord(feed.id, {
    request_payload: payload as unknown as Json,
  });

  // Create feed items
  await this.createFeedItems(feed.id, items);

  // Submit to Amazon
  const feedsClient = new AmazonFeedsClient(credentials);
  const { feedId, feedDocumentId } = await feedsClient.submitFeed(
    payload,
    'JSON_LISTINGS_FEED',
    ['A1F83G8C2ARO7P']
  );

  await this.updateFeedRecord(feed.id, {
    amazon_feed_id: feedId,
    amazon_feed_document_id: feedDocumentId,
    status: 'submitted',
    submitted_at: new Date().toISOString(),
  });

  return this.getFeed(feed.id);
}

/**
 * Helper to add delay
 */
private delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Estimated effort**: 2-3 hours

---

### Phase 5: API Route Updates

**File**: `apps/web/src/app/api/amazon/sync/submit/route.ts`

Update to support sync mode:

```typescript
const SubmitSchema = z.object({
  dryRun: z.boolean().default(false),
  syncMode: z.enum(['single', 'two_phase']).default('single'),
  priceVerificationTimeout: z.number().optional(),
  priceVerificationInterval: z.number().optional(),
});

export async function POST(request: NextRequest) {
  // ... auth check ...

  const body = await request.json();
  const { dryRun, syncMode, priceVerificationTimeout, priceVerificationInterval } =
    SubmitSchema.parse(body);

  const service = new AmazonSyncService(supabase, user.id);

  if (syncMode === 'two_phase') {
    const result = await service.submitTwoPhaseFeed({
      dryRun,
      priceVerificationTimeout,
      priceVerificationInterval,
    });
    return NextResponse.json({ data: result });
  }

  // Existing single-phase logic
  const feed = await service.submitFeed(dryRun);
  return NextResponse.json({ data: feed });
}
```

**Estimated effort**: 30 minutes

---

### Phase 6: React Hooks Update

**File**: `apps/web/src/hooks/use-amazon-sync.ts`

Add new mutation:

```typescript
/**
 * Submit sync feed with two-phase option
 */
export function useSubmitSyncFeed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options: {
      dryRun: boolean;
      syncMode?: 'single' | 'two_phase';
      priceVerificationTimeout?: number;
    }) => {
      const response = await fetch('/api/amazon/sync/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit sync');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.queue() });
      queryClient.invalidateQueries({ queryKey: amazonSyncKeys.feeds() });
    },
  });
}
```

**Estimated effort**: 30 minutes

---

### Phase 7: UI Updates

**File**: `apps/web/src/components/features/amazon-sync/SyncSubmitControls.tsx`

Add sync mode toggle:

```tsx
interface SyncSubmitControlsProps {
  queueCount: number;
  onSubmit: (options: { dryRun: boolean; syncMode: 'single' | 'two_phase' }) => void;
  isSubmitting: boolean;
}

export function SyncSubmitControls({
  queueCount,
  onSubmit,
  isSubmitting
}: SyncSubmitControlsProps) {
  const [dryRun, setDryRun] = useState(true);
  const [syncMode, setSyncMode] = useState<'single' | 'two_phase'>('single');

  return (
    <div className="flex items-center gap-4">
      {/* Existing dry run toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="dry-run"
          checked={dryRun}
          onCheckedChange={setDryRun}
        />
        <Label htmlFor="dry-run">Dry Run</Label>
      </div>

      {/* New sync mode toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="two-phase"
          checked={syncMode === 'two_phase'}
          onCheckedChange={(checked) =>
            setSyncMode(checked ? 'two_phase' : 'single')
          }
        />
        <Label htmlFor="two-phase" className="flex items-center gap-1">
          Two-Phase Sync
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                Submits price update first, waits for confirmation,
                then submits quantity. Prevents selling at old price
                when updating both.
              </p>
            </TooltipContent>
          </Tooltip>
        </Label>
      </div>

      <Button
        onClick={() => onSubmit({ dryRun, syncMode })}
        disabled={isSubmitting || queueCount === 0}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {syncMode === 'two_phase' ? 'Syncing (2-Phase)...' : 'Syncing...'}
          </>
        ) : (
          <>Submit {queueCount} item{queueCount !== 1 ? 's' : ''}</>
        )}
      </Button>
    </div>
  );
}
```

**Estimated effort**: 1 hour

---

### Phase 8: Status Display Updates

**File**: `apps/web/src/components/features/amazon-sync/SyncFeedStatus.tsx`

Add two-phase status indicators:

```tsx
const TWO_PHASE_STATUS_CONFIG: Record<string, StatusConfig> = {
  price_pending: {
    icon: Clock,
    label: 'Price Pending',
    color: 'text-gray-500'
  },
  price_submitted: {
    icon: Upload,
    label: 'Price Submitted',
    color: 'text-blue-500'
  },
  price_processing: {
    icon: Loader2,
    label: 'Price Processing',
    color: 'text-blue-500',
    animate: true
  },
  price_verifying: {
    icon: Search,
    label: 'Verifying Price',
    color: 'text-amber-500',
    animate: true
  },
  price_verified: {
    icon: CheckCircle,
    label: 'Price Verified',
    color: 'text-green-500'
  },
  quantity_submitted: {
    icon: Upload,
    label: 'Quantity Submitted',
    color: 'text-blue-500'
  },
  quantity_processing: {
    icon: Loader2,
    label: 'Quantity Processing',
    color: 'text-blue-500',
    animate: true
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    color: 'text-green-500'
  },
};
```

**Estimated effort**: 45 minutes

---

### Phase 9: Feed History Updates

**File**: `apps/web/src/components/features/amazon-sync/SyncFeedDetailDialog.tsx`

Show linked feeds for two-phase sync:

```tsx
// In the dialog content, add section for linked feeds
{feed.sync_mode === 'two_phase' && (
  <div className="space-y-2">
    <h4 className="font-medium">Two-Phase Sync</h4>
    <div className="text-sm text-muted-foreground">
      <p>Phase: {feed.phase === 'price' ? 'Price Update' : 'Quantity Update'}</p>
      {feed.phase === 'quantity' && feed.parent_feed_id && (
        <p>
          Price Feed:
          <Button variant="link" className="p-0 h-auto" onClick={() => openFeed(feed.parent_feed_id)}>
            View
          </Button>
        </p>
      )}
      {feed.price_verified_at && (
        <p>Price Verified: {formatDateTime(feed.price_verified_at)}</p>
      )}
    </div>
  </div>
)}
```

**Estimated effort**: 30 minutes

---

## Testing Plan

### Unit Tests

1. **Price-only patch builder**
   - Verify only `purchasable_offer` and `list_price` in patches
   - Verify no `fulfillment_availability` in patches

2. **Quantity-only patch builder**
   - Verify only `fulfillment_availability` in patches
   - Verify no `purchasable_offer` in patches

3. **Price verification logic**
   - Mock Listings API responses
   - Test price match detection (0.01 tolerance)
   - Test timeout behavior

### Integration Tests

1. **Two-phase submit flow**
   - Mock Amazon APIs
   - Verify two separate feeds created
   - Verify parent-child relationship
   - Verify queue cleared only after both complete

2. **Failure scenarios**
   - Price feed fails → no quantity feed submitted
   - Price verification times out → appropriate error
   - Quantity feed fails → price feed shows as verified

### Manual Testing

1. Submit single item with two-phase sync
2. Verify price visible on Amazon before quantity appears
3. Test with multiple items sharing same ASIN
4. Test dry run mode
5. Test cancellation mid-flow

---

## Configuration Options

Add to environment/settings:

```typescript
// Default settings (can be overridden per-submission)
const TWO_PHASE_DEFAULTS = {
  // Max time to wait for price verification (30 minutes - Amazon can be slow)
  priceVerificationTimeout: 30 * 60 * 1000,

  // How often to check if price is live (30 seconds - balance between responsiveness and API limits)
  priceVerificationInterval: 30 * 1000,

  // Whether two-phase is the default mode
  defaultSyncMode: 'single' as const,

  // Email notifications (always enabled for two-phase due to long duration)
  emailOnSuccess: true,
  emailOnFailure: true, // CRITICAL - must always be true
};
```

**Environment Variables**:
```bash
# Email Service (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx

# Notification recipient (uses auth email if not set)
NOTIFICATION_EMAIL=chris@hadleybricks.com

# App URL for email links
NEXT_PUBLIC_APP_URL=https://app.hadleybricks.com

# Pushover (Optional - instant push notifications)
# Desktop client is free, mobile app is £5 one-time
# Get keys from https://pushover.net/
PUSHOVER_USER_KEY=uxxxxxxxxxxxxxxxxxxxxxxxxxx
PUSHOVER_API_TOKEN=axxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Rollout Plan

### Stage 1: Behind Feature Flag
- Add `ENABLE_TWO_PHASE_SYNC` environment variable
- Only show UI toggle when enabled
- Test with real Amazon account

### Stage 2: Opt-in
- Enable toggle for all users
- Default to single-phase (current behavior)
- Monitor for issues

### Stage 3: Default (Optional)
- Consider making two-phase the default
- Allow opt-out for speed when price unchanged

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Price verification timeout | Item stuck in queue | Clear timeout with option to retry or fall back to single-phase |
| Amazon API rate limits | Verification fails | Exponential backoff, batch verification requests |
| Double API costs | Higher Amazon fees | Only use when price actually changed |
| UI complexity | User confusion | Clear tooltips, good status indicators |
| Longer sync time | Delayed listings | Show progress, allow background processing |

---

## Future Enhancements

1. **Smart detection**: Only use two-phase when price actually changed
2. **Background processing**: Allow user to navigate away during verification
3. **Batch optimization**: Single verification call for multiple SKUs
4. **Configurable per-item**: Allow two-phase for specific high-value items only
5. **Price change threshold**: Only two-phase for significant price increases

---

## Summary

| Phase | Description | Effort |
|-------|-------------|--------|
| 0 | **Email notification service (NEW)** | 2 hours |
| 0.5 | **Pushover notification service (Optional)** | 30 min |
| 1 | Database schema | 30 min |
| 2 | Type definitions | 20 min |
| 3 | Price-only builder | 30 min |
| 4 | Two-phase service method | 2-3 hours |
| 5 | API route updates | 30 min |
| 6 | React hooks | 30 min |
| 7 | UI toggle | 1 hour |
| 8 | Status display | 45 min |
| 9 | Feed history | 30 min |
| **Total** | | **8.5-9.5 hours** |

Plus testing: ~2-3 hours

**Total estimated effort: 10.5-12.5 hours**

---

## Key Design Decisions

### Why 30-minute timeout?
Amazon's price propagation can take up to 30 minutes in worst-case scenarios. A shorter timeout would cause false failures.

### Why email notifications?
With a 30-minute verification window, users cannot reasonably wait at the screen. Email notifications ensure:
1. **Failures are not missed** - business-critical items stuck without quantity
2. **Success confirmation** - peace of mind that sync completed
3. **Actionable information** - direct links to resolve issues

### Why Resend?
- Free tier: 3,000 emails/month (more than sufficient)
- Simple API, good TypeScript support
- No domain verification required for testing
- Easy migration to alternatives if needed

### Why Pushover (optional)?
- **Instant delivery** - push notifications arrive within seconds vs email delivery delays
- **Low cost** - desktop client is free, mobile app is £5 one-time (not subscription)
- **No infrastructure** - works immediately with API keys, no domain/server setup
- **Graceful degradation** - if not configured, silently skips without errors
- **Complements email** - both channels work together for redundancy

### Background Processing Consideration
With a 30-minute timeout, we **cannot** hold an HTTP request open. Two options:

**Option A: Supabase Edge Function (Recommended)**
- Move two-phase logic to a Supabase Edge Function
- API triggers the function and returns immediately
- Edge Function runs up to 400 seconds (can chain if needed)
- Sends email on completion/failure

**Option B: Client-side polling with server state**
- API submits price feed and returns immediately
- Client polls feed status
- Server-side cron job handles verification and quantity submission
- More complex but uses existing infrastructure

For MVP, we'll implement **Option A** - the Edge Function approach keeps the logic self-contained and the timeout is handled server-side.
