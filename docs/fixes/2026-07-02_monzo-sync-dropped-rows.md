# Fix: Monzo sheet-sync silently drops late-exported rows

**Date:** 2026-07-02
**Branch:** `fix/monzo-sync-dropped-rows`
**File:** `apps/web/src/lib/monzo/monzo-sheets-sync.service.ts`

## Symptom

55 transactions present in the "Monzo Transactions" Google Sheet were missing from
`monzo_transactions` in Supabase: 7 rows in Mar 2026 (net £145.39), 32 in Jun 2026
(net +£553.57 — including a £550 PayPal withdrawal, the £16.53 Brick Owl fee
invoice, and a £163.79 eBay payout), 16 in early Jul 2026. Knock-on effects:
computed balance snapshots read ~£554 low from 22 Jun; P&L income and Selling
Fees understated.

## Root cause

`performSync` (INCREMENTAL) filtered sheet rows by **transaction date** against
the last completed sync time:

```ts
.filter((row) => {
  if (!lastSyncDate) return true;
  const txDate = this.parseSheetDate(row.Date, row.Time);
  return txDate && txDate > lastSyncDate;
})
```

This assumes the Monzo→Sheets export appends rows in near-real-time. On 23 Jun
2026 the 05:40 sync completed with **0 rows processed** despite a busy 22 Jun —
the export had stalled. When it caught up, the late-written rows carried
transaction timestamps *before* the new cursor, so every subsequent incremental
sync skipped them permanently.

## Fix

Admit any sheet row whose `Transaction ID` is not already in the DB, regardless
of its timestamp. The service already loads all existing IDs (`existingMap`)
before this point, so the check is free:

```ts
if (!existingMap.has(row['Transaction ID'])) return true;
```

A row is now skipped only if it is **both** already present **and** older than
the cursor. Late-arriving rows self-heal on the next sync.

## Data remediation (already applied, pre-fix)

- `apps/web/scripts/_monzo-backfill-full-sync.ts` — diffed sheet vs DB
  (4,590 vs 4,535) and ran `performFullSync` to backfill the 55 rows;
  post-run diff = 0 missing. `local_category` edits preserved by design.
- `apps/web/scripts/monzo-recategorise.ts --apply` run for 2026-03 / 06 / 07
  to categorise the backfilled rows (9 changes).

## Verification

- `npm run typecheck` — clean
- `npx vitest run src/lib/monzo` — 78/78 pass
- Post-deploy smoke test: trigger `/api/cron/monzo-sync` in prod, confirm
  COMPLETED sync log, then re-run the sheet-vs-DB ID diff → expect 0 missing.
