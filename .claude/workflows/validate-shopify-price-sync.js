export const meta = {
  name: 'validate-shopify-price-sync',
  description: 'E2E validation of PR #466 Shopify price-sync fix against live production',
  whenToUse: 'After merging + deploying the Shopify price-sync fix, to independently confirm no £0 products, prices match listing_value, held items stay off Shopify, sold items are not live, and the feed is not regressed.',
  phases: [
    { title: 'Validate', detail: 'one read-only validator per dimension, against LIVE Shopify + prod Supabase' },
    { title: 'Verify', detail: 'adversarially re-check any FAIL/WARN finding' },
    { title: 'Synthesize', detail: 'PASS/FAIL E2E report' },
  ],
};

// Shared context every validator needs.
const CTX = `
CONTEXT — you are validating PR #466 "fix(shopify): stop publishing £0 + propagate listing_value changes" on PRODUCTION.
The fix: (a) createProduct/createProductForGroup now HOLD (skip, not publish) inventory items whose listing_value is null/0 — they must NOT appear on Shopify; (b) a new reconcilePrices() in batchSync propagates listing_value changes to Shopify; (c) pricing rule: SETS price = listing_value * 0.9 floored to X.99 (10% direct-sale discount); MINIFIGS price = exact listing_value (NO discount). A one-time backfill already repriced ~306 products live.

ENVIRONMENT: work from the repo at apps/web. Run scripts with: npx tsx --env-file=.env.local scripts/<name>.ts
.env.local holds PROD creds: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SERVICE_USER_ID, the Google service account, and shopify_config lives in Supabase (use ShopifyClient — copy the getClient() pattern from apps/web/scripts/_shopify-admin.ts or _feed-audit.ts).
The exact pricing fn is apps/web/src/lib/shopify/pricing.ts (calculateShopifyPrice(lv, 10)). Minifig detection: isMinifigure in apps/web/src/lib/shopify/sync.service.ts — set_number starts with a MINIFIG_PREFIXES entry AND matches /^[a-z]+\\d/, OR item_name contains "minifig". Read those files to replicate the logic EXACTLY.

RULES: Be INDEPENDENT and ADVERSARIAL — write your OWN throwaway tsx script (prefix _validate-*.ts), do not just trust pre-existing scripts or the shopify_products table (it can be STALE). Where you check prices, read the LIVE Shopify price via ShopifyClient, not the cached shopify_products.shopify_price. Read-only: do NOT mutate Shopify or the DB. Report concrete evidence (counts + sample rows).`;

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'verdict', 'summary', 'evidence', 'issues'],
  properties: {
    dimension: { type: 'string' },
    verdict: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
    summary: { type: 'string', description: 'one-line conclusion' },
    evidence: { type: 'string', description: 'counts + sample rows proving it' },
    issues: {
      type: 'array',
      description: 'genuine problems found (empty if PASS)',
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
    key: 'zero-price',
    prompt: `Confirm NO active product on LIVE Shopify is priced £0.00 (the free-purchase risk the fix eliminates). Pull every ACTIVE product from live Shopify (paginate variants, read price), count any at price 0. List any found with title+sku. Verdict FAIL if any £0 active product exists.`,
  },
  {
    key: 'price-correctness',
    prompt: `THE KEY CHECK. For EVERY active LIVE Shopify product, confirm its live price equals the exact expected price from the linked inventory item's CURRENT listing_value. Steps: pull all active products from live Shopify (sku + price); match each sku to inventory_items.sku to get listing_value, set_number, item_name; compute expected = isMinifigure ? listing_value : calculateShopifyPrice(listing_value, 10).price (import the real fn + replicate isMinifigure EXACTLY from sync.service.ts); flag any where |live_price - expected| >= 0.01 AND listing_value > 0. Report the count of genuine mismatches and list up to 20 with live/expected/listing_value/minifig-flag. Note: a prior approximate audit suggested ~9 "underpriced" residuals — determine with the EXACT logic whether those are real misprices or false positives from a looser minifig heuristic. Verdict: PASS if 0 genuine mismatches; WARN if a few small ones; FAIL if many or large.`,
  },
  {
    key: 'held-items',
    prompt: `Confirm the new "hold" behaviour: inventory items that are status=LISTED but have listing_value null or <=0 must NOT be live (active) on Shopify. Find such inventory items; for each, check whether an active shopify_products mapping exists AND whether the product is actually active on LIVE Shopify. Verdict FAIL if any null/0-price LISTED item is live+active on Shopify (would be a £0 publish). Report counts.`,
  },
  {
    key: 'sold-not-live',
    prompt: `Confirm no SOLD/archived inventory item is still ACTIVE on live Shopify (double-sell / 404 risk). Join shopify_products (shopify_status=active) to inventory_items; flag any whose inventory status is SOLD or archived. For a sample, confirm against LIVE Shopify status. Verdict FAIL if sold items are live & buyable; WARN if only stale-table mismatches (live actually archived). Report counts + samples.`,
  },
  {
    key: 'feed-health',
    prompt: `Confirm the Google Merchant feed was not regressed by the reprice. Use the Content API (merchant 5809583788, service-account auth — see apps/web/scripts/_feed-diagnostics.ts). Check: total disapproved is still ~11 or fewer (not a new mass disapproval), no new "Invalid price" disapprovals (the £0/price fixes should have reduced these), and condition mapping unchanged. Verdict FAIL if disapprovals spiked or new invalid-price errors appeared; WARN for minor; PASS otherwise. Report the disapproval breakdown.`,
  },
  {
    key: 'deploy-live',
    prompt: `Confirm the fix is actually deployed. (1) Vercel prod (https://hadley-bricks-inventory-management.vercel.app) core pages return 200. (2) The Shopify sync cron route exists and is auth-gated (curl it; 401/405 = exists+protected = PASS, 404/500 = FAIL) — find the route under apps/web/src/app/api (look for shopify sync/batch/cron). (3) Confirm git origin/main HEAD is commit 3ef7229b (the merged fix). Verdict PASS if deployed + routes healthy.`,
  },
];

