#!/usr/bin/env bash
# Continuous USED Part-Out-Value backfill loop (condition=U, no RRP, 1980->now, vintage-inclusive).
#
# Runs 1000-set chunks newest-first with a 10-min gap between them, until Used is fully covered
# (0 new sets), the CDP Chrome dies, or a (generous, continuous-mode) time cap. Each chunk
# self-heals on a BL throttle via the in-script ~13-min breather. Fully re-run-safe: the anti-join
# skip-fresh means a relaunch resumes exactly where it left off and never re-scrapes a covered set.
#
# Used differs from the New loop (pov-overnight.sh): condition=U, --skip-rrp (RRP irrelevant for the
# whole-vs-parted call, partout_multiple stays null), --year-min=1980 --min-digits=3 (include vintage),
# and a longer default deadline for a continuous multi-day run (~14,642 sets @ ~160/hr ~= 90 hours).
#
# Prereqs: the dedicated throwaway BL account (domham91) logged into the CDP Chrome (:9225),
# behind a VPN. Sold/for-sale convert USD->GBP via bricklink_pov_config.usd_to_gbp_rate.
#
# Usage (from apps/web), detached:
#   nohup bash scripts/pov-overnight-used.sh > ../../tmp/pov-backfill/used-overnight.log 2>&1 &
# Tunables via env: LIMIT, DELAY_MS, GAP_SECONDS, DEADLINE_HOURS, MAX_ITERS.
set -u
cd "$(dirname "$0")/.." || exit 1
LOCK="../../tmp/pov-backfill/backfill.lock"
LIMIT=${LIMIT:-1000}
DELAY_MS=${DELAY_MS:-12000}
GAP_SECONDS=${GAP_SECONDS:-600}        # 10 min between chunks (lets the IP throttle window relax)
MAX_ITERS=${MAX_ITERS:-40}             # backstop: ~14,642 / 1000 ~= 15 chunks, 40 is ample
DEADLINE_HOURS=${DEADLINE_HOURS:-120}  # continuous-mode cap (~5 days); resumable, so relaunch if hit
DEADLINE=$(( $(date +%s) + DEADLINE_HOURS*3600 ))

echo "[used-overnight] starting $(date)  (limit=${LIMIT}, delay=${DELAY_MS}ms, gap=${GAP_SECONDS}s, deadline=${DEADLINE_HOURS}h)"
for ((iter=1; iter<=MAX_ITERS; iter++)); do
  # Wait for any in-flight run to release the lock before starting a new chunk.
  while [ -f "$LOCK" ]; do sleep 30; done
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "[used-overnight] ${DEADLINE_HOURS}h cap reached — stopping (relaunch to resume)."; break; fi

  echo "[used-overnight] === chunk $iter starting $(date) ==="
  TMP=$(mktemp)
  npx tsx scripts/pov-backfill.ts --limit="$LIMIT" --condition=U --skip-rrp --year-min=1980 --min-digits=3 --delay-ms="$DELAY_MS" 2>&1 | tee "$TMP"

  # Stop conditions. Match ONLY the zero-candidates line ("] 0 new") — not a substring of "1000 new".
  if grep -qE "\] 0 new sets to scrape" "$TMP"; then echo "[used-overnight] All Used sets covered — done."; rm -f "$TMP"; break; fi
  if grep -qiE "CDP unreachable|fetch failed|CDP Chrome still up" "$TMP"; then echo "[used-overnight] CDP Chrome down — stopping (relaunch + resume)."; rm -f "$TMP"; break; fi
  rm -f "$TMP"

  echo "[used-overnight] chunk $iter done — ${GAP_SECONDS}s breather before next."
  sleep "$GAP_SECONDS"
done
echo "[used-overnight] finished $(date)"
