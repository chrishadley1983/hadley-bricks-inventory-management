# Merge Report: fix/monzo-sync-category-guard (+ precedent recency follow-up)

**Date:** 2026-08-02
**Track:** Fix
**PRs:** #659 (`fix/monzo-sync-category-guard`), #660 (`fix/monzo-precedent-recency`)
**Main commits:** `d2f3b7f6` (#659), `0223bf12` (#660)

## What shipped

Monzo sheets sync no longer trusts the sheet's category (Monzo's per-merchant
auto-guess) — our own rules validate every new row:

1. Strong merchant precedent (≥3 rows, ≥90% one category, **last 365 days
   only**) overrides the sheet outright.
2. `PAYPAL *` rows never trust the sheet: precedent, else Lego Parts.
3. Trusted-taxonomy sheet category accepted.
4. Weak precedent fills untrusted gaps; else NULL → review queue.

Plus: `transactions.uncategorised` workflow count fixed to read
`local_category is null` (was `category is null` = always 4,662), and a failed
existing-rows fetch now aborts the sync instead of risking a mass category
overwrite (CR-001).

The 365-day precedent window (#660) came out of the pre-deploy Q1 back-test:
eBay's 1,771 label-era 'Postage' rows (to Feb 2025) would otherwise have set
the precedent and tagged every future eBay stock purchase (PAYPAL descriptor)
as Postage.

## Verification

- Code review: CR-001 fixed in-branch; CR-002 (archived rows in precedent,
  negligible) and CR-003 (PayPal fallback labels one-off individual purchases
  Lego Parts — MTD-box-neutral) noted.
- `tsc --noEmit`, ESLint clean; 104 vitest tests passing (26 for the rules).
- Vercel Production deploy of `0223bf12` succeeded 2026-08-02T20:36:43Z;
  /login 200, protected APIs 401.
- Local NSSM server rebuilt + restarted via `scripts/redeploy-local.ps1`.

## Q1 back-test (would-change analysis)

Rules replayed over all Q1 2026/27 rows (6 Apr – 5 Jul) against stored
(submitted) categories. Stored rows are never modified by the sync (existing
values are kept verbatim); this measures what the rules would do to similar
future rows. 8 diffs, none affecting the Q1 return:

- 5 PayPal purchases from individuals/BL sellers (£321.44): stored Lego Stock,
  rules say Lego Parts — same MTD Stock Purchase box either way.
- 2 eBay rows (£21.01): stored Packing Materials, rules say Lego Stock via
  strong eBay precedent — future deliberate Packing tags on eBay will need a
  manual flip in the app.
- Alaya Contreras £20: stored Personal (confirmed), rules would say Lego
  Parts — known F&F-send trade-off; one-off personal PayPal sends need a
  manual flip.

## Rollback

`/merge-feature rollback` or `git revert -m 1 0223bf12 && git revert -m 1 d2f3b7f6`.
