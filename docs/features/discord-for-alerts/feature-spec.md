# Feature Specification: discord-for-alerts

**Generated:** 2026-01-28
**Based on:** done-criteria.md (44 criteria)
**Status:** READY_FOR_BUILD

---

## 0. Prerequisites (BEFORE BUILD)

**Discord webhook URLs must be configured in `.env.local` before running `/build-feature`:**

### Setup Steps

1. **In Discord**: Create 4 channels (or reuse existing) in your server:
   - `#hadley-alerts` - for failures, CAPTCHA, errors
   - `#hadley-opportunities` - for Vinted arbitrage opportunities
   - `#hadley-sync-status` - for cron job status
   - `#hadley-daily-summary` - for end-of-day reports

2. **For each channel**: Right-click → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL

3. **Add to `.env.local`**:
   ```
   DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/...
   DISCORD_WEBHOOK_OPPORTUNITIES=https://discord.com/api/webhooks/...
   DISCORD_WEBHOOK_SYNC_STATUS=https://discord.com/api/webhooks/...
   DISCORD_WEBHOOK_DAILY_SUMMARY=https://discord.com/api/webhooks/...
   ```

### Verification

The build agent will use the debug endpoint (`/api/debug/discord-test`) to send test messages. If webhooks aren't configured, the service gracefully skips (logs warning, returns success).

**Minimum for testing:** At least 1 webhook URL configured.

---

## 1. Summary

This feature replaces Pushover notifications with Discord webhooks for all alerting in the Hadley Bricks system. The new Discord service mirrors the existing Pushover service API, routing notifications to 4 channels based on alert type: #alerts (failures), #opportunities (Vinted arbitrage), #sync-status (cron jobs), and #daily-summary (end-of-day reports). Rich embeds with colour-coding by severity, actionable links, and consistent branding will provide an improved notification experience. The Pushover service is retained (disabled) as a fallback.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1-F4: Service Structure** | Create `DiscordService` class with constructor reading 4 webhook env vars, `isEnabled()` and `isChannelEnabled(channel)` methods |
| **F5-F7: Core Send** | `send(channel, embed)` method using fetch with AbortController timeout, JSON body with `{ embeds: [embed] }` |
| **F8-F14: Typed Methods** | `sendAlert`, `sendOpportunity`, `sendSyncStatus`, `sendDailySummary` - each routing to correct channel with appropriate colour |
| **F15-F20: Compatibility** | Mirror Pushover method signatures: `sendVintedOpportunity`, `sendVintedCaptchaWarning`, `sendVintedDailySummary`, `sendVintedConsecutiveFailures`, `sendSyncSuccess`, `sendSyncFailure` |
| **F21-F24: Embed Features** | All embeds include timestamp, footer branding, URL fields as hyperlinks, View in App links |
| **F25-F31: Integration** | Replace `pushoverService` imports with `discordService` in 7 files |
| **E1-E5: Error Handling** | Non-throwing `send()` returning result object, console logging with `[DiscordService]` prefix, 5s timeout |
| **P1-P2: Performance** | AbortController with 5000ms timeout, notification calls don't block cron execution |
| **C1-C3: Configuration** | 4 env vars, partial config works, constructor logs channel status |
| **PP1-PP3: Pushover** | Retain file, remove from call sites, keep barrel export |
| **T1-T3: Testing** | Unit tests for all methods, debug endpoint |
| **D1: Documentation** | Add env vars to CLAUDE.md |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CRON ROUTES                                     │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────┐              │
│  │ ebay-pricing │  │ amazon-pricing │  │bricklink-pricing│              │
│  └──────┬───────┘  └───────┬────────┘  └───────┬────────┘              │
│         │                  │                    │                        │
│  ┌──────┴────────┐  ┌──────┴────────┐  ┌──────┴────────┐              │
│  │vinted-cleanup │  │vinted-process │  │negotiation.svc│              │
│  └──────┬────────┘  └───────┬───────┘  └───────┬───────┘              │
│         │                   │                   │                        │
│  ┌──────┴────────┐                                                      │
│  │amazon-sync.svc│                                                      │
│  └──────┬────────┘                                                      │
│         │                                                                │
├─────────┼────────────────────────────────────────────────────────────────┤
│         │                NOTIFICATION LAYER                              │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     discordService                               │    │
│  │                                                                  │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐         │    │
│  │  │ sendAlert()  │  │sendOpportun()│  │sendSyncStatus()│         │    │
│  │  └──────────────┘  └──────────────┘  └───────────────┘         │    │
│  │                                                                  │    │
│  │  ┌─────────────────────────────────────────────────────────┐    │    │
│  │  │ Compatibility Methods (mirror Pushover signatures)       │    │    │
│  │  │ sendVintedOpportunity, sendSyncSuccess, sendSyncFailure │    │    │
│  │  └─────────────────────────────────────────────────────────┘    │    │
│  │                                                                  │    │
│  └────────────────────────────┬─────────────────────────────────────┘    │
│                               │                                          │
├───────────────────────────────┼──────────────────────────────────────────┤
│                               │               DISCORD API                │
│                               ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     Discord Webhooks                             │    │
│  │                                                                  │    │
│  │  #alerts        #opportunities    #sync-status   #daily-summary │    │
│  │  (failures)     (Vinted deals)    (cron jobs)    (EOD reports)  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Discord Embed Structure

