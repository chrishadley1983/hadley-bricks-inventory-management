#!/usr/bin/env bash
# Overnight POV backfill loop: runs 1000-set chunks with a 10-min gap between them, until New is
# fully covered (0 new sets), the CDP Chrome dies, or a safety time cap. Each chunk self-heals on
# throttle via the in-script breather. Re-run-safe (skip-fresh anti-join).
#
# Usage (from apps/web), detached:  nohup bash scripts/pov-overnight.sh > ../../tmp/pov-backfill/overnight.log 2>&1 &
set -u
cd "$(dirname "$0")/.." || exit 1
LOCK="../../tmp/pov-backfill/backfill.lock"
GAP_SECONDS=600          # 10 min between chunks
MAX_ITERS=40             # backstop (40 * ~877 ≈ all of New)
DEADLINE=$(( $(date +%s) + 14*3600 ))   # 14h safety cap

echo "[overnight] starting $(date)  (gap=${GAP_SECONDS}s, max_iters=${MAX_ITERS})"
for ((iter=1; iter<=MAX_ITERS; iter++)); do
  # Wait for any in-flight run to release the lock before starting a new chunk.
  while [ -f "$LOCK" ]; do sleep 30; done
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "[overnight] 14h cap reached — stopping."; break; fi

  echo "[overnight] === chunk $iter starting $(date) ==="
  TMP=$(mktemp)
  npx tsx scripts/pov-backfill.ts --limit=1000 --year-min=2010 --delay-ms=12000 2>&1 | tee "$TMP"

  # Stop conditions
  # Match ONLY the zero-candidates line — "] 0 new" (not a substring of "1000 new", etc.).
  if grep -qE "\] 0 new sets to scrape" "$TMP"; then echo "[overnight] All New sets covered — done."; rm -f "$TMP"; break; fi
  if grep -qiE "CDP unreachable|fetch failed|CDP Chrome still up" "$TMP"; then echo "[overnight] CDP Chrome down — stopping (relaunch + resume in the morning)."; rm -f "$TMP"; break; fi
  rm -f "$TMP"

  echo "[overnight] chunk $iter done — ${GAP_SECONDS}s breather before next."
  sleep "$GAP_SECONDS"
done
echo "[overnight] finished $(date)"
