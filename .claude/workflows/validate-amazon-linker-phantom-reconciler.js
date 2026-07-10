export const meta = {
  name: 'validate-amazon-linker-phantom-reconciler',
  description: 'E2E validation of PR #472 — Amazon order-linker double-link fix + phantom-stock reconciler — against live production',
  whenToUse: 'After merging + deploying PR #472, to confirm the linker guard is deployed, no genuine phantom stock remains, no new double-links exist, and the reconciler detection is correct (no false positives on UUID-form / null-ASIN sold units).',
  phases: [
    { title: 'Validate', detail: 'live-data + code checks of the linker fix and reconciler' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN' },
    { title: 'Synthesize', detail: 'PASS/FAIL report' },
  ],
};

const PROJECT = 'modjoikyuhqzouxvieua';

const CTX = `
CONTEXT — validate PR #472 "fix(amazon): prevent order-linker double-links + add phantom-stock reconciler" on PRODUCTION (now merged to main + deployed).

THE BUG it fixes: AmazonInventoryLinkingService linked one physical inventory unit SOLD against TWO Amazon orders (picklist mode trusted a pre-populated inventory_item_id without checking it was already consumed). That left a sibling unit stuck LISTED = "phantom stock" (reads in-stock in HB, Inactive/qty-0 on Amazon).

THE FIX (two parts):
  (3) matchOrderItemToInventory picklist mode now calls a guard isUnitClaimableBy(unit, orderItem, order): only auto-accept a pre-linked unit when it is still claimable by THIS order — NOT already SOLD to a different order (sold_order_id != this order's string AND != its platform_orders.id uuid) and NOT linked to another order_item. Otherwise it falls through to ASIN matching (fresh unit) or queues. Idempotent for re-processing the same order.
  (4) reconcilePhantomStock() — alert-only reconciler wired into the full-sync cron (apps/web/src/app/api/cron/full-sync/route.ts, Step 4b-2) + manual route POST /api/amazon/inventory-linking/reconcile-phantoms. CORRECTED detection: an order is "covered" when a SOLD unit references it by EITHER the Amazon order string OR the internal platform_orders UUID; coverage is quantity-aware; a current LISTED/BACKLOG unit is only flagged when its listing_date <= the uncovered sale date (chronology guard). FIFO assignment caps matches at the number of missing units.

WHY the corrected detection matters (the two blind spots that caused FALSE orphans in the earlier naive signature): some sold units store sold_order_id as the platform_orders UUID (not the Amazon string), and some older sold units have amazon_asin = null. A per-ASIN string-only matcher misses those and wrongly flags their in-stock siblings. The reconciler must NOT flag such cases.

ALREADY-DONE manual cleanup (these must show as resolved, NOT as phantoms):
  - 12 genuine phantoms were marked SOLD earlier: SKUs N3542 (76226), N2628+N2629 (75354), N3248 (76068), HB-NEW-60311-MMJ1D161 (60311), N3710 (31114), U3684 (76186), HB-NEW-60254-MKQUEYZN-001 (60254), N3204 (40491), HB-NEW-40524-MK5TWDWJ-009 (40524), one Easter Bunny unit (40271, qty-2 order 026-6799712), N3403 (40512).
  - amazon_asin backfilled on N1355 (30205 -> B00XVP2CCK), N1911 (40687 -> B0D4C6LBTF), N2260 (41951 -> B09BNVMR9L) — these are FALSE orphans (already sold), must NOT be flagged.
  - One Easter Bunny unit (HB-NEW-40271-...-002) is legitimately still LISTED (real stock) — must NOT be flagged.
  - KNOWN WATCH ITEM: order 204-0658844 (asin B09BNZ6VV4 / set 42132, dated 2026-06-28) was placed the same day and may still be unlinked because the live order-linker cron had not yet processed it. If the corrected detection flags ONLY this order (or nothing), that is acceptable (it self-resolves on the next linker run) — it is NOT a defect. Any OTHER genuine phantom is a FAIL.

FOLLOW-UP (PR #473, also merged + deployed): the first E2E run caught N3248 (set 76068, ASIN B01KOL5HZW) reverted SOLD->LISTED while still holding its own sold_order_id (a "self-covering" phantom invisible to the per-ASIN coverage math). TWO things were done: (a) N3248 was re-marked SOLD (so it must now be status=SOLD); (b) reconcilePhantomStock() gained a dedicated self-covering detection pass — units status IN ('LISTED','BACKLOG') with a non-null amazon sold_order_id, excluding returns (returned_from_item_id) and Cancelled orders (both id forms) — returned in result.selfCovering + alerted. So prod must now have ZERO self-covering units, and the deployed code must contain that pass.

FOLLOW-UP-2 (PR #474, merged + deployed): the prior runs flagged N3248 (76068) as a recurring self-covering phantom — but it was actually a RETURN. Order 203-5271308 was REFUNDED (-£29.59, Amazon return), so the unit legitimately came back into stock and the price-sync was correctly re-listing it. A SECOND unit, HB-NEW-40524-MK5TWDWJ-009 (40524 Sunflowers), was likewise marked SOLD against a REFUNDED order (205-7341309, refund -£10.39). Both were RESET to status=LISTED with their sold_* fields CLEARED (per Chris: returns relist immediately). So now: N3248 and the 40524 -009 unit must be status=LISTED with sold_order_id=NULL (NOT SOLD — they are returns, this is correct, not a regression). reconcilePhantomStock() was made REFUND-AWARE: it fetches refunded order ids (amazon_transactions.transaction_type ~ 'refund', both Amazon-string and platform_orders UUID forms) and excludes them from BOTH the per-ASIN uncovered-order detection AND the self-covering detection. So a returned-and-relisted unit (LISTED + a sold_order_id whose order was refunded) must NOT be flagged. A "self-covering" phantom only counts when the order was NOT refunded/cancelled and the unit is not a return.

FOLLOW-UP-3 (final 40524 correction): the previous run correctly caught that HB-NEW-40524-MK5TWDWJ-009 (listed 2026-03-11) could NOT have shipped against the refunded order 205-7341309 (2026-02-28, listed-date is AFTER it) — it actually fits the GENUINE non-refunded sale 202-5992424-6333123 (40524, 2026-03-13, two Shipment txns +£12.23, NO refund) which was uncovered. So -009 has now been marked SOLD against 202-5992424 (correct genuine sale). FINAL EXPECTED 40524 STATE: -008 SOLD (204-2438196), **-009 SOLD (202-5992424)**, N3659 LISTED; the refunded order 205-7341309 correctly has NO unit sold against it. So the ONLY refunded-return unit still LISTED is N3248 (76068). The refund-aware corrected-detection SQL must now return ZERO genuine phantoms except the same-day 42132 watch item (204-0658844).

ENVIRONMENT: read-only validation. Use the Supabase MCP tool — load it with ToolSearch query "select:mcp__plugin_supabase_supabase__execute_sql" then call it with project_id "${PROJECT}". Code lives in the working tree on branch main (already merged): apps/web/src/lib/amazon/amazon-inventory-linking.service.ts, apps/web/src/app/api/cron/full-sync/route.ts, apps/web/src/app/api/amazon/inventory-linking/reconcile-phantoms/route.ts. Use Read/Grep for code, git log for deploy state. DO NOT mutate any data.

CORRECTED-DETECTION SQL (the source of truth for "genuine phantom"):
  with shipped as (
    select po.id po_id, po.platform_order_id, po.order_date, sum(oi.quantity) qty, min(trim(oi.item_number)) asin
    from order_items oi join platform_orders po on po.id=oi.order_id
    where po.platform='amazon' and oi.quantity>0 and coalesce(po.internal_status,'')<>'Cancelled' and oi.item_number is not null
    group by po.id, po.platform_order_id, po.order_date),
  x as (select s.*, (select count(*) from inventory_items ii where ii.sold_order_id=s.platform_order_id or ii.sold_order_id=s.po_id::text) units_linked from shipped s)
  select x.platform_order_id, x.asin, x.order_date::date d, (x.qty-x.units_linked) short, ii.sku, ii.set_number, ii.listing_date
  from x join inventory_items ii on ii.amazon_asin=x.asin and ii.status in ('LISTED','BACKLOG') and ii.listing_date is not null and ii.listing_date <= x.order_date::date
  where x.units_linked < x.qty order by x.order_date desc;

RULES: Be INDEPENDENT + ADVERSARIAL. Run your own SQL, do not assume. Distinguish a GENUINE phantom (chronology-plausible in-stock unit for a truly-uncovered sale) from the known watch item and from false orphans (UUID-form / null-ASIN coverage).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'problem'],
        properties: { item: { type: 'string' }, problem: { type: 'string' } },
      },
    },
  },
};

const DIMENSIONS = [
  {
    key: 'deployed',
    prompt: `Confirm the fix is deployed. (1) git: "git log origin/main --oneline -3" — HEAD must be the PR #472 squash-merge "fix(amazon): prevent order-linker double-links + add phantom-stock reconciler (#472)". (2) Grep the service file on main for "isUnitClaimableBy" — it must exist AND be called inside the picklist branch of matchOrderItemToInventory (the pre-link is only accepted when the guard returns true). (3) "reconcilePhantomStock" must exist in the service and the full-sync cron route must call it (Step 4b-2). (4) the route apps/web/src/app/api/amazon/inventory-linking/reconcile-phantoms/route.ts must exist. (5) prod liveness: POST https://hadley-bricks-inventory-management.vercel.app/api/amazon/inventory-linking/reconcile-phantoms?alert=false returns 401 (auth-gated => deployed), and homepage returns 200/307. Verdict PASS only if ALL present.`,
  },
  {
    key: 'no-genuine-phantoms',
    prompt: `Run the CORRECTED-DETECTION SQL (in CONTEXT) against project ${PROJECT}. Every row is a current LISTED/BACKLOG unit whose ASIN has an uncovered sale that postdates its listing = a genuine phantom candidate. EXPECTED: zero rows, OR only the known watch item (order 204-0658844 / asin B09BNZ6VV4 / set 42132, dated 2026-06-28, which may still be unlinked pending the next linker run). Verdict PASS if 0 rows or only that watch item; WARN if only the watch item is present and still unlinked; FAIL if ANY other genuine phantom row exists — list each (order id, asin, sku, listing_date vs sale date).`,
  },
  {
    key: 'cleanup-intact',
    prompt: `Confirm the cleanup is intact in its FINAL corrected state. (a) ELEVEN units must be status=SOLD with a non-null sold_order_id: the 10 original non-refunded fixed units PLUS HB-NEW-40524-MK5TWDWJ-009 (now SOLD against the GENUINE non-refunded sale 202-5992424-6333123 — verify that order has Shipment txns and NO refund). (b) N3248 (76068) is the ONLY refunded return still in stock: status=LISTED with sold_order_id=NULL (its order 203-5271308 was refunded — LISTED is correct, NOT a regression). (c) Exactly ONE Easter Bunny unit (40271 / B079QYB8DZ) LISTED and one SOLD. (d) N1355/N1911/N2260 amazon_asin set (B00XVP2CCK/B0D4C6LBTF/B09BNVMR9L) and SOLD. Query inventory_items directly; confirm 203-5271308 IS refunded and 202-5992424 is NOT, via amazon_transactions. Verdict FAIL only if: a non-refunded fixed unit reverted to LISTED, N3248 is still SOLD or still carries sold_order_id, the -009 genuine sale is left uncovered, an asin-backfill is null, or the bunny split is wrong.`,
  },
  {
    key: 'self-covering-closed',
    prompt: `Confirm the self-covering blind spot is closed AND refund-aware (PR #473 + #474). (1) DATA: run SQL for LISTED/BACKLOG units with sold_order_id not null, sold_platform='amazon', returned_from_item_id null; then EXCLUDE any whose order was Cancelled OR REFUNDED (amazon_transactions.transaction_type ilike '%refund%' for that order, matching both the Amazon-string and the platform_orders UUID forms). The genuine self-covering count must be 0 — N3248 and the 40524 -009 unit are refunded returns and must be EXCLUDED (they are correctly LISTED with sold_order_id now NULL after PR #474, so they should not even appear). (2) CODE: Grep the deployed service (on main) — reconcilePhantomStock must (a) build a 'selfCovering' list from LISTED/BACKLOG units carrying their own sold_order_id excluding returned_from_item_id + Cancelled, AND (b) build a refundedKeys set from amazon_transactions refunds (both id forms) and exclude those from BOTH the self-covering and the per-ASIN uncovered detection; manual route surfaces selfCoveringCount. Verdict FAIL if any genuine (non-refunded, non-cancelled, non-return) self-covering unit remains in prod, or the self-covering pass or the refund exclusion is absent from the deployed code.`,
  },
  {
    key: 'no-new-double-links',
    prompt: `Confirm no NEW double-links exist (the guard's job). Query units linked to 2+ DISTINCT non-cancelled orders: group order_items+platform_orders (non-cancelled, qty>0) by inventory_item_id having count(distinct order_id)>=2. For each such unit, get the order dates. EXPECTED: only the historical pre-fix set remains, and crucially NONE has its 2nd/duplicate order dated on/after 2026-06-28 (deploy day) — a post-deploy duplicate would mean the guard failed. Also confirm the specific fixed cases (e.g. N3540 for 76226, N1722 for 40512) carry only ONE order now (their sibling sale was re-pointed to the phantom unit). Verdict FAIL if any unit has a duplicate order dated >= 2026-06-28, or a fixed case still shows the duplicate.`,
  },
  {
    key: 'detection-no-false-positives',
    prompt: `Adversarially confirm the reconciler does NOT false-positive on the known blind-spot patterns. Independently verify, with SQL, that: (a) units sold via a UUID-form sold_order_id (sold_order_id matching '^[0-9a-f]{8}-' ) are correctly treated as COVERED (their orders do not appear uncovered in the corrected SQL); test with N2380 (40271) and N1911 (40687). (b) the cross-ASIN sold units N1355/N1911/N2260 do NOT appear as uncovered orders nor cause their LISTED siblings to be flagged. (c) historical sales whose only in-stock unit was listed AFTER the sale are NOT flagged (the chronology guard) — pick 2-3 sets from the corrected SQL's excluded set (e.g. 40641, 60276, 42119) and show their in-stock unit's listing_date is AFTER the uncovered sale date so they are correctly NOT phantoms. Verdict FAIL if the detection would flag any of these false orphans.`,
  },
];