```typescript
interface DiscordEmbed {
  title: string;              // Main title (can be clickable)
  description?: string;       // Main body text
  url?: string;               // Makes title clickable
  color: number;              // Sidebar colour (hex as decimal)
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer: {
    text: string;             // "Hadley Bricks"
  };
  timestamp: string;          // ISO 8601
}
```

### 3.3 Colour Scheme

| Alert Type | Colour | Hex | Decimal |
|------------|--------|-----|---------|
| Error/Failure | Red | #ED4245 | 15548997 |
| Success | Green | #57F287 | 5763719 |
| Info/Started | Blue | #3498DB | 3447003 |
| Warning/Partial | Orange | #E67E22 | 15105570 |
| Opportunity (COG < 30%) | Green | #57F287 | 5763719 |
| Opportunity (COG 30-40%) | Yellow | #FEE75C | 16705372 |
| Opportunity (COG > 40%) | Orange | #E67E22 | 15105570 |

### 3.4 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP client | Native `fetch` | Already used in Pushover service, no extra deps |
| Timeout | AbortController | Standard pattern for fetch timeout |
| Embed library | None | Discord embed is simple JSON, no library needed |
| Error handling | Return result object | Match Pushover pattern, non-throwing |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/lib/notifications/discord.service.ts` | Main Discord service | ~250 |
| `apps/web/src/lib/notifications/__tests__/discord.service.test.ts` | Unit tests | ~350 |
| `apps/web/src/app/api/debug/discord-test/route.ts` | Debug endpoint | ~40 |

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/lib/notifications/index.ts` | Add Discord exports | 3 |
| `apps/web/src/lib/amazon/amazon-sync.service.ts` | Replace pushover with discord | 6 |
| `apps/web/src/app/api/cron/ebay-pricing/route.ts` | Replace import and calls | 8 |
| `apps/web/src/app/api/cron/bricklink-pricing/route.ts` | Replace import and calls | 8 |
| `apps/web/src/app/api/cron/amazon-pricing/route.ts` | Replace import and calls | 8 |
| `apps/web/src/app/api/cron/vinted-cleanup/route.ts` | Replace import and calls | 4 |
| `apps/web/src/app/api/arbitrage/vinted/automation/process/route.ts` | Replace import and calls | 6 |
| `apps/web/src/lib/ebay/negotiation.service.ts` | Replace import and calls | 4 |
| `CLAUDE.md` | Add Discord env vars | 8 |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `pushover.service.ts` | Retained as-is (disabled) |
| Database schema | No tables needed |
| Any UI components | Backend-only feature |

---

## 5. Implementation Details

### 5.1 Discord Service

