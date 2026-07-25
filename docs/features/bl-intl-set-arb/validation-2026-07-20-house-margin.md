# Validation Report — PR #625 `fix/set-arb-house-margin`

**Date:** 2026-07-20
**Merge commit:** `422cd9b4` (on `origin/main`)
**Deployed:** Vercel production + local NSSM rebuilt
**Ratified contract (Chris, 2026-07-20):** decision is NET margin % of SALE only — GREEN >0.25, AMBER >0.15, drop below. `net = sale*(1-0.17) - 4 - landed_unit_gbp`. Constants ONLY from `apps/web/src/lib/investment/max-buy.ts` (`MAX_BUY_FEE=0.17`, `MAX_BUY_SHIP=4`, `GREEN=0.25`, `AMBER=0.15`). BSR + drops90 are displayed info, NEVER a gate.

---

## Verdict

# PASS-WITH-FINDINGS

27 checks across 5 auditors: **24 PASS, 3 WARN, 0 FAIL.** Of the 3 WARNs, one was upheld by the referee (a minor documentation defect in `SKILL.md` — no runtime impact) and two were refuted after independent live re-verification (benign concurrent-writer skew; pre-existing RPC ops observations outside the contract). The ratified margin-only contract is correctly implemented end to end: maths, gating, freshness folding, RPC cadence, deploy, and constants hygiene all hold on live production data.

### Check summary

| Auditor | Checks | PASS | WARN | FAIL |
|---|---|---|---|---|
| contract-math | 5 | 5 | 0 | 0 |
| data-integrity | 6 | 6 | 0 | 0 |
| completeness | 5 | 4 | 1 (refuted) | 0 |
| rpc-cadence | 5 | 4 | 1 (refuted) | 0 |
| deploy-docs | 6 | 5 | 1 (upheld, minor) | 0 |
| **Total** | **27** | **24** | **3** | **0** |

---

## Evidence highlights (strongest PASS evidence per auditor)

### contract-math — all 5 PASS
- **UK landed cost re-derived independently**: `landed_unit_gbp = buy + weight_g/100*0.15 + 4/10` reproduced within ±0.02 on active candidates.
- **`sell_net_gbp = round2(sell_price_gbp*0.83 - 4)`** verified within ±0.01 — the exact ratified fee stack (17% fee + £4 ship), constants imported from `max-buy.ts`, nowhere re-declared.
- **Conservative margin confirmed**: `net_margin_pct = min(pct @ sell_price_gbp, pct @ was_price_90d when present)` within ±0.001, and `net_margin_gbp = round2(sell_net_gbp - landed_unit_gbp)` within ±0.02.
- **Flag floor holds**: every ACTIVE row in `bl_set_arb_candidates` has conservative `net_margin_pct >= 0.15`.

### data-integrity — all 6 PASS
- Zero active rows below the 0.15 conservative floor; zero active rows with null `sell_price_gbp`.
- Snapshot staleness consistent with the 45-day per-field latest-non-null fold window; `amazon_snapshot_date` age distribution on active rows is healthy.
- New informational columns (`was_price_90d`, `sales_rank`, `amazon_snapshot_date`) nullable as designed — informational only, never gating.
- No excluded/bought candidate was resurrected by the new flagger run.

### completeness — 4 PASS, 1 WARN (refuted)
- **False-negative sweep**: over a 400-row random sample of S-type cache rows (fetched ≤10d, stock_offers present), every (set, store) pair with conservative pct ≥ 0.15 exists as an active candidate.
- **False-positive sweep**: every pair below 0.15 — or lacking identity/weight/sell-side data — is NOT active.
- **Gate boundary behaviour** at the 0.15 conservative floor is exact (no off-by-rounding admissions or drops).

### rpc-cadence — 4 PASS, 1 WARN (refuted)
- **Weekly in-stock rule is live in the database**: no qty>0 row with a snapshot fresher than 7 days appears in today's `get_keepa_priority_asins` result; qty>0 ASINs with snapshot NULL or ≤ today−7 appear at priority 1.
- qty-0 stale-daily arm and the arb arm (Brickset conf ≥95 + fresh PG offers ≤10d) both verified unchanged, including Bricktraders ASIN membership and indirect volume checks.

### deploy-docs — 5 PASS, 1 WARN (upheld)
- Prod: `/arbitrage` returns 200; `/api/arbitrage/intl` returns 401 unauthenticated. Local NSSM `localhost:3000/arbitrage` responds.
- **Constants hygiene**: no hardcoded `0.58` or duplicate margin bands anywhere under `apps/web/src`.
- intl route exposes the new fields; `/arbitrage` page renders the BSR column and `QuoteAgeBadge`.
- Merge commit `422cd9b4` confirmed on `origin/main`.

---

## Upheld findings

### 1. SKILL.md dangling BSR-gate clause — **minor**

**Check:** deploy-docs — "SKILL.md: ratified margin-only rule present, no active drops90<15 gate" (WARN, referee upheld).

**Defect:** Lines 168–171 of `.claude/skills/set-buy-check/SKILL.md` still read: *"the BSR/velocity gate above is still mandatory. A £8 set with a 900k BSR is not a BUY"* — a dangling cross-reference to the drops90<15 / BSR>200k gate that PR #625 (commit `241ef4db`, the only commit touching this file on the branch) deleted from Route B in the same document, with a commit message claiming full removal. The clause is not an independently ratified exception: the 2026-07-20 contract ("BSR + drops90 are displayed info, NEVER a gate") has no sub-£15 carve-out. Because the text is imperative, a future skill run could reintroduce BSR gating on sub-£15 Amazon-route sets, contradicting lines 110–116 of the same document.

**Why minor, not blocker:** confined to skill instructions — no runtime code (`flagger.service.ts`, `landed-cost.ts`, RPC `get_keepa_priority_asins`, `/arbitrage` page) contains any BSR/drops90 gate.

**Recommended action:** two-line doc edit — delete or rewrite the "except" clause at lines 168–171 of `.claude/skills/set-buy-check/SKILL.md` in margin-only terms, so the entire document is consistent with the ratified contract.

---

## Refuted findings (no action required)

- **Stored margin fidelity (completeness WARN)** — refuted: the ~2.9pp drift on candidate `aa0b9d1f` (76831) is pure read-time vs audit-time skew from the independent 30-min Keepa scheduler (snapshot written 14:57:34, flagger fold read earlier, write at 15:04:34); replaying the fold *excluding* the 14:57 row reproduces the stored row bit-for-bit, the stored figure is the *more* conservative of the two, both bases are GREEN, and the in-run Keepa top-up correctly did not fire (quote 24d old, under the 28d backstop). Nothing to fix in PR #625.
- **RPC operational health (rpc-cadence WARN)** — refuted as a #625 defect: the 1000-row cap (PostgREST server max-rows) only binds at budgets >1000, and the sole production caller uses `DEFAULT_BUDGET_PER_INVOCATION=57`; the ~6s cold latency stems from query shape that predates #625 (migrations 20260310000002 / 20260718110000), and the ratified contract says nothing about RPC latency/row limits. **Retained as ops notes:** a composite index on `(asin, snapshot_date DESC)` or a LATERAL rewrite would derisk the cron as `amazon_arbitrage_pricing` grows; any future caller wanting >1000 rows must paginate via Range headers.
