# Bricqer messages — investigation outcome (F18)

**Date:** 2026-04-30
**Decision:** No dedicated Bricqer adapter required.

## Findings

### 1. Bricqer API has no message endpoints

`apps/web/src/lib/bricqer/client.ts` exposes:

- `getOrders` / `getAllOrders` / `getOrder` / `getOrderItems`
- `getInventoryItems` / `getInventoryItem` / `reduceInventoryQuantity` / `deleteInventoryItem`
- `getStorageLocations` / `getColors`
- `getBatches` / `getPurchases` / `getPurchaseDetail`
- `getInventoryStats` / `getInventoryProblems`

No `getMessages`, `getInbox`, `getComments` or equivalent. A grep across `apps/web/src/lib/bricqer/` confirms no message/comment/inbox surface in any of `client.ts`, `types.ts`, `adapter.ts`, or the batch-sync service.

### 2. Bricqer relays messages via email instead

The screenshot Chris shared on 2026-04-30 confirmed that messages composed in Bricqer are delivered via the relay address `shops+hadleybricks@bricqer.com`. Both directions land in his Gmail:

- **Outbound (Chris → buyer):** Bricqer sends from `shops+hadleybricks@bricqer.com`; a copy lands in the Gmail Sent folder.
- **Inbound (buyer → Chris):** Buyer replies to that thread; the reply arrives at Chris's Gmail (delivered to either `chrishadley1983@gmail.com` or `chris@hadleybricks.co.uk`, both of which feed the same Gmail inbox).

### 3. Gmail adapter already catches the relay

The Gmail adapter (`OrderIssueGmailAdapter`) was updated as part of F18 to detect Bricqer-relayed messages by matching the sender/recipient address against `shops+hadleybricks@bricqer.com` (and the broader `@bricqer.com` domain). Matched messages are tagged `source='bricqer'` instead of `source='gmail'` so the audit trail still attributes them to the originating channel.

## Decision

No standalone Bricqer adapter (API or CDP) needed. The Gmail adapter covers Bricqer messages end-to-end.

If Bricqer ever ships a public messaging API, or if non-relayed messages start appearing (e.g. in a Bricqer in-app inbox without an email copy), revisit this decision and add a dedicated adapter.

## Verification

After running `npm run test:gmail-coverage`, case **C** (`from:shops+hadleybricks@bricqer.com OR to:shops+hadleybricks@bricqer.com newer_than:90d`) should report PASS. Messages ingested via this path will appear in the issue message log with the `bricqer` source badge.
