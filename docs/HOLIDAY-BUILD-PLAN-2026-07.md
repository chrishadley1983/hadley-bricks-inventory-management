# Holiday Build Plan — Site Conversion Sprint (late July 2026)

**Written:** 16 Jul 2026, from the full store audit run that day.
**Window:** Chris's holiday week (~w/c 20-27 Jul) — no shipping happening, so bulk store-wide
mutations (titles, images, collections) are safe: no orders mid-flight, no pick/pack conflicts.
**Goal:** fix the conversion layer. The audit showed traffic works (549 sessions/28d, position
12.4 and climbing) but the funnel leaks at exactly one place: **147 product views → 4 add-to-carts
(2.7%)**. 3 lifetime orders. Everything here targets product-page close rate first, amplification
second.

**Companion docs:** `SEO-SALES-GROWTH-PLAN-2026-06.md` (waves), `WEBSITE-ENGAGEMENT-SALES-PLAN-2026-06.md`
(phases, "six things"). This plan supersedes their sequencing — it is the pick-up-and-build order.

---

## 0. Session bootstrap (read first, every session)

Two repos + the live store:

| Surface | Where | How to change |
|---|---|---|
| Theme (Refresh #148928987402) | `claude-projects\hadley-bricks-shopify` (branch `master`, NO remote) | `shopify theme push --development` to preview; live: `shopify theme push --theme 148928987402 --allow-live --nodelete --only <files>` — ALWAYS pull-and-diff first (theme-editor edits happen outside git) |
| Store data (products, collections, pages, articles) | Admin API via `shopify_config` Supabase row (plaintext, no decryption) | tsx scripts from `apps/web` in the inventory repo |
| Sync pipeline code (titles, images, prices at SOURCE) | `claude-projects\hadley-bricks-inventory-management` `apps/web/src/lib/shopify/` | Branch + PR + approval per repo policy; deploy via /merge-feature |

**Env:** `apps/web/.env.local` in the inventory repo now has cloud Supabase + the Google service
account — scripts run locally, no Vercel pull needed. GA4 prop `541958510`, SC
`sc-domain:hadleybricks.co.uk`, Merchant `5809583788`, store `6492ae.myshopify.com`.

**Gotchas (learned the hard way):**
- The old `_shopify-admin.ts` / `_seo-data.ts` / `_feed-audit.ts` helper scripts were UNTRACKED
  and died in the 10 Jul checkout wipe. **Recreate helpers in a tracked path this time**:
  `apps/web/scripts/shopify-tools/` (commit them).
- `reconcilePrices`/`updatePrice` CLEAR `compare_at_price` every batch — never hand-set
  strikethroughs; sales run via native Shopify discounts only.
- Updating a page BODY does not touch its SEO meta description — separate
  `global.description_tag` metafield (`metafieldsSet`).
- Blog article edits: REST articles PUT, idempotent via `<!-- hb-cat-hook -->` style markers.
- curl is bot-blocked on the storefront — verify with Playwright. CDN: sections propagate fast,
  static assets up to ~2h.
- Verify `git branch --show-current` in BOTH repos before committing (shared checkouts).
- The dashboard data layer `apps/web/scripts/dashboard/data.ts` is the tracked GA4/SC/feed
  reader — reuse it, don't rewrite.

**Verification pattern for every phase:** storefront check via Playwright + (where relevant)
GA4/SC/Merchant re-pull + `/verify-done`. Baseline numbers to beat are in §7.

---

## 1. PRE-HOLIDAY CHECKLIST (before leaving — mostly Chris-manual, ~1-2h total)

These need Chris's hands (account signups, app-install OAuth clicks, physical stock access).
Everything later in the plan that depends on them is marked.

- [ ] **P-1 Install a review app** (Judge.me free tier, or Shopify Product Reviews). The audit
  found Judge.me has VANISHED (zero judge.me requests site-wide — it was live 24 Jun). App
  install is an OAuth click Claude can't do. *Blocks Phase 3.*
- [ ] **P-2 Create Omnisend account** (or confirm Shopify Email is acceptable — decision:
  Omnisend preferred per June plan; free tier fine at current volume). *Blocks Phase 5.*
- [ ] **P-3 Claim Trustpilot profile + Google Business Profile** (signup + verification emails
  land while away; setup completes in Phase 3). 
- [ ] **P-4 Photo batch (optional but high-value):** phone-photograph the TOP 20 restored sets
  by listing value before leaving (audit: real photos are the #1 conversion lever and the one
  thing impossible remotely). Dump to Drive; Phase 2 has a slot to attach them. If skipped,
  Phase 2's programmatic image upgrade still ships a big win.
- [ ] **P-5 Holiday dispatch notice decision:** orders can still arrive during the week. At
  holiday start, update the announcement bar + shipping page ("orders placed this week dispatch
  from <return date>") and set Shopify order-processing expectation. Scripted in Phase 0 below —
  Chris just confirms the dates.
- [ ] **P-6 Bing Webmaster Tools account** — add site, get the `msvalidate.01` token, paste it
  into the theme setting (the hook shipped 16 Jun in `30cca35` but no token is rendering).
  *Blocks Phase 4 Bing work.*

---

## 2. PHASE 0 — Day 0 opener (½ day): compliance + housekeeping

Cheap, independent, do first.

| ID | Task | Where | How | Verify |
|---|---|---|---|---|
| 0.1 | **Holiday dispatch notice** | Admin API + theme | Announcement bar copy (`header-group.json` via theme editor or Admin), shipping-returns page body + its `global.description_tag` metafield, order-confirmation expectation line | Playwright: banner text on homepage; page + meta both updated |
| 0.2 | **Cookie consent banner** | Shopify admin (Settings → Customer privacy) | Enable Shopify's built-in cookie banner for UK/EEA, set GA4 to respect consent mode. No code needed | Banner renders; GA4 `gcs` param reflects consent state before/after accept |
| 0.3 | **Privacy policy page + footer link** | Shopify admin policies + theme `footer-group.json` | Generate Shopify policy, add footer link next to Refund/Terms | Footer shows Privacy policy; page 200 |
| 0.4 | **Bing verification token** | Theme settings (hook exists) | Paste token from P-6 | `meta[name="msvalidate.01"]` in head (Playwright) |
| 0.5 | **Appeal the 2 adult-content false positives; check 5 'page unavailable' disapprovals** | Merchant Center UI + `dashboard/data.ts` feed pull | Manual review in MC; the 5 unavailable are likely recently-sold items mid-drop — confirm they leave the feed | Feed re-pull: disapproved ≤ 3 |
| 0.6 | **Recreate tracked helper script** `apps/web/scripts/shopify-tools/admin.ts` | Inventory repo (tracked!) | Port the lost `_shopify-admin.ts` (list/rename/get-page/shipping + GraphQL passthrough). Commit it | Script lists products; committed to a branch |

Done criteria: consent + privacy live, dispatch notice live, Bing verified, helper committed.

---

## 3. PHASE 1 — Days 1-2: product pages that close (the core)

### 1A. Clean titles at source (inventory repo — branch `fix/shopify-clean-titles`, PR)

The leak's root: `buildShopifyTitle()` (`apps/web/src/lib/shopify/descriptions.ts:203`) passes
raw `item.item_name` through — for Amazon-sourced stock that's the keyword-stuffed Amazon title
("…Birthday Gift Idea for 9+ Year Old Boys & Motorsport Fans - 77254 (77254) - New Sealed"),
duplicated theme names, price baked into handles, and at least one WRONG set number live
(Santa's Delivery Truck 40746 shows "(40206)").

- [ ] 1A.1 `buildShopifyTitle`: prefer `bricksetData.set_name` over `item.item_name` when
  Brickset data exists (it's already passed in); keep the theme prefix + set number + condition
  suffix pattern. Strip marketing filler as fallback when no Brickset row (regex kill-list:
  "Birthday Gift…", "Toy for Kids…", "for X+ Year Old…", duplicated `(setnum)` pairs).
- [ ] 1A.2 One-off backfill script `shopify-tools/retitle-backfill.ts`: recompute title for all
  500 ACTIVE products, diff report first (dry-run default → Chris eyeballs 20 samples → apply).
  **Do NOT touch handles/URLs** (SEO-safe, matches the June collection-rename precedent). Update
  `shopify_products.shopify_title` mapping too.
- [ ] 1A.3 Fix the 40746/40206 mismatch specifically and audit for other wrong-set-number cases
  (compare title `(NNNNN)` vs `inventory_items.set_number` across all mappings).
- [ ] 1A.4 Regression guard: unit test on `buildShopifyTitle` with an Amazon-style fixture.

*Why source-first: a display-layer rewrite would be overwritten by the next sync; new products
would keep arriving dirty.*

### 1B. Image upgrade (inventory repo — same or second PR)

Audit: PDPs render ONE image, 495×174px box-art strip (sets) / 198×264 catalog PNG (minifigs);
also behind the 60 image-too-small Merchant warnings. `resolveImages()`
(`apps/web/src/lib/shopify/images.ts`) already probes the Brickset AdditionalImages gallery but
falls back to the small `brickset_sets.image_url` thumb.

- [ ] 1B.1 Upgrade the fallback to Brickset's LARGE image URL pattern
  (`images.brickset.com/sets/images/{set}.jpg`) with a HEAD-probe + small-thumb last resort.
- [ ] 1B.2 `reconcileImages()` already exists (PR #470) — extend its trigger to also re-resolve
  products whose current main image is < 500px wide (measure via Shopify image width field),
  not just eBay-art mismatches.
- [ ] 1B.3 Backfill run across ACTIVE products (dry-run report → apply). Never downgrade
  (existing rule). Expect: multi-angle galleries where Brickset has them, sharp box art
  everywhere else.
- [ ] 1B.4 If P-4 photos were taken: `shopify-tools/attach-photos.ts` — upload per-product
  photo sets for the top-20 restored items (REST product PUT `images`, replaces gallery —
  the PR #470 pattern), alt text "actual item photographed".

### 1C. Homepage merchandising (theme repo — six-things #5)

- [ ] 1C.1 Featured-products section above the fold: server-rendered (crawlable) 8-product row
  from a new `homepage-featured` MANUAL collection — real prices, condition badges. Wire into
  `templates/index.json` after hero. (The `featured-collection` + `new-arrivals` collections
  exist but are EMPTY — either populate `homepage-featured` by script weekly from newest
  in-stock listings, or repurpose `new-arrivals` with an automated rule.)
- [ ] 1C.2 Move a trust row (Piece-by-Piece Verified / genuine guarantee / £3.99 tracked)
  directly under the product row; hero subtext contrast fix (audit flagged light-grey-on-light
  photo at 390px) — darken overlay or move text onto solid.
- [ ] 1C.3 Once reviews exist (Phase 3): star strip on homepage cards.
- Verify: Playwright desktop + 390px mobile; products visible without scroll on desktop,
  ≤1 scroll on mobile; all links 200; no CLS jump (audit CLS baseline 0.003 — keep <0.05).

### 1D. Collection hygiene (Admin API script)

- [ ] 1D.1 Minifigures collection rule: currently keyword-matches "minifigure" in TITLE → first
  3 items are full sealed sets (77254/40746/75391). Switch rule to `product_type = Minifigure`
  (product_type is already 100% populated: LEGO Set 773 / Minifigure 56).
- [ ] 1D.2 Delete or populate the empty `new-arrivals` + `featured-collection` (see 1C.1) — an
  empty collection linked from the footer ("New Arrivals") is a dead end.
- [ ] 1D.3 **Decide "Retired LEGO Sets" definition** — it currently contains the ENTIRE
  catalogue (891 products), which dilutes the sharpest concept we have. Proper rule: tag-driven
  (`retired` tag set from `brickset_sets.retirement_status`/`exit_date` during sync). Inventory
  repo: emit the tag in sync; Admin: flip the collection rule to the tag. This also unlocks an
  honest "Retiring Soon" collection for Phase 4.
- Verify: minifig collection first page = only minifigs; retired count = genuinely retired.

Done criteria (Phase 1): sampled PDPs show clean title + ≥1 sharp image ≥800px; homepage shows
8 real products; collections truthful. **This phase is the add-to-cart bet.**

---

## 4. PHASE 2 — Day 2: PDP trust & answer blocks (theme repo)

- [ ] 2.1 **FAQ on product template** — `faq-section.liquid` shipped 16 Jun (`6e1d279`) but is
  wired to COLLECTIONS only. Add to `main-product.liquid` with condition-aware Qs (restored →
  "What does restored mean?" / sealed → "Is this sealed set genuine?") + FAQPage JSON-LD (gate:
  don't double-emit when a collection FAQ block exists on the same render).
- [ ] 2.2 **Visible breadcrumbs on PDP** (BreadcrumbList LD already ships — render the nav UI,
  Home → Collection → Product).
- [ ] 2.3 **Condition grade panel** (engagement-plan §1.4, "Hadley Bricks Verification"): a small
  spec box on used items — cleaned / piece-verified / box condition — sourced from existing
  Quick Facts data + eBay description completeness detection. This is the USP made visible.
- [ ] 2.4 PDP meta descriptions: template tweak to lead with price + condition + free-over-£100
  ("LEGO 42123 McLaren Senna GTR — used, complete, £13. £3.99 tracked UK delivery.") to harvest
  the set-number long tail (dozens of pos-5-15/0-click queries in SC).
- Verify: rich-results test on 2 PDPs (Product + FAQPage + Breadcrumb all valid), Playwright
  renders, no schema duplication.

---

## 5. PHASE 3 — Day 3: reviews & trust (needs P-1/P-3)

- [ ] 3.1 Configure the review app: widget on PDP (stars under title), post-purchase review
  request email (14-day delay — set 21 during holiday backlog), review carousel section for
  homepage.
- [ ] 3.2 Confirm the June-shipped GATED AggregateRating schema (`758fb31`/`54cc6e8`) picks up
  app reviews — it emits only when reviewCount>0, so first review = first stars in SERPs. If the
  new app isn't Judge.me, adapt the snippet's data source.
- [ ] 3.3 Seed honestly: email past marketplace buyers? NO mass-import fakery — but the 3
  Shopify buyers can be asked directly, and marketplace reputation can be REFERENCED in copy
  ("5,000+ orders across eBay/Amazon/BrickLink" trust bar with links to the live profiles —
  footer already links the stores).
- [ ] 3.4 Trustpilot: complete profile, add invitation link to order-confirmation email; GBP:
  complete profile (Tonbridge, service-area business), link website.
- Verify: stars render on a PDP with a review; AggregateRating appears in page LD; Trustpilot
  profile live.

---

## 6. PHASE 4 — Day 4: feed, shopping surfaces & the retirement wave

- [ ] 4.1 **GTIN backfill** (inventory repo PR): `brickset_sets.ean` has 7,879 EANs. Join our
  349 active new-sealed products → write `variant.barcode` via Admin API; measure coverage
  (expect meaningful but partial — report the gap). Also emit in sync for future products.
  Skip used/restored (no GTIN expected — set MPN = set number instead).
- [ ] 4.2 **Condition mapping verify** (the BrickBros guard): in Merchant Center, confirm the
  241 used/restored items carry `condition: used` (June audit: 170 condition warnings,
  channel metafields invisible to our token — verify from the MC side now we have SA access via
  Content API: `dashboard/data.ts` extension or `shopify-tools/feed-conditions.ts`).
- [ ] 4.3 **Bing**: with 0.4 verified, submit sitemap in Bing Webmaster; evaluate Bing Shopping
  feed clone (Microsoft channel app) — Bing feeds ChatGPT/Copilot commerce answers.
- [ ] 4.4 **"Retiring Soon" push (time-critical — July retirement wave is NOW):**
  - New smart collection `retiring-soon` from the retirement tag (1D.3).
  - Update `best-lego-sets-retiring-2026` post: July-wave section + link the new collection
    (it already has the hook/CTA pattern — extend, don't rebuild).
  - Retitle its meta for CTR (currently 1.16% at pos 7.3 on 10k impressions — lead with
    "full list + where to buy before prices jump").
- [ ] 4.5 llms.txt note: Shopify now auto-serves llms.txt/agents.md/UCP/MCP (audit confirmed
  live) — nothing to build; do NOT hand-roll a competing llms.txt.
- Verify: MC shows barcodes flowing + used-condition correct; Bing verified + sitemap
  submitted; retiring-soon collection live and linked from the post.

---

## 7. PHASE 5 — Day 5: email & capture (needs P-2)

- [ ] 5.1 Omnisend: connect store, welcome flow (10% first-order code — via native Shopify
  discount, NEVER compare_at), abandoned-cart flow (1h + 24h). At 4 checkouts/28d this is small
  today — it's the compounding rail for when Phase 1 lifts ATC.
- [ ] 5.2 Exit-intent / footer capture upgrade: the newsletter section exists; add an incentive
  line + wire signups into the welcome flow. Optional: gate the "retiring soon list" as the
  lead magnet ("get the retirement list monthly").
- [ ] 5.3 Order-confirmation email: add review-request + Trustpilot line (from Phase 3).
- Verify: test signup end-to-end on the live store (own email), flow fires, discount code works,
  GA4 shows the signup event.

---

## 8. POST-HOLIDAY (needs physical stock / daylight)

- Real photo programme for restored sets beyond the top 20 (fold into the receiving workflow:
  photograph at check-in, one habit not a project).
- JS/perf pass: TBT 1.2-2.3s, 148-165 requests/page (audit) — theme app audit, defer
  non-critical scripts. Do AFTER conversion work; it's a score, not a leak.
- Meta pixel — only when IG retargeting is actually wanted (Wave 6.3).
- Blog cadence: the 5 planned posts (§5 of engagement plan), restored/used moat first — we are
  ALREADY #1 for "buy used lego sets uk restored"; write from strength. One per fortnight,
  hooks to collections per the proven pattern. (Draftable any time — including on holiday if
  wet weather strikes; Claude drafts, Chris approves.)

---

## 9. Baselines to beat (from the 16 Jul audit — re-pull via `dashboard/data.ts`)

| Metric | Baseline (28d to 16 Jul) | Target (28d after sprint) |
|---|---|---|
| view_item → add_to_cart | 4/147 = **2.7%** | ≥8% |
| Site CVR | 0.36% (2 conv/549 sessions) | ≥1% |
| Orders (lifetime 3) | ~1/month | ≥1/week |
| SC clicks | 242 | ≥300 (blog CTR retitle + long tail) |
| Avg position | 12.4 | <11 |
| Blog post CTR | 1.16% @ pos 7.3 | ≥2% |
| AI-assistant sessions | 31 | ≥40 (Bing + reviews corpus) |
| Feed approved | 394/400 | ≥398/400, barcodes flowing |
| PDP images | 1 × 495×174 | ≥1 × ≥800px (galleries where available) |
| Reviews on site | 0 (app missing) | app live + first reviews requested |

**Sequencing logic if time runs short:** Phase 1 > Phase 3 > Phase 0 > Phase 2 > Phase 4 > Phase 5.
Phase 1 is the bet; everything else multiplies it.

---

## 10. Approval checkpoints (per repo policy — plan ≠ blanket approval)

Explicit go/no-go moments to surface to Chris before executing:
1. Retitle backfill apply (after dry-run diff review) — 1A.2
2. Image backfill apply — 1B.3
3. "Retired" collection redefinition (changes a ranking page's contents) — 1D.3
4. Homepage template change to live theme — 1C
5. Any email flow going live — 5.1
Everything else is additive/reversible or staged via preview theme.