```typescript
// apps/web/src/lib/notifications/discord.service.ts

export enum DiscordChannel {
  ALERTS = 'alerts',
  OPPORTUNITIES = 'opportunities',
  SYNC_STATUS = 'sync-status',
  DAILY_SUMMARY = 'daily-summary',
}

interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer: { text: string };
  timestamp: string;
}

export class DiscordService {
  private readonly webhooks: Record<DiscordChannel, string | undefined>;
  private readonly timeout = 5000;

  constructor() {
    this.webhooks = {
      [DiscordChannel.ALERTS]: process.env.DISCORD_WEBHOOK_ALERTS,
      [DiscordChannel.OPPORTUNITIES]: process.env.DISCORD_WEBHOOK_OPPORTUNITIES,
      [DiscordChannel.SYNC_STATUS]: process.env.DISCORD_WEBHOOK_SYNC_STATUS,
      [DiscordChannel.DAILY_SUMMARY]: process.env.DISCORD_WEBHOOK_DAILY_SUMMARY,
    };

    // Log channel status
    const configured = Object.entries(this.webhooks)
      .filter(([, url]) => !!url)
      .map(([channel]) => channel);
    const missing = Object.entries(this.webhooks)
      .filter(([, url]) => !url)
      .map(([channel]) => channel);

    if (configured.length > 0) {
      console.log(`[DiscordService] Configured channels: ${configured.join(', ')}`);
    }
    if (missing.length > 0) {
      console.log(`[DiscordService] Missing channels: ${missing.join(', ')}`);
    }
  }

  isEnabled(): boolean {
    return Object.values(this.webhooks).some(url => !!url);
  }

  isChannelEnabled(channel: DiscordChannel): boolean {
    return !!this.webhooks[channel];
  }

  async send(
    channel: DiscordChannel,
    embed: DiscordEmbed
  ): Promise<{ success: boolean; error?: string }> {
    const webhookUrl = this.webhooks[channel];

    if (!webhookUrl) {
      console.log(`[DiscordService] Channel ${channel} not configured - skipping`);
      return { success: true };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        console.error(`[DiscordService] ${channel} failed: HTTP ${response.status} - ${text}`);
        return { success: false, error: `HTTP ${response.status}: ${text}` };
      }

      console.log(`[DiscordService] ${channel} notification sent`);
      return { success: true };
    } catch (err) {
      clearTimeout(timeoutId);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[DiscordService] ${channel} error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  // Helper to create base embed
  private createEmbed(
    title: string,
    color: number,
    options?: {
      description?: string;
      url?: string;
      fields?: Array<{ name: string; value: string; inline?: boolean }>;
    }
  ): DiscordEmbed {
    return {
      title,
      color,
      description: options?.description,
      url: options?.url,
      fields: options?.fields,
      footer: { text: 'Hadley Bricks' },
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 5.2 Typed Alert Methods

```typescript
// Colours
const COLORS = {
  ERROR: 0xED4245,
  SUCCESS: 0x57F287,
  INFO: 0x3498DB,
  WARNING: 0xE67E22,
  OPPORTUNITY_EXCELLENT: 0x57F287, // < 30% COG
  OPPORTUNITY_GOOD: 0xFEE75C,      // 30-40% COG
  OPPORTUNITY_MARGINAL: 0xE67E22, // > 40% COG
};

// sendAlert - goes to #alerts
async sendAlert(params: {
  title: string;
  message: string;
  priority?: number;
  url?: string;
  urlTitle?: string;
}): Promise<{ success: boolean; error?: string }> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  if (params.url) {
    fields.push({
      name: params.urlTitle || 'Link',
      value: `[Click here](${params.url})`,
      inline: false,
    });
  }

  // Add View in App link
  fields.push({
    name: 'Dashboard',
    value: `[View in App](${process.env.NEXT_PUBLIC_APP_URL})`,
    inline: false,
  });

  return this.send(DiscordChannel.ALERTS, this.createEmbed(
    params.title,
    COLORS.ERROR,
    { description: params.message, fields }
  ));
}

// sendOpportunity - goes to #opportunities
async sendOpportunity(params: VintedOpportunityParams): Promise<{ success: boolean; error?: string }> {
  const { setNumber, setName, vintedPrice, amazonPrice, cogPercent, profit, vintedUrl } = params;

  // Colour based on COG%
  const color = cogPercent < 30
    ? COLORS.OPPORTUNITY_EXCELLENT
    : cogPercent <= 40
      ? COLORS.OPPORTUNITY_GOOD
      : COLORS.OPPORTUNITY_MARGINAL;

  return this.send(DiscordChannel.OPPORTUNITIES, this.createEmbed(
    `${setNumber}: ${cogPercent.toFixed(0)}% COG`,
    color,
    {
      description: setName,
      url: vintedUrl,
      fields: [
        { name: 'Vinted', value: `£${vintedPrice.toFixed(2)}`, inline: true },
        { name: 'Amazon', value: `£${amazonPrice.toFixed(2)}`, inline: true },
        { name: 'COG%', value: `${cogPercent.toFixed(0)}%`, inline: true },
        { name: 'Profit', value: `£${profit.toFixed(2)}`, inline: true },
        { name: 'Actions', value: `[View on Vinted](${vintedUrl}) | [View in App](${process.env.NEXT_PUBLIC_APP_URL}/arbitrage/vinted)`, inline: false },
      ],
    }
  ));
}

