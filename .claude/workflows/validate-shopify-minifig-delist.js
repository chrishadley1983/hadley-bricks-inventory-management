export const meta = {
  name: 'validate-shopify-minifig-delist',
  description:
    'E2E validation that a Shopify sale of a minifig-sync item de-lists it from eBay (inline) and Bricqer/BrickLink+BrickOwl (queued) — code audit + live-data checks + adversarial refutation (PRs #462/#463).',
  whenToUse:
    'After deploying the Shopify→eBay/Bricqer minifig de-listing fix, or any time you want to confirm no Shopify-sold minifig is left live on BL/BO/eBay.',
  phases: [
    { title: 'Audit code path' },
    { title: 'Validate live state' },
    { title: 'Adversarial check' },
  ],
};

// Shared context handed to every agent (they have NO conversation history).
const CTX = `
CONTEXT — Hadley Bricks inventory app (Next.js, Supabase, Bricqer/eBay/Shopify).
Repo root: C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management
Run shell via the Bash tool (Git Bash). Supabase: load the execute_sql MCP tool via
ToolSearch "select:mcp__plugin_supabase_supabase__execute_sql", project_id =
"modjoikyuhqzouxvieua". USER_ID = "4b6e94b4-661c-4462-9d14-b21df7d51e5b".

THE FIX UNDER TEST (PR #462 then corrected by #463, commit a91f5908):
When a "Minifig Sync" item (inventory_items.source='Minifig Sync', sku like
HB-MF-<bricqerItemId>-U-<loc>) sells on Shopify, ShopifyOrderSyncService.
delistMinifigSale (apps/web/src/lib/shopify/order-sync.service.ts) must de-list it
on the two channels the generic Shopify flow can't reach:
  1. eBay — INLINE: it calls EbayDelistingService.endListing(userId, ebay_listing_id)
     (apps/web/src/lib/ebay/ebay-delisting.service.ts). Minifig-sync eBay listings
     live ONLY on inventory_items.ebay_listing_id / minifig_sync_items, NOT in
     platform_listings, so the SKU-based de-list can't find them. Idempotent.
  2. Bricqer — QUEUED: it inserts ONE minifig_removal_queue row
     {sold_on:'SHOPIFY', remove_from:'BRICQER', status:'PENDING'} for the executor
     /api/cron/minifigs/process-removals, which calls BricqerClient
     .reduceInventoryQuantity → Bricqer auto-de-lists BrickLink + BrickOwl once
     remainingQuantity hits 0. Then it sets minifig_sync_items.listing_status='SOLD_SHOPIFY'.
  3. eBay safety-net (PR #464): process-removals ALSO withdraws the eBay offer +
     deletes the eBay inventory item for sold_on='SHOPIFY' rows, so the eBay end
     gets a retried cron attempt on top of the inline one (covers a failed inline end).
WHY ONE ROW (not two): there is a UNIQUE index uq_removal_queue_sync_order =
UNIQUE(minifig_sync_id, order_id). Two removal rows for one order would violate it
(that was the #462 bug — the EBAY row's insert threw). So eBay is handled INLINE and
only ONE BRICQER row is queued. The order pollers' upsert onConflict
'minifig_sync_id,order_id' depends on this same index, so it must NOT be widened.
HB-listed SETS (not minifigs) are out of scope — they live in platform_listings.

PRIMARY INVARIANT: "removed from Bricqer" == Bricqer inventory item
remainingQuantity = 0 (or the lot is deleted / 404). The itemLinks "active" flag is
link CONFIG and can stay true even after the channel listing is zeroed — do NOT
treat active=true alone as a failure; judge on remainingQuantity.

Bricqer live read (JSON): cd apps/web && npx tsx scripts/_check-bricqer-item.ts <bricqerItemId>
  → {id, legoId, remainingQuantity, reservedQuantity, links:[{provider,externalData,active}], ...}
eBay live read (authoritative ListingStatus): cd apps/web && npx tsx scripts/_check-ebay-listings-status.ts
  (hardcoded to items 178188796525 [set #1002] and 177913124242 [minifig #1003]).
A bricqer_item_id is the number in the sku: HB-MF-<ID>-U-...  (e.g. HB-MF-24893-U-309-1 → 24893).

KNOWN HISTORICAL CASE: minifig sh0300 (bricqer 24893, eBay 177913124242, order #1003)
sold on Shopify 2026-06-22 BEFORE the fix and was remediated BY HAND: Bricqer qty set
to 0, listing_status='SOLD_SHOPIFY'. Its eBay listing 177913124242 was already ended
(ListingStatus=Completed) on 2026-05-31, weeks before the sale. So #1003 is safe but is
NOT positive proof the automated path works — it predates the fix.
`;

const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true if this aspect of the E2E chain is sound' },
    summary: { type: 'string', description: '1-2 sentence verdict' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'concrete facts: file:line, query result, or script output' },
    problems: { type: 'array', items: { type: 'string' }, description: 'gaps/risks/failures (empty array if none)' },
  },
  required: ['ok', 'summary', 'evidence', 'problems'],
};