phase('Validate');
const findings = (
  await parallel(
    DIMENSIONS.map((d) => () =>
      agent(`${CTX}\n\nDIMENSION: ${d.key}\n${d.prompt}\n\nReturn your finding via the schema.`, {
        label: `validate:${d.key}`,
        phase: 'Validate',
        schema: FINDING_SCHEMA,
      })
    )
  )
).filter(Boolean);

// Adversarially verify anything not a clean PASS.
phase('Verify');
const concerning = findings.filter((f) => f.verdict !== 'PASS');
const verifications = await parallel(
  concerning.map((f) => () =>
    agent(
      `${CTX}\n\nA validator reported dimension "${f.dimension}" as ${f.verdict}: ${f.summary}\nEvidence: ${f.evidence}\nClaimed issues: ${JSON.stringify(f.issues)}\n\nYou are the SKEPTIC. Independently re-derive this from LIVE production data with your own script. For each claimed issue, decide if it is a REAL defect in the deployed fix or a false positive (e.g. stale shopify_products table, an approximate minifig heuristic, a sold item that is actually archived live, a pre-existing data issue unrelated to PR #466). Default to "real" only if you can reproduce it against live Shopify.`,
      {
        label: `verify:${f.dimension}`,
        phase: 'Verify',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'confirmedReal', 'verdict', 'explanation'],
          properties: {
            dimension: { type: 'string' },
            confirmedReal: { type: 'boolean', description: 'true if a genuine defect in the deployed fix' },
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
  `${CTX}\n\nSynthesize the FINAL E2E validation verdict for PR #466 (Shopify price-sync fix) on production.\n\nVALIDATOR FINDINGS:\n${JSON.stringify(findings, null, 2)}\n\nADVERSARIAL VERIFICATIONS (only run on non-PASS dimensions):\n${JSON.stringify(verifications, null, 2)}\n\nProduce a crisp report: an overall PASS / PASS-WITH-NOTES / FAIL, a one-line per-dimension status, the list of any CONFIRMED-REAL defects (with severity + suggested action), and explicitly state whether the "~9 underpriced residual" was real or a false positive. Be honest and specific.`,
  { label: 'synthesize', phase: 'Synthesize' }
);

log('E2E validation complete.');
return { findings, verifications, report };
