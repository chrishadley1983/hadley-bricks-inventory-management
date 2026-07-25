# BL Member Product — Strategy

> **Status:** Strategy agreed, not yet specced or built
> **Date:** 2026-07-25
> **Target build window:** August 2026 (holiday period, order shipping paused)
> **Prerequisite reading:** `docs/features/bl-store-assessment/build-report.md`,
> `docs/features/bl-store-report/audit-2026-07-19.md`, `src/lib/bricklink/fees.ts`

---

## 1. What this is

A deliberately small, invite-only subscription product that packages the BrickLink
pricing, store-review and arbitrage capability already running in this repo, and
delivers it to other UK BrickLink sellers through a member area linked from
hadleybricks.co.uk.

**It is not a "BrickLink pricing tool".** It is a *BrickLink store intelligence
service*. The distinction matters commercially: BrickLink's own Part Out Value
tool, BrickEconomy, Brickset and Rebrickable all provide raw numbers for free. Two
of the three candidate v1 modules overlap with free incumbents. The product only
survives that overlap by selling **decisions**, not data.

### The moat

Two assets, both already built and both hard to replicate:

1. **A maintained UK-first price / STR / supply cache with sold-history shape.**
   Not just current averages — per-month sold lots, quantity and average price for
   the trailing six months on every cached tuple, plus a price→quantity histogram
   of where market volume actually clusters.
2. **An opinionated decision contract that refuses to flatter.** `bl-store-report`
   encodes the honesty ladder (raw → demand-capped → **liquid**), benchmark
   provenance (`uk` / `world†` / `none`), overlap tags, magnets, sold-price ceiling,
   and demand-cap as advisory rather than filter. This was hard-won — see the
   2026-07-19 audit, where five improvised report formats moved a headline from
   £1,151 to £17 in twenty minutes.

The second asset is the real differentiator. Anyone can scrape prices. The
judgement about which numbers are honest took months of live trading to develop.

### Commercial shape

| Parameter | Decision |
|---|---|
| Model | Paid subscription, **capped seats** |
| Target | ~£5,000/year total |
| Launch | Start with **4** members (friendlies, free during testing) |
| Implied pricing | 4 seats ≈ £104/mo · 10 ≈ £42/mo · 15 ≈ £28/mo |
| Audience | UK BrickLink part-out sellers first; widen later |
| Delivery | Subdomain app with own auth, linked from hadleybricks.co.uk (Shopify) |
| Billing | Manual at 4 seats. No Stripe build required for launch |

**Seat capping is a strategic choice, not a limitation.** It resolves the central
tension of selling the buy-side lens: showing 20 UK part-out sellers the same
underpriced stores that the nightly sweep finds would create direct competition in
the marketplace Hadley Bricks buys in. With a capped, hand-picked roster, member
selection becomes a commercial lever — avoid own lanes, avoid direct competitors —
and scarcity supports premium pricing that self-serve never would.

---

## 2. Capacity and cost — not a constraint at this scale

| Resource | Current | Headroom |
|---|---|---|
| Local bot scrape throughput | 60–100 stores/night (~1 min/store) | ~10× |
| BrickLink API | 5,000 calls/day, <5% used | ~20× |
| Price guide cache | 77,811 rows / 53,556 items, 100% fresh <60d | Coverage largely solved |
| POV cache | 20,993 sets, 100% fresh <90d | — |
| Store assessments | 341 runs / 326 stores, watchlist 1,241 | Pipeline proven |

Fifteen members running one own-store refresh plus five target assessments weekly
is roughly 90 scrapes/week — about 13 a night. Well inside budget.

**Coverage is not the v1 problem.** An earlier reading of this suggested members
would hit cold caches on unseen sets, requiring a large precompute build. That was
wrong: `bl_pg_refresh_queue` (159,957 entries) runs a managed 60/28/90 cycle policy
and every POV row is fresh. The engineering effort belongs elsewhere.

**The real constraint is delivery, not data.** Store scraping requires `connectCdp`
against a logged-in Chrome on the local Windows bot. Vercel cannot run it. At four
to fifteen seats this is acceptable, but it means a paid product depends on one
machine and one BL session. Mitigations in §5.

---

## 3. Core functionality

### Tier 1 — Exists; needs multi-tenanting and a web skin

