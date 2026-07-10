export const meta = {
  name: 'validate-orders-page-audit',
  description:
    'E2E validation of the orders-page audit fixes (Shopify visibility, Paid reconciliation, search, pagination, synced_at freshness, Shopify Completed status) against live production + Supabase',
  whenToUse:
    'After merging + deploying the orders-page audit/redesign branch, to independently confirm the deploy landed, every card count reconciles with the database, the search/pagination/status-filter fixes behave on prod, and the data corrections stuck.',
  phases: [
    { title: 'Data', detail: 'independent SQL recomputation of every card figure' },
    { title: 'Code', detail: 'audit deployed main for each fix' },
    { title: 'UI', detail: 'live production /orders checks in the logged-in Chrome' },
    { title: 'Verdict', detail: 'adversarial synthesis → PASS/FAIL' },
  ],
}

const ROOT = 'C:/Users/Chris Hadley/claude-projects/hadley-bricks-inventory-management'
const PROJECT_ID = 'modjoikyuhqzouxvieua'

const CHECK_SCHEMA = {
  type: 'object',
  required: ['pass', 'evidence'],
  properties: {
    pass: { type: 'boolean' },
    evidence: { type: 'string', description: 'Numbers/queries/observations backing the verdict' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
}

phase('Data')
const dataChecks = await parallel([
  () =>
    agent(
      `Use ToolSearch to load mcp__plugin_supabase_supabase__execute_sql, then run read-only SQL against project ${PROJECT_ID} to verify orders-page data integrity:
1. SELECT platform, COUNT(*) FROM platform_orders GROUP BY platform — every platform present must be one of bricklink/brickowl/amazon/shopify (no orphan platforms hidden from the UI; bricqer rows would be a FAIL).
2. Recompute the normalized status distribution for shopify rows: there must be NO shopify row with status='paid' whose raw_data->>'fulfillment_status'='fulfilled' (they were backfilled to 'Completed' on 2026-07-09 and the sync now writes Completed).
3. Verify the Paid reconciliation: count platform_orders rows whose effective status normalizes to Paid (internal_status='Paid' OR (internal_status IS NULL AND (status ILIKE '%paid%' OR status ILIKE '%payment%'))) plus ebay_orders with order_fulfilment_status='NOT_STARTED' AND order_payment_status != 'FULLY_REFUNDED'. Report both numbers — the UI Paid card must equal their sum.
4. MAX(synced_at) per platform in platform_orders — flag if bricklink is older than 24h AND bricklink_sync_log shows a COMPLETED run more recent than it (that was the stale-display bug; after one post-deploy full-sync run they must agree).
Return pass=true only if all four hold (check 4 may be WAIVED with a concern if no full-sync has run since deploy — say so explicitly).`,
      { label: 'sql:integrity', phase: 'Data', schema: CHECK_SCHEMA }
    ),
])

phase('Code')
const codeChecks = await parallel([
  () =>
    agent(
      `In ${ROOT} (git repo), verify on the main branch (git show origin/main:<path> or Read after confirming branch):
1. apps/web/src/app/api/orders/route.ts parses a 'search' query param and passes it to the repository.
2. apps/web/src/lib/repositories/order.repository.ts applies an ilike or() filter over platform_order_id/buyer_name when filters.search is set, with metacharacter stripping.
3. apps/web/src/lib/shopify/order-sync.service.ts writes status 'Completed' when order.fulfillment_status === 'fulfilled'.
4. apps/web/src/lib/services/bricklink-sync.service.ts sets synced_at in BOTH upsert payloads (processOrder and syncOrderById).
5. apps/web/src/app/(dashboard)/orders/page.tsx: renders a Shopify PlatformCard, includes 'shopify' in the platform dropdown, computes merged pagination with totalPages = max of both sources, and only enables the eBay list query when the status is in the eBay-compatible set.
Also confirm 'git log origin/main --oneline -5' contains the orders audit/redesign merge. Return pass only if all present on main.`,
      { label: 'code:main-audit', phase: 'Code', schema: CHECK_SCHEMA }
    ),
  () =>
    agent(
      `Verify the production deploy is live and healthy. In ${ROOT}, read docs/agents/merge-feature/last-deploy.json for the latest deploy record, and use 'npx vercel ls hadley-bricks-inventory-management 2>/dev/null | head' or the Vercel API if credentials allow; otherwise curl -s -o /dev/null -w '%{http_code}' https://hadley-bricks-inventory-management.vercel.app/login (expect 200/30x). Confirm the deployment is newer than the merge commit time. Return pass=true with evidence.`,
      { label: 'deploy:health', phase: 'Code', schema: CHECK_SCHEMA }
    ),
])

phase('UI')
const uiCheck = await agent(
  `Use ToolSearch to load the claude-in-chrome tools (tabs_context_mcp, tabs_create_mcp, navigate, computer, read_page). Create a NEW tab, navigate to https://hadley-bricks-inventory-management.vercel.app/orders (Chris's Chrome is logged in), wait ~15s for data, screenshot, then verify BY READING THE RENDERED NUMBERS:
1. The platform cards (BrickLink + BrickOwl + Amazon + eBay + Shopify if present) sum EXACTLY to the All Orders card.
2. The Paid card equals the sum of the platform cards' Paid chips.
3. A Shopify card or shopify dropdown option exists.
4. Type a buyer name fragment (e.g. 'candlish') into the search box, wait ~2s, and confirm the table filters to matching non-eBay orders.
5. With All Platforms + All Statuses selected, scroll to the table bottom: pagination controls must show more than one page (~4,000+ orders).
6. No stale-sync badge on platforms that synced today, and the BrickLink card shows a freshness badge (state what it says).
Close the tab when done. Return pass=true only if 1-5 hold; report each observed number in evidence.`,
  { label: 'ui:prod-orders', phase: 'UI', schema: CHECK_SCHEMA }
)

phase('Verdict')
const all = [...dataChecks, ...codeChecks, uiCheck].filter(Boolean)
const verdict = await agent(
  `You are the adversarial referee for the orders-page audit validation. Evidence from independent checkers:\n${JSON.stringify(all, null, 2)}\n\nChallenge the evidence: do the numbers actually reconcile, or did a checker pass on vague evidence? Any check with pass=false or unsupported evidence means overall FAIL. Waived checks (explicitly stated) don't fail the run but must be listed as follow-ups. Produce a final PASS/FAIL with a numbered summary of what was proven and any follow-ups.`,
  { label: 'referee', phase: 'Verdict' }
)

return { checks: all, verdict }