phase('Audit code path');
const codeFindings = await parallel([
  () =>
    agent(
      `${CTX}\nTASK: Audit the WRITE path. Read apps/web/src/lib/shopify/order-sync.service.ts (delistMinifigSale + its caller in processOrderLineItems). Confirm that for a Shopify sale of a minifig-sync item it:
(1) resolves minifig_sync_items by ebay_sku == inventory sku; returns/no-ops for non-minifig items;
(2) ends the eBay listing INLINE via this.delisting.endListing(userId, ebay_listing_id) when ebay_listing_id is set, counting result.ebayListingsEnded and not throwing on failure;
(3) queues EXACTLY ONE minifig_removal_queue row with sold_on='SHOPIFY', remove_from='BRICQER', status='PENDING' when bricqer_item_id is set — guarded by an existence check on (minifig_sync_id, order_id) and tolerant of error code 23505;
(4) sets minifig_sync_items.listing_status='SOLD_SHOPIFY';
(5) does NOT attempt a second (EBAY) queue row (which would violate uq_removal_queue_sync_order).
Cite file:line. Set ok=false if it could insert two rows, miss the eBay end, or throw and abort.`,
      { label: 'audit:write-path', phase: 'Audit code path', schema: FINDING }
    ),
  () =>
    agent(
      `${CTX}\nTASK: Audit the EXECUTE path + scheduling. (a) Read apps/web/src/app/api/cron/minifigs/process-removals/route.ts and apps/web/src/lib/bricqer/client.ts: confirm a PENDING row with remove_from='BRICQER' triggers BricqerClient.reduceInventoryQuantity(bricqer_item_id,1) (PATCH remainingQuantity → max(0,current-1)), that sold_on='SHOPIFY' maps the sync row to listing_status='SOLD_SHOPIFY', and that per-row failures are caught and the row is left PENDING (so it retries next run). (b) Confirm BOTH ends of the chain are actually SCHEDULED in prod: search for how /api/cron/minifigs/process-removals and the Shopify order sync (full-sync Step 5b and/or /api/cron/shopify-orders) are triggered (gcp/*.ps1 Cloud Scheduler, vercel.json crons, or jobs/*.py). Cite file + cadence. Set ok=false if the Bricqer reduction can be silently skipped or if either side has no scheduled trigger.`,
      { label: 'audit:execute-path', phase: 'Audit code path', schema: FINDING }
    ),
]);

phase('Validate live state');
const liveFinding = await agent(
  `${CTX}\nTASK: Validate LIVE state against Supabase + Bricqer + eBay.
1. SELECT sku, set_number, sold_order_id, sold_date FROM inventory_items
   WHERE sold_platform='shopify' AND source='Minifig Sync';
2. For EACH sku: extract bricqer_item_id (digits in HB-MF-<ID>-...), run
   cd apps/web && npx tsx scripts/_check-bricqer-item.ts <ID>
   and assert remainingQuantity === 0 (or 404 / notFound). remainingQuantity >= 1 = LIVE
   DOUBLE-SELL LEAK → ok=false, name it in problems.
3. For each, check minifig_sync_items.listing_status (by bricqer_item_id) is a sold marker
   (SOLD_SHOPIFY / SOLD_EBAY / SOLD_BRICQER), not PUBLISHED / NOT_LISTED.
4. Run cd apps/web && npx tsx scripts/_check-ebay-listings-status.ts and confirm the minifig
   listing 177913124242 ListingStatus=Completed (ended, not live). Note QuantitySold.
5. Stuck-queue check: SELECT * FROM minifig_removal_queue WHERE sold_on='SHOPIFY'; and
   SELECT count(*) FROM minifig_removal_queue WHERE sold_on='SHOPIFY' AND status='PENDING'
   AND created_at < now() - interval '2 hours' (must be 0). Report each SHOPIFY row's
   status/executed_at/error_message.
Put concrete query output + script JSON in evidence. ok=true only if every Shopify-sold minifig is Bricqer-zeroed, its eBay listing is ended, and there are no stuck PENDING removals.`,
  { label: 'live:data', phase: 'Validate live state', schema: FINDING }
);

phase('Adversarial check');
const adversarial = await agent(
  `${CTX}\nADVERSARIAL TASK: REFUTE "a minifig-sync item sold on Shopify is reliably de-listed from eBay (inline) and Bricqer/BL+BO (queued), end to end." Default ok=false unless you satisfy yourself there is no real, unmitigated hole. Probe with code reads + Supabase + the check scripts:
- Inline-eBay has NO retry: if endListing throws/returns failure, the eBay listing stays live and the item is already SOLD (won't reprocess). How likely, how bad, and is it surfaced (result.errors / Discord)? Compare to how HB sets already de-list eBay (same limitation?).
- SKU/linkage fragility: a Shopify-sold minifig whose minifig_sync_items.ebay_sku != inventory.sku, or null, makes delistMinifigSale a silent no-op. Any such rows among LISTED minifig-sync items?
- One-row design: confirm only a BRICQER row is queued and the eBay path is inline — verify there is genuinely no second insert that would hit uq_removal_queue_sync_order. Also: does the inline eBay end happen even when the Bricqer row already exists (idempotent re-run)?
- BL/BO propagation: does Bricqer remainingQuantity=0 actually end the BrickLink/BrickOwl listing? Reason from the mechanism; if a safe read path to BL lot 510491518 / BO 206809735 exists, probe it, else state residual risk.
- Backfill: any minifig sold on Shopify BEFORE the fix still live? (sh0300/#1003 is known-remediated — verify, don't assume.)
Report ok=true ONLY if none of these is a real, unmitigated problem. List every concrete risk in problems with a severity tag.`,
  { label: 'adversarial:refute', phase: 'Adversarial check', schema: FINDING }
);

const findings = [...codeFindings.filter(Boolean), liveFinding, adversarial].filter(Boolean);
const blocking = findings.filter((f) => f && f.ok === false);
const verdict = blocking.length === 0 ? 'PASS' : 'FAIL';
log(`E2E validation ${verdict} — ${findings.length} checks, ${blocking.length} blocking issue(s)`);

return {
  verdict,
  checks: findings.map((f) => ({ ok: f.ok, summary: f.summary, problems: f.problems })),
  problems: findings.flatMap((f) => f.problems || []),
  findings,
};