| # | Capability | Current state | Work required |
|---|---|---|---|
| 1 | **Store Radar** — assess any public BL store | Engine + `/arbitrage/store-assessment` UI shipped; 326 stores assessed | Member scoping; swap overlap source |
| 2 | **Decision report** — honesty ladder, STR columns, magnets, provenance | `bl-store-report` shipped: CLI + Markdown renderers | Add a **web** renderer against the same contract |
| 3 | **Watchlist + nightly sweep + delta alerts** | Shipped: `store-assessment-batch.ts`, 02:15 Task Scheduler, Discord alerts | Per-member watchlists; email instead of Discord |
| 4 | **Set lookup + cross-platform pricing** | Shipped | Polish only |
| 5 | **Official POV + part-out multiple** | Shipped; 20,993 sets cached | Polish only |

### Tier 2 — The August build; the member differentiator

The single agreed principle: **every comparison a member sees must run against
their store, not ours.** Overlap tags are currently computed against the Bricqer
inventory snapshot, which is meaningless to a member. Their store must become a
first-class object — background-calculated, cached overnight, or fast on demand.

| # | Capability | Why it matters |
|---|---|---|
| 6 | **Member store snapshot** — registration, ingestion, nightly refresh | The keystone. Every personalised feature depends on this one object |
| 7 | **Overlap vs member's store** | Refactor `bl-store-assessment/overlap.ts` to accept a store snapshot instead of Bricqer inventory. Unlocks NEW / RESTOCK-OUT / RESTOCK-THIN / DUPLICATE, and makes their liquid headline honest the way ours is |
| 8 | **"My Store" review** | Repoint the `store-quality` engine from `bricqer_inventory_snapshot` to a member snapshot. Delivers velocity classes (MOVER / OVERSTOCK / MARKET-ONLY / SLOW / DEAD / BLIND) and lot flags (STUCK-HIGH, UNDER-PRICED, LOW-YIELD-PICK, BLIND-HIGH-VALUE). The daily-habit retention feature |

#### Member store ingestion — three configurable routes

| Route | Effort for member | Freshness | Bot dependency |
|---|---|---|---|
| **BrickStore `.bsx` upload** | Export + upload | On upload | **None** |
| **Public store scrape by slug** | Enter store name | Nightly | Yes |
| **Own BL API keys** | API registration | Automatic | None |

BSX is the recommended default. `scripts/pg/pg-harvest-import.ts` already detects
and parses BSX XML — it skips them there because BSX carries no price-guide
quadrant fields, but a BSX **does** carry inventory: item, colour, condition,
quantity, price and remarks. That is precisely a store snapshot, obtained with no
scrape, no API key and no local-bot dependency. It removes the bottleneck for the
member's own store, which is the highest-frequency refresh in the system.

### Tier 3 — The USP gaps

These are the four things free tools cannot do, articulated directly from the
differentiators identified in the strategy session.

| # | Capability | Notes |
|---|---|---|
| 9 | **Pricing-strategy inference + recommendations** | Highest wow-per-hour on the list, and the heart of the seller lens. Join their store to the price cache and regress ask against market by condition, item type, price band and colour rarity to infer the formula they are *actually* running: *"you believe you price at market; you're at 1.32× on parts under £1 and 0.81× on minifigs over £10."* Report **fit quality** alongside — whether they have a formula at all — and recommend a rule where they do not. The `hist` price→quantity distribution shows where market volume clusters relative to their ask. Nobody knows their own effective pricing strategy, and no free tool can compute it. See §4a |
| 10 | **STR trust — spike vs steady** | A 2026 set can show a flattering six-month STR that will not hold. `uk_detail.soldNew.byMonth` answers this directly: was sold quantity spread across months, or did it all land in one? See §4 for readiness |
| 11 | **POV concentration** | Is the part-out value carried by three minifigs or spread across 800 parts? Transforms part-out risk assessment. `bricklink_part_out_value_cache` is set-level aggregate only (no per-part breakdown), but `partout.service.ts` already walks set inventories part-by-part — persist that breakdown to derive top-N share of POV, minifig share, and a concentration risk flag |
| 12 | **Per-member fee & pricing model** | `src/lib/bricklink/fees.ts` hardcodes the Bricqer stack: BL 3% + Bricqer 3.5% + PayPal 2.9% = 9.4%. A member not on Bricqer runs roughly 5.9% and has no pricing formula at all. Both become per-member configuration. `fees.ts` remains the single source of truth — it gains a resolver, it is not re-declared elsewhere. See §4a |

### Tier 4 — Deliberately withheld

**`bl-basket` cart creation.** It drives a logged-in BL session and is the sharpest
operational edge in the system. Members get the analysis; they do not get the
one-click cart.

