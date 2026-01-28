# Done Criteria: discord-for-alerts

**Created:** 2026-01-28
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Replace Pushover notifications with Discord webhooks, sending alerts to multiple channels based on alert type. Rich embeds with actionable links, colour-coded by severity. Pushover service retained but disabled until Discord is proven.

## Channel Mapping

| Channel | Webhook Env Var | Alert Types |
|---------|-----------------|-------------|
| #alerts | `DISCORD_WEBHOOK_ALERTS` | Failures, CAPTCHA, errors, cron errors |
| #opportunities | `DISCORD_WEBHOOK_OPPORTUNITIES` | Vinted arbitrage opportunities |
| #sync-status | `DISCORD_WEBHOOK_SYNC_STATUS` | Sync started, sync complete, pricing updates, offers sent |
| #daily-summary | `DISCORD_WEBHOOK_DAILY_SUMMARY` | End-of-day summaries |

## Success Criteria

### Functional - Service Structure

#### F1: Discord Service Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** File `apps/web/src/lib/notifications/discord.service.ts` exists and exports `DiscordService` class and `discordService` singleton
- **Evidence:** File exists with expected exports
- **Test:** `grep -l "export class DiscordService" apps/web/src/lib/notifications/discord.service.ts`

#### F2: Service Exported from Barrel
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/lib/notifications/index.ts` exports `DiscordService` and `discordService`
- **Evidence:** Barrel file contains exports
- **Test:** `grep "discordService" apps/web/src/lib/notifications/index.ts`

#### F3: isEnabled Method
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.isEnabled()` returns `true` when at least one webhook URL is configured, `false` otherwise
- **Evidence:** Unit test with/without env vars
- **Test:** Unit test `discord.service.test.ts`

#### F4: Channel-Specific isEnabled
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.isChannelEnabled(channel)` returns `true` only if that specific channel's webhook is configured
- **Evidence:** Unit test per channel
- **Test:** Unit test with partial webhook configuration

### Functional - Core Send Method

#### F5: Send Method Signature
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.send(channel, embed)` accepts channel enum and Discord embed object
- **Evidence:** TypeScript compiles without errors
- **Test:** Type check passes

#### F6: Webhook POST
- **Tag:** AUTO_VERIFY
- **Criterion:** Send method POSTs to correct webhook URL based on channel parameter
- **Evidence:** Unit test with mocked fetch verifies correct URL
- **Test:** Unit test mocks fetch, asserts URL matches channel

#### F7: Embed Format
- **Tag:** AUTO_VERIFY
- **Criterion:** POST body contains `{ embeds: [embed] }` with `Content-Type: application/json`
- **Evidence:** Unit test verifies request body structure
- **Test:** Unit test inspects fetch call arguments

### Functional - Typed Alert Methods

#### F8: sendAlert Method
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendAlert({ title, message, priority?, url?, urlTitle? })` sends to #alerts channel with red colour
- **Evidence:** Method exists and sends correct embed
- **Test:** Unit test verifies embed colour is red (0xED4245)

#### F9: sendOpportunity Method
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendOpportunity({ setNumber, setName, vintedPrice, amazonPrice, cogPercent, profit, vintedUrl })` sends to #opportunities channel
- **Evidence:** Method exists with correct signature
- **Test:** Unit test verifies channel and embed structure

#### F10: Opportunity Embed Structure
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunity embed has: title with set number/name linking to Vinted, fields for Vinted price, Amazon price, COG%, Profit, and "View in App" link
- **Evidence:** Embed contains all expected fields
- **Test:** Unit test verifies embed.fields array

#### F11: Opportunity Colour by COG
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunity embed colour is green (0x57F287) for COG < 30%, yellow (0xFEE75C) for 30-40%, orange (0xE67E22) for > 40%
- **Evidence:** Unit tests for each threshold
- **Test:** Unit tests with COG values 25, 35, 45

#### F12: sendSyncStatus Method
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendSyncStatus({ title, message, success?, url? })` sends to #sync-status channel
- **Evidence:** Method exists and routes to correct channel
- **Test:** Unit test verifies channel

#### F13: Sync Status Colour
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status embed colour is green (0x57F287) for success, blue (0x3498DB) for info/started, orange (0xE67E22) for partial success
- **Evidence:** Unit test for each status type
- **Test:** Unit tests with success=true/false/undefined

#### F14: sendDailySummary Method
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendDailySummary({ title, fields })` sends to #daily-summary channel with blue colour
- **Evidence:** Method exists and routes correctly
- **Test:** Unit test verifies channel and colour