phase('Validate');
const findings = (
  await parallel(
    DIMENSIONS.map((d) => () =>
      agent(`${CTX}\n\nDIMENSION: ${d.key}\n${d.prompt}\n\nReturn your finding via the schema.`, {
        label: `validate:${d.key}`,
        phase: 'Validate',
        schema: SCHEMA,
      })
    )
  )
).filter(Boolean);

phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(
  concerning.map((f) => () =>
    agent(
      `${CTX}\n\nA validator reported "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nIssues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently reproduce against LIVE production (own SQL on ${PROJECT} / own code reads). Decide whether each issue is a REAL defect in the deployed change (a genuine remaining phantom, a reverted fix, a post-deploy double-link, or a detection false-positive) or a false alarm (the known 42132 watch item, a historical artifact correctly excluded, or a stale read). Default to "real" only if reproduced live.`,
      {
        label: `verify:${f.dimension}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'confirmedReal', 'verdict', 'explanation'],
          properties: {
            dimension: { type: 'string' },
            confirmedReal: { type: 'boolean' },
            verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
            explanation: { type: 'string' },
          },
        },
      }
    )
  )
);

phase('Synthesize');
const report = await agent(
  `${CTX}\n\nSynthesize the FINAL E2E verdict for PR #472 on production.\n\nFINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS:\n${JSON.stringify(verifications, null, 2)}\n\nProduce: overall PASS / PASS-WITH-NOTES / FAIL; one line per dimension; explicitly state whether (a) the fix is deployed, (b) zero genuine phantoms remain (the 42132 watch item is acceptable), (c) the prior cleanup is intact, (d) no post-deploy double-links exist, (e) the reconciler does not false-positive on UUID-form/null-ASIN/historical cases; and any CONFIRMED-REAL defect with severity + concrete action. Be specific and decisive.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('Amazon linker + phantom-reconciler validation complete.');
return { findings, verifications, report };