---

## 4. Sold-history shape — readiness

`price-guide/capture.ts:60` builds `byMonth` from `price_detail[].date_ordered` on
every capture. Each cached row therefore carries **up to six monthly observations
from a single fetch** — `{lots, qty, avg}` per calendar month.

Coverage across 77,534 rows with `soldNew` detail:

| Sold-history depth | Rows | Share |
|---|---|---|
| ≥1 month | 41,283 | 53% |
| **≥3 months** | **23,548** | **30%** |
| ≥5 months | 15,000 | 19% |
| No UK sold history | 36,251 | 47% |

**Item 10 is buildable now**, on ~23.5k tuples at three-plus months.

Two honest limits to carry into the spec:

- Each capture is a **rolling** six-month window, so this reads shape *within* the
  window, not multi-year persistence. Accumulating `bricklink_pg_snapshots` extends
  this beyond six months over time — worth keeping the job healthy, but it is not a
  blocker.
- 47% of rows have no UK sold history at all. Member-facing output must state this
  honestly via the existing provenance mechanism rather than silently falling back.

---

## 4a. Pricing model — catering for Bricqer and non-Bricqer members

**Decision (2026-07-25): assume a mix of Bricqer and non-Bricqer members from the
first cohort**, so the abstraction is exercised by real variance during testing
rather than discovered to be load-bearing after launch.

### The abstraction is nearly free

`bricqer-pricing.ts` is named for Bricqer but its *shape* is general:

```
listPrice = max(floor, ukSoldAvg × multiplier(condition, STR))
```

Only four things are Bricqer-specific: the multiplier values (New 1.10/0.85; Used
1.90/1.40/1.25/1.15/0.93/0.90), the STR band edges (New 0.5; Used
1.5/1.0/0.75/0.5/0.25), the £0.0399 floor, and the exclusion rules (items with a
comment, and sets). Generalising is therefore a parameter extraction, not a
rewrite:

```
listPrice(ukSoldAvg, condition, strQty, model)
model = { bands: { N: [{minStr, mult}], U: [...] }, floor, exclusions }
```

Bricqer becomes the default *named* model, versioned as it already is (v1–v4 in
the file header). Its canonical status is preserved — it just stops being the
only one.

### Injection points are narrow

| Consumer | Impact |
|---|---|
| `bl-store-assessment/engine.ts:210` | The only substantive caller of `bricqerListPrice`. Takes a model parameter |
| `store-quality/engine.ts:401` | Reads the member's **actual** price from their inventory — no model needed |
| `brickradar/priceHistogram.ts`, `TupleDetail.tsx` | Use `BRICQER_PRICE_FLOOR` only. Floor moves into the model |

### What the seller lens does and does not need

A distinction worth holding precisely, because an earlier draft of this document
over-simplified it:

- The seller lens needs **no price *projection*** to report position vs market.
  Their real prices arrive in the BSX or scrape; the comparison is direct.
- The seller lens **does** need pricing-model *inference*, because
  "here is what you are actually doing, and here is what to change" **is** the
  deliverable. Item 9 is not a precursor to the seller lens; it is the heart of it.

What genuinely leaves the critical path is item 12's *configuration and fee
resolution*, which serves the buy lens question — "what could **I** list this at?"
for lots in someone else's store.

### Acquiring a member's pricing model — four routes

The Hadley Bricks formula is known because Chris read it out of the Bricqer UI and
recorded it in `bricqer-pricing.ts`. That will not generalise, so the product needs
a ladder of acquisition routes, most reliable first:

| # | Route | Applies to | Reliability | Status |
|---|---|---|---|---|
| 1 | **Bricqer API** | Bricqer members | Exact, if exposed | **Unverified.** Our client uses only `/api/v1/inventory/*` and `/api/v1/orders/*` — no pricing-rule endpoint. Check the Bricqer API docs during spec |
| 2 | **Self-declared** | Anyone with an explicit rule | Exact | Member reads their own Bricqer/BrickStore rule and enters it — exactly what Chris did. Cheap, reliable, no integration |
| 3 | **Inferred from BSX/scrape** | Everyone | Statistical | The universal fallback. Always run it, even when 1 or 2 succeed — the gap between declared and actual is itself a finding |
| 4 | **Accept: not formulaic** | Manual pricers | n/a | A legitimate outcome, not a failure — see below |

Routes 1 and 2 give a *declared* model; route 3 gives an *observed* one. Running
both is deliberate: a member who believes they price at 1.10× and actually prices
at 1.31× with wide scatter has learned something valuable about their own store.