#### F15: sendVintedOpportunity Compatibility
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendVintedOpportunity(params)` exists with same signature as `pushoverService.sendVintedOpportunity` for easy migration
- **Evidence:** Method signature matches Pushover
- **Test:** TypeScript compilation, unit test

#### F16: sendVintedCaptchaWarning Compatibility
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendVintedCaptchaWarning()` exists and sends high-priority alert to #alerts
- **Evidence:** Method exists, routes to alerts
- **Test:** Unit test

#### F17: sendVintedDailySummary Compatibility
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendVintedDailySummary(params)` exists with same signature as Pushover
- **Evidence:** Method signature matches Pushover
- **Test:** Unit test

#### F18: sendVintedConsecutiveFailures Compatibility
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendVintedConsecutiveFailures(count)` exists and sends to #alerts
- **Evidence:** Method exists, routes to alerts
- **Test:** Unit test

#### F19: sendSyncSuccess Compatibility
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendSyncSuccess(params)` exists with same signature as Pushover
- **Evidence:** Method signature matches Pushover
- **Test:** Unit test

#### F20: sendSyncFailure Compatibility
- **Tag:** AUTO_VERIFY
- **Criterion:** `discordService.sendSyncFailure(params)` exists with same signature as Pushover
- **Evidence:** Method signature matches Pushover
- **Test:** Unit test

### Functional - Embed Features

#### F21: Timestamp in Footer
- **Tag:** AUTO_VERIFY
- **Criterion:** All embeds include `timestamp` field set to ISO 8601 format
- **Evidence:** Embed has timestamp property
- **Test:** Unit test verifies timestamp exists and is valid ISO string

#### F22: Footer Branding
- **Tag:** AUTO_VERIFY
- **Criterion:** All embeds include footer with text "Hadley Bricks"
- **Evidence:** Embed.footer.text equals expected value
- **Test:** Unit test

#### F23: URL Fields as Hyperlinks
- **Tag:** AUTO_VERIFY
- **Criterion:** When URL provided, embed title is clickable (url property set) OR a field contains markdown link
- **Evidence:** Embed has url property or field with markdown link format
- **Test:** Unit test with url parameter

#### F24: View in App Link
- **Tag:** AUTO_VERIFY
- **Criterion:** Opportunity and alert embeds include a field or description with link to relevant app page using `NEXT_PUBLIC_APP_URL`
- **Evidence:** Embed contains app URL
- **Test:** Unit test verifies URL contains app base URL

### Functional - Integration Points

#### F25: Replace in Amazon Sync Service
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/lib/amazon/amazon-sync.service.ts` imports and uses `discordService` instead of `pushoverService`
- **Evidence:** File imports discordService, no pushoverService calls remain
- **Test:** `grep "discordService" amazon-sync.service.ts && ! grep "pushoverService" amazon-sync.service.ts`

#### F26: Replace in eBay Pricing Cron
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/app/api/cron/ebay-pricing/route.ts` uses `discordService`
- **Evidence:** File imports and calls discordService
- **Test:** grep verification

#### F27: Replace in BrickLink Pricing Cron
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/app/api/cron/bricklink-pricing/route.ts` uses `discordService`
- **Evidence:** File imports and calls discordService
- **Test:** grep verification

#### F28: Replace in Amazon Pricing Cron
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/app/api/cron/amazon-pricing/route.ts` uses `discordService`
- **Evidence:** File imports and calls discordService
- **Test:** grep verification

#### F29: Replace in Vinted Cleanup Cron
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/app/api/cron/vinted-cleanup/route.ts` uses `discordService`
- **Evidence:** File imports and calls discordService
- **Test:** grep verification

#### F30: Replace in Vinted Process Route
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/app/api/arbitrage/vinted/automation/process/route.ts` uses `discordService`
- **Evidence:** File imports and calls discordService
- **Test:** grep verification

#### F31: Replace in eBay Negotiation Service
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/lib/ebay/negotiation.service.ts` uses `discordService`
- **Evidence:** File imports and calls discordService
- **Test:** grep verification

### Error Handling

#### E1: Webhook Failure Logging
- **Tag:** AUTO_VERIFY
- **Criterion:** Failed webhook calls log error with `[DiscordService]` prefix including channel name and error message
- **Evidence:** Console.error called with expected format
- **Test:** Unit test with fetch rejection verifies console.error

#### E2: Non-Blocking on Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** `send()` returns `{ success: false, error: string }` on failure without throwing
- **Evidence:** Method catches errors and returns result object
- **Test:** Unit test with failing fetch verifies no throw, returns error object

#### E3: Missing Webhook Warning
- **Tag:** AUTO_VERIFY
- **Criterion:** When channel webhook not configured, `send()` logs warning `[DiscordService] Channel {name} not configured - skipping` and returns `{ success: true }`
- **Evidence:** Console.log called with expected message
- **Test:** Unit test without webhook env var