// sendSyncStatus - goes to #sync-status
async sendSyncStatus(params: {
  title: string;
  message: string;
  success?: boolean;
  url?: string;
}): Promise<{ success: boolean; error?: string }> {
  const color = params.success === true
    ? COLORS.SUCCESS
    : params.success === false
      ? COLORS.WARNING
      : COLORS.INFO;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (params.url) {
    fields.push({ name: 'Details', value: `[View Details](${params.url})`, inline: false });
  }

  return this.send(DiscordChannel.SYNC_STATUS, this.createEmbed(
    params.title,
    color,
    { description: params.message, fields }
  ));
}

// sendDailySummary - goes to #daily-summary
async sendDailySummary(params: {
  title: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
}): Promise<{ success: boolean; error?: string }> {
  return this.send(DiscordChannel.DAILY_SUMMARY, this.createEmbed(
    params.title,
    COLORS.INFO,
    { fields: params.fields }
  ));
}
```

### 5.3 Compatibility Methods (Pushover API)

```typescript
// These mirror Pushover signatures exactly for easy migration

async sendVintedOpportunity(params: VintedOpportunityParams): Promise<void> {
  await this.sendOpportunity(params);
}

async sendVintedCaptchaWarning(): Promise<void> {
  await this.sendAlert({
    title: 'CAPTCHA Detected - Scanner Paused',
    message: 'Vinted CAPTCHA detected. Scanner has been automatically paused.\nPlease resolve the CAPTCHA manually and resume scanning.',
    url: `${process.env.NEXT_PUBLIC_APP_URL}/arbitrage/vinted/automation`,
    urlTitle: 'View Scanner Status',
  });
}

async sendVintedDailySummary(params: VintedDailySummaryParams): Promise<void> {
  await this.sendDailySummary({
    title: 'Vinted Scanner Daily Summary',
    fields: [
      { name: 'Broad Sweeps', value: params.broadSweeps.toString(), inline: true },
      { name: 'Watchlist Scans', value: params.watchlistScans.toString(), inline: true },
      { name: 'Opportunities', value: params.opportunitiesFound.toString(), inline: true },
      { name: 'Near Misses', value: params.nearMissesFound.toString(), inline: true },
    ],
  });
}

async sendVintedConsecutiveFailures(failureCount: number): Promise<void> {
  await this.sendAlert({
    title: 'Vinted Scanner Issues',
    message: `${failureCount} consecutive scan failures detected.\nPlease check scanner status and Vinted accessibility.`,
    url: `${process.env.NEXT_PUBLIC_APP_URL}/arbitrage/vinted/automation`,
    urlTitle: 'View Scanner Status',
  });
}

async sendSyncSuccess(params: SyncSuccessParams): Promise<void> {
  const timeStr = params.verificationTime > 60000
    ? `${Math.round(params.verificationTime / 60000)} min`
    : `${Math.round(params.verificationTime / 1000)} sec`;

  await this.sendSyncStatus({
    title: 'Amazon Sync Complete',
    message: `${params.itemCount} item(s) synced successfully\nPrice verified in ${timeStr}`,
    success: true,
    url: `${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${params.feedId}`,
  });
}

async sendSyncFailure(params: SyncFailureParams): Promise<void> {
  const phaseLabels = {
    price_verification: 'Price verification timeout',
    price_rejected: 'Price feed rejected',
    quantity_rejected: 'Quantity feed rejected',
  };

  await this.sendAlert({
    title: 'Amazon Sync Failed',
    message: `${phaseLabels[params.phase]}: ${params.reason}\n${params.itemCount} item(s) affected`,
    url: `${process.env.NEXT_PUBLIC_APP_URL}/amazon-sync?feed=${params.feedId}`,
    urlTitle: 'View Feed Details',
  });
}