### Fit quality is a first-class output, not a caveat

Many sellers have no formula at all. The assessment must handle that as a
**diagnosis**, not an error path.

For each segment (condition × item type × price band), compute `ask ÷ benchmark`
and report both central tendency and **dispersion**:

- **Tight dispersion** → formulaic. Report the fitted rule and how well it holds.
- **Wide dispersion** → priced by hand or drifted. Report that plainly, quantify
  the cost, and recommend adopting a rule.
- **Ratio flat across STR** → they are not sell-through aware. This is the single
  most actionable finding available, and it maps directly onto the Bricqer band
  structure: fast movers underpriced, dead stock overpriced.

Two honesty constraints, both already supported by existing mechanisms:

- Only lots with a UK benchmark can be fitted. 47% of cached tuples have no UK sold
  history (§4), so fit coverage must be reported through the existing provenance
  mechanism rather than silently fitted on the covered subset.
- Bricqer disables auto-pricing for items with a comment and for sets. Any
  inference must exclude the same classes or it will fit noise.

### The loop

> **acquire (declared) → infer (observed) → report the gap and the fit quality →
> recommend a rule → use it to project buy-lens net**

A member confirms a model derived from their real listings rather than filling in
a form they cannot answer. For a manual pricer, this is likely the first time
anyone has told them whether they have a strategy at all — which is why it is both
the strongest demo and the honest core of the seller lens.

### Fee stack

Per-member configuration resolved through `fees.ts`:

| Component | Bricqer member | Non-Bricqer member |
|---|---|---|
| BrickLink commission | 3.0% | 3.0% |
| Bricqer | 3.5% | — |
| Payment processing | 2.9% (PayPal) | ~2.9% (PayPal or BL onsite) |
| **Total** | **9.4%** | **~5.9%** |

Two items to verify during the spec rather than assume: BrickLink's current
commission tiering by monthly sales volume, and the BrickLink Payment System rate
where a member does not use PayPal. Both are configuration, not constants.

---

## 5. Architecture decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Tenancy** | Separate schema, same Supabase project | BL data assets stay shared with no sync job. **Caveat:** the project also holds `journal_entries`, `mood_entries`, `weight_readings`, `school_spellings`, `monzo_transactions` and a tournament app with 68 profiles. Member-facing code must run under a DB role scoped to the member schema so a service-role key cannot wander |
| **Member area** | Subdomain app, own Supabase auth, linked from Shopify | hadleybricks.co.uk is Shopify (`6492ae.myshopify.com`, Admin API 2024-10, 1,267 products, order sync live). Shopify's native customer-account gating is thin. At four seats, accounts are created by hand |
| **Scrape engine** | Stays on the local Windows bot | No cloud migration at this scale. **Requires** heartbeat/staleness alerting and an honest "last assessed" timestamp in the member UI, so failures are visible rather than silent |
| **Report contract** | One contract, one renderer set | Per the 2026-07-19 audit rule: every member-facing store answer renders through `bl-store-report`. A web renderer is added *to* that module, not alongside it |
| **Constants** | `fees.ts` remains single source | Gains a per-member resolver (item 12). Never re-declared |

---

## 6. Open items

1. ~~**Member Bricqer usage.**~~ **Resolved 2026-07-25:** assume a mix, to exercise
   both paths during testing. See §4a.
2. **Seat selection criteria.** Which four, and the rule for avoiding own sourcing
   lanes. Commercial, not technical, but it gates the buy-lens release.
3. **Buy-lens exposure policy.** Whether members see buy-side signals live or on a
   lag. Capped seats reduce the risk but do not remove it.
4. **Bricqer API pricing-rule endpoint.** Does `/api/v1/` expose a member's
   auto-pricing configuration? Our client uses only inventory and orders endpoints,
   so this is unknown. Verify against Bricqer's API docs — it decides whether route
   1 in §4a exists or whether Bricqer members fall back to self-declaration.
5. **In-flight collision.** As of 2026-07-25 there is uncommitted work in the tree
   touching `fees.ts`, `partout.service.ts`, `bl-store-assessment/engine.ts` and the
   set-lookup partout components — the same files items 11 and 12 target. Sequence
   after that lands.

---

## 7. Recommended sequence

1. Land the in-flight polish work (open item 5).
2. **Item 6** — member store snapshot, BSX route first. Everything depends on it.
3. **Item 9** — pricing-strategy inference, fit quality and recommendations.
   Earliest demonstrable value; it is the feature that sells the first four seats,
   the core of the seller lens, and the configuration mechanism for item 12 (§4a).
