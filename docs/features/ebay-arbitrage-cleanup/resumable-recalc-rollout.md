# eBay FP Cleanup — Resumable Recalc Rollout

## What changed

The daily 04:00 UTC fp-cleanup was hitting Vercel's 300s wall because
`recalculateAggregatesAfterExclusions()` scales with the count of sets that
have previous exclusions. It now:

1. Uses a time budget (default 250s in the route; 85% of that inside recalc
   before it stops). Batch size dropped 50 → 15 so we checkpoint more often.
2. Saves a cursor (`checkpoint_data` JSONB column on `arbitrage_sync_status`)
   when it runs out of budget.
3. On the next invocation, detects the checkpoint, skips scan/score, and
   resumes recalc from the cursor.
4. Clears the checkpoint and marks `status=completed` only when recalc fully
   finishes.

Status semantics:
- `running` — a checkpoint exists; next cron run will resume.
- `completed` — fully done, checkpoint cleared.
- `failed` — errored out; check `error_message`.

## Required rollout steps

1. **Apply migration** `20260423000001_fp_cleanup_checkpoint.sql`
   - Adds `checkpoint_data JSONB` to `arbitrage_sync_status`.
   - Safe to apply ahead of the code deploy (column is unused by the old code).

2. **Deploy code** — merge the PR; Vercel picks up `route.ts` + service.

3. **Update Google Cloud Scheduler** — change the `ebay-fp-cleanup` job from
   once-a-day to multiple tries in the morning so a backlog can finish in
   one calendar day:

   ```bash
   gcloud scheduler jobs update http ebay-fp-cleanup \
     --schedule "0,15,30,45 4 * * *" \
     --location <YOUR_LOCATION>
   ```

   Cron meaning: 04:00, 04:15, 04:30, 04:45 UTC (4 runs, 15 min apart).
   - Most days the first run completes fully; runs 2–4 see the
     `status=completed` + no checkpoint and exit in milliseconds.
   - On heavy days each run chews through ~4 minutes of recalc, commits its
     batch, and the next run resumes. 4 × ~4 min covers ~16 min of real work.

## Manual test

Once deployed, trigger a run manually:

```bash
curl -sS -X POST https://<your-app>/api/cron/ebay-fp-cleanup \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Expected shape:
```json
{
  "success": true,
  "complete": true|false,
  "phase": "done" | "recalc" | "resumed-recalc" | "scan",
  "resumeAfterSet": null | "10355",
  "aggregatesRecalculated": 234,
  "duration": 87421,
  "durationStr": "1 min"
}
```

If `complete: false`, run the same command again — it should pick up from
`resumeAfterSet` and either finish (`complete: true`) or save a new
checkpoint further along.

## Rollback

- Revert the code PR (leaves the DB column, which is harmless).
- Restore GCS cron to `0 4 * * *`.