// Generic send for direct pushover.send() calls
async send(params: {
  title?: string;
  message: string;
  priority?: number;
  url?: string;
  urlTitle?: string;
}): Promise<{ success: boolean; error?: string }> {
  // Route based on content/priority
  // priority 1 = alerts, priority -1 = sync-status, default = sync-status
  const channel = params.priority === 1
    ? DiscordChannel.ALERTS
    : DiscordChannel.SYNC_STATUS;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (params.url) {
    fields.push({ name: params.urlTitle || 'Link', value: `[Click here](${params.url})`, inline: false });
  }

  const color = params.priority === 1 ? COLORS.ERROR : COLORS.INFO;

  return this.send(channel, this.createEmbed(
    params.title || 'Notification',
    color,
    { description: params.message, fields }
  ));
}
```

### 5.4 Integration Changes Pattern

Each file changes from:
```typescript
import { pushoverService } from '@/lib/notifications';
// ...
await pushoverService.send({ ... });
```

To:
```typescript
import { discordService } from '@/lib/notifications';
// ...
await discordService.send({ ... });
```

The API is compatible, so minimal changes needed beyond the import.

---

## 6. Build Order

### Step 1: Discord Service Core
1. Create `discord.service.ts` with types and constructor
2. Implement `send()`, `isEnabled()`, `isChannelEnabled()`
3. Add colour constants

### Step 2: Typed Methods
1. Add `sendAlert()`, `sendOpportunity()`, `sendSyncStatus()`, `sendDailySummary()`
2. Add helper `createEmbed()`

### Step 3: Compatibility Layer
1. Add `sendVintedOpportunity()`, `sendVintedCaptchaWarning()`, etc.
2. Add generic `send()` for direct calls
3. Import types from Pushover (SyncFailureParams, SyncSuccessParams, VintedOpportunityParams, VintedDailySummaryParams)

### Step 4: Barrel Export
1. Update `notifications/index.ts` to export Discord service
2. Keep Pushover exports

### Step 5: Unit Tests
1. Create test file with mocked fetch
2. Test each public method
3. Test error handling
4. Test timeout behaviour

### Step 6: Integration - Replace Call Sites
1. amazon-sync.service.ts
2. ebay-pricing cron
3. bricklink-pricing cron
4. amazon-pricing cron
5. vinted-cleanup cron
6. vinted process route
7. negotiation.service.ts

### Step 7: Debug Endpoint
1. Create `/api/debug/discord-test` route
2. Send test message to each configured channel

### Step 8: Documentation
1. Add env vars to CLAUDE.md

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Discord rate limiting | Low | Medium | Alert volume is well under 30/min limit |
| Webhook URL exposure in logs | Medium | High | Ensure URLs never logged, only channel names |
| Message formatting differences | Low | Low | Test embeds manually before wide rollout |

### Mitigations

1. **Rate Limiting**: Current alert volume is ~10-50 per day. Discord allows ~30/min per webhook. No risk.
2. **URL Security**: Only log channel names, not webhook URLs.
3. **Formatting**: Test embed appearance in Discord before replacing all call sites.

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Feature creep (slash commands, reactions) | Out of scope per criteria. Resist. |
| Pushover removal pressure | Keep disabled per criteria. Test Discord first. |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1-F4: Service structure | Yes | High | Standard class pattern |
| F5-F7: Core send | Yes | High | fetch + JSON, simple |
| F8-F14: Typed methods | Yes | High | Building embeds is straightforward |
| F15-F20: Compatibility | Yes | High | Same signatures, route to new methods |
| F21-F24: Embed features | Yes | High | Discord embed spec supports all |
| F25-F31: Integration | Yes | High | Find/replace import + service name |
| E1-E5: Error handling | Yes | High | try/catch + AbortController |
| P1-P2: Performance | Yes | High | 5s timeout, async calls |
| C1-C3: Configuration | Yes | High | process.env, standard pattern |
| PP1-PP3: Pushover | Yes | High | Don't delete, just don't call |
| T1-T3: Testing | Yes | High | Jest + mocked fetch |
| D1: Documentation | Yes | High | Add to CLAUDE.md |

**Overall:** All 44 criteria feasible with planned approach.

---

## 9. Notes for Build Agent

### Key Patterns

1. **Match Pushover exactly** - The compatibility methods should have identical signatures. Import types from pushover.service.ts.

2. **Don't overlog** - Log channel names, not URLs. One log per send (success or failure).

3. **Colours matter** - Users identify alert severity by colour before reading text. Use consistent scheme.

4. **Test in Discord** - After building service, use debug endpoint to verify embeds render correctly before replacing call sites.

### Files to Read First

1. `apps/web/src/lib/notifications/pushover.service.ts` - Copy types and method signatures
2. `apps/web/src/app/api/cron/ebay-pricing/route.ts` - Typical call site pattern

### Test Strategy

1. Unit tests with mocked fetch for all methods
2. Debug endpoint for manual Discord verification
3. TypeScript compilation confirms compatibility

### Verification Commands

```powershell
# Check no pushoverService calls remain (except in pushover files and tests)
grep -r "pushoverService" apps/web/src --include="*.ts" | grep -v ".test.ts" | grep -v "pushover.service.ts"

# Verify discordService is used in all expected files
grep -r "discordService" apps/web/src --include="*.ts" | grep -v ".test.ts" | grep -v "discord.service.ts"

# Run unit tests
npm test discord.service
```