#### E4: Invalid JSON Response Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** Non-2xx response from Discord logs the status code and response text
- **Evidence:** Error logged with HTTP status
- **Test:** Unit test with 400 response

#### E5: Network Timeout Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** Fetch has 5-second timeout; timeout logs error and returns failure result
- **Evidence:** AbortController used with 5000ms timeout
- **Test:** Unit test verifies timeout configuration

### Performance

#### P1: Webhook Call Duration
- **Tag:** AUTO_VERIFY
- **Criterion:** Webhook POST completes or times out within 5 seconds
- **Evidence:** Timeout configured at 5000ms
- **Test:** Code inspection for AbortController timeout

#### P2: No Blocking
- **Tag:** AUTO_VERIFY
- **Criterion:** All notification calls in cron routes are awaited but failure does not stop cron execution
- **Evidence:** Calls wrapped in try/catch or using non-throwing send method
- **Test:** Code inspection of cron routes

### Configuration

#### C1: Four Webhook Env Vars
- **Tag:** AUTO_VERIFY
- **Criterion:** Service reads from `DISCORD_WEBHOOK_ALERTS`, `DISCORD_WEBHOOK_OPPORTUNITIES`, `DISCORD_WEBHOOK_SYNC_STATUS`, `DISCORD_WEBHOOK_DAILY_SUMMARY`
- **Evidence:** Constructor accesses these env vars
- **Test:** Unit test with mocked process.env

#### C2: Partial Configuration Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Service works with 1, 2, 3, or 4 webhooks configured; unconfigured channels skip silently with log
- **Evidence:** Unit test with partial env vars
- **Test:** Unit test configures subset of webhooks

#### C3: Constructor Logging
- **Tag:** AUTO_VERIFY
- **Criterion:** On instantiation, service logs which channels are configured and which are missing
- **Evidence:** Console.log shows channel status
- **Test:** Unit test verifies log output

### Pushover Preservation

#### PP1: Pushover Service Retained
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/lib/notifications/pushover.service.ts` still exists and compiles
- **Evidence:** File exists, TypeScript passes
- **Test:** File existence check

#### PP2: Pushover Not Called
- **Tag:** AUTO_VERIFY
- **Criterion:** No production code imports or calls `pushoverService` (only test files may reference it)
- **Evidence:** grep shows no imports in non-test files
- **Test:** `grep -r "pushoverService" apps/web/src --include="*.ts" | grep -v ".test.ts" | grep -v "pushover.service.ts" | wc -l` returns 0

#### PP3: Pushover Exported (Optional)
- **Tag:** AUTO_VERIFY
- **Criterion:** `pushoverService` remains exported from barrel file for potential future use
- **Evidence:** Export statement exists
- **Test:** grep verification

### Testing

#### T1: Unit Test File Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/lib/notifications/__tests__/discord.service.test.ts` exists with tests for all public methods
- **Evidence:** Test file exists with describe blocks for each method
- **Test:** File exists and contains test cases

#### T2: Unit Tests Pass
- **Tag:** AUTO_VERIFY
- **Criterion:** All Discord service unit tests pass
- **Evidence:** `npm test discord.service` exits 0
- **Test:** Run test command

#### T3: Debug Endpoint Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** `apps/web/src/app/api/debug/discord-test/route.ts` exists to test Discord webhooks (similar to pushover-test)
- **Evidence:** File exists with GET handler
- **Test:** File existence check

### Documentation

#### D1: Env Vars in CLAUDE.md
- **Tag:** AUTO_VERIFY
- **Criterion:** CLAUDE.md Environment Variables section includes all 4 Discord webhook vars with descriptions
- **Evidence:** grep finds all 4 vars in CLAUDE.md
- **Test:** grep verification

## Out of Scope

- Discord slash commands / bot interactions
- UI configuration page for webhooks
- Set thumbnail images in embeds (no Rebrickable API integration)
- Message queuing or batching
- Retry logic beyond timeout handling
- Pushover removal (kept disabled for fallback)

## Prerequisites (Before Build)

**Discord webhook URLs must be configured before running `/build-feature`:**

1. Create 4 channels in your Discord server (or reuse existing)
2. For each channel: Edit Channel → Integrations → Webhooks → New Webhook
3. Copy each webhook URL and add to `.env.local`:

```
DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_OPPORTUNITIES=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_SYNC_STATUS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_DAILY_SUMMARY=https://discord.com/api/webhooks/...
```

**Verification:** The build agent will use the debug endpoint to send test messages to each channel. If webhooks aren't configured, testing will be skipped but the build can still proceed (service gracefully handles missing webhooks).

## Dependencies

- Existing notification call sites must remain functional
- Environment variables must be configured in Vercel for production
- **Local `.env.local` must have at least one webhook URL for testing**

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
