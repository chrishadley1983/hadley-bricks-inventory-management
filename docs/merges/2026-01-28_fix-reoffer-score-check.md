# Merge Report: fix/reoffer-score-check

**Merged At:** 2026-01-28T09:58:11Z
**Merge Commit:** e2355001f3a79ff4f150822a94c6cbfacb73e8f8
**PR:** https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/22
**Track:** FIX

## Summary

Fixed the re-offer discount escalation logic to only escalate when the current score still warrants it.

### Problem

Re-offers were always escalating from the previous discount (+5%) regardless of the current score. For example:
- Previous offer: 20% (when score was 70)
- Current score: 64 (improved - more watchers)
- Old behavior: 25% (20% + 5% escalation)
- New behavior: 15% (based on current score)

### Solution

- Added `lastScore` to `ReOfferEligibility` type
- Modified re-offer logic to compare `currentScore >= previousScore`
- If score is same or worse → escalate as before
- If score improved (lower) → use current score's discount

## Files Changed

| File | Changes |
|------|---------|
| `apps/web/src/lib/ebay/negotiation.service.ts` | Score comparison logic |
| `apps/web/src/lib/ebay/negotiation.types.ts` | Added `lastScore` field |

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript | PASS |
| Code Review | PASS (APPROVED) |
| Production Health | PASS (HTTP 307) |

## Cleanup

| Action | Status |
|--------|--------|
| PR Merged | Complete |
| Local branch deleted | Complete |
| Remote branch deleted | Complete |
| References pruned | Complete |
