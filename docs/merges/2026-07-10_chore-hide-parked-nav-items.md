# Merge Report: chore/hide-parked-nav-items

**Date:** 2026-07-10
**PR:** #552 (squash-merged 06:36 UTC)
**Merge commit:** `19531420`
**Previous main:** `ca04d367` (#551)
**Track:** FEATURE (chore/*) — trivial nav-only change, one file

## What changed

`apps/web/src/components/layout/Sidebar.tsx` only:

- **Scanner** and **Order Issues** removed from the sidebar, commented out with
  dated "Parked for future dev (2026-07-10)" markers so they're easy to restore.
  The pages remain reachable by direct URL (`/scanner`, `/scanner/live`,
  `/scanner/set-check`, `/order-issues`).
- Top-left nav restructured: **Workflow** stays pinned above the sections;
  Dashboard → BrickLink Uploads moved into a new collapsible **Operations**
  section (`defaultOpen: true`, auto-opens when a child route is active),
  reusing the existing `NavSection` machinery.

## Verification

| Check | Result |
|-------|--------|
| Local typecheck (`tsc --noEmit`) | ✅ clean |
| Local eslint on changed file | ✅ clean |
| CI "Typecheck, Lint & Test" | ✅ pass |
| Vercel production deploy (`bat658dxo`) | ✅ Ready, aliased to production |
| Prod critical paths (Dashboard/Inventory/Orders/Order detail) | ✅ 4/4 |
| Prod sidebar smoke (parked links absent, Operations collapses + re-expands, `/scanner` still renders by URL) | ✅ pass |
| Local NSSM server rebuild + restart (`scripts/redeploy-local.ps1`) | run post-merge (see last-deploy.json) |

## Notes

- E2E auth state (`apps/web/.playwright/.auth/user.json`) had expired (May 30).
  Added `apps/web/scripts/_refresh-e2e-auth-prod.ts` (untracked, `_` convention):
  same magic-link mint as `_refresh-e2e-auth.ts` but writes the session cookie for
  **localhost and the vercel.app domain**, so the same storage state drives both
  local and production Playwright runs. Data account: `chris@hadleybricks.co.uk`.
- First `gh pr merge --delete-branch` errored locally because `main` is checked
  out in the `hb-dashboard-wt` worktree — the GitHub merge itself succeeded;
  branch cleanup was done manually (local + remote deleted).

## Rollback

Single-file UI change, no schema/API impact:

```powershell
git revert 19531420
git push origin main
```