4. **Item 8** — "My Store" review. The retention feature. Needs no price
   *projection* (their real prices come from the snapshot), and consumes item 9's
   inference for its recommendations — deliverable to Bricqer and non-Bricqer
   members alike.
5. **Item 7** — overlap vs member store. Makes items 1–3 honest for a member.
6. **Item 12** — pricing model + fee resolver. Gates the buy lens for non-Bricqer
   members; seed it from item 9's inferred output rather than a config form.
7. **Items 10–11** — STR trust signal, POV concentration.
8. Web renderer, auth, member area, staleness alerting — threaded throughout, not
   a phase.

Items 2 and 4–5 need only polish and can fill gaps whenever a larger item blocks.

**A non-Bricqer member is fully served by steps 2–5.** The buy lens is the only
thing waiting on step 6, which is why the mixed first cohort is safe to run.

---

## 8. Handoff — picking this up on another machine

Written 2026-07-25 on the laptop; work continues on the desktop. Everything needed
to resume is in this file and the branch — nothing important lives only in a
session.

### State

| | |
|---|---|
| Branch | `chore/bl-member-product-strategy` (pushed to origin) |
| Contains | This document only. **No code has been written** |
| Decided | Positioning, capped-seat model, tenancy, member area, ingestion routes, functionality tiers, build sequence |
| Not decided | Open items 2–5 in §6 |
| Next action | Task A below, then `/feature-spec` for item 6 |

### Facts established this session that are not obvious from the code

Recorded here because they were each got wrong once, and because per-machine agent
memory does not travel between the laptop and the desktop.

1. **`bricklink_price_guide_cache.uk_detail` holds monthly sold history.** Each
   quadrant carries a `byMonth` map of `{lots, qty, avg}` keyed by calendar month,
   built from `price_detail[].date_ordered` on every capture
   (`price-guide/capture.ts:60`), plus a `hist` price→quantity map. **A single
   fetch yields up to six monthly observations** — price shape over time is
   available now. Do not conclude from `bricklink_pg_snapshots`' short span that
   there is no time series; the series is *inside each row*, not across rows.
   Coverage in §4.
2. **`bricqerListPrice` is Bricqer-*named*, not Bricqer-*shaped*.** The formula
   `max(floor, ukSoldAvg × multiplier(condition, STR))` generalises by parameter
   extraction. §4a.
3. **The seller lens needs no price projection but does need pricing inference.**
   §4a — this distinction was over-simplified once and it materially changes scope.
4. **Always `git fetch` before reading this repo.** On 2026-07-25 the local
   checkout was 866 commits stale while `git status` reported clean; an entire
   analysis was produced against a six-month-old tree and was wrong on nearly every
   substantive point. Cleanliness says nothing about staleness.

### Task A — Bricqer pricing-rule discovery (do this first)

Resolves open item 4 and decides whether §4a route 1 exists. Small, self-contained,
and it gates the onboarding design for Bricqer members.

**Question:** does the Bricqer API expose a store's auto-pricing configuration — the
multiplier bands, floor and exclusion rules — or must a Bricqer member read their
own formula out of the UI and declare it?

**Where to look:**
- Bricqer API docs: https://www.bricqer.com/guides/using-the-api
- Our client: `apps/web/src/lib/bricqer/client.ts` — currently uses only
  `/api/v1/inventory/*` and `/api/v1/orders/*`. No pricing endpoint is referenced
  anywhere in the repo, which is suggestive but not conclusive
- Credentials: API key + tenant URL, per `CLAUDE.md`

**Outcomes:**
- *Exposed* → build route 1. Bricqer members onboard with an exact model, zero
  manual entry. Update §4a and the item 12 spec
- *Not exposed* → route 2 (self-declaration) becomes the Bricqer path. The member
  reads their auto-pricing settings out of the Bricqer UI and enters the bands,
  exactly as was done for `bricqer-pricing.ts`. Design a small band-entry form
- *Either way* → route 3 (inference) always runs, and the declared-vs-observed gap
  is reported as a finding

### Then

1. Confirm open item 5 (in-flight work on `fees.ts`, `partout.service.ts`,
   `bl-store-assessment/engine.ts`, set-lookup partout components) has landed.
2. `/define-done` then `/feature-spec` for **item 6 — member store snapshot**,
   BSX route first. Everything else depends on that object existing.
