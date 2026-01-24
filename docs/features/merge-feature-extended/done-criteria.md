# Done Criteria: merge-feature-extended

**Created:** 2026-01-24
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

Extend the Merge Feature Agent to include deployment verification capabilities. Since Vercel auto-deploys on merge to main, merge = deploy, so the agent must own the full "get code to production safely" workflow including preview verification, post-deploy verification, and rollback capability.

**Problem:** Merge Feature Agent handles git operations but doesn't verify Vercel deployments succeed. Unverified merges can break production without immediate detection.
**User:** Developer (Chris) merging feature/fix branches to main
**Trigger:** Running `/merge-feature` commands
**Outcome:** Safe deployments with pre-merge preview verification, post-merge production verification, track-based prerequisites, and rollback capability

---

## Success Criteria

### Functional

#### F1: Track Detection from Branch Name
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent correctly identifies track from branch naming convention: `feature/*`, `chore/*`, `refactor/*` → FEATURE track; `fix/*`, `hotfix/*`, `bugfix/*` → FIX track; other branches → FEATURE (default)
- **Evidence:** Unit test with various branch name inputs returns correct track classification
- **Test:** `describe('detectTrack')` test cases cover all branch patterns

#### F2: Check Mode Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `/merge-feature check` outputs a readiness report showing track, prerequisites checklist with pass/fail status, and clear "Ready to merge" or "NOT READY" conclusion without taking any action
- **Evidence:** Agent output contains track identification, prerequisite statuses, and readiness conclusion
- **Test:** Run `/merge-feature check` on a feature branch and verify output format matches spec

#### F3: Preview Mode Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `/merge-feature preview` retrieves preview URL via Vercel CLI, runs Playwright critical path tests against that URL, and reports pass/fail with timing for each path
- **Evidence:** Output shows preview URL, test results for each critical path with duration
- **Test:** Run `/merge-feature preview` and verify Playwright tests execute against preview URL

#### F4: Verify-Production Mode Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `/merge-feature verify-production` runs Playwright critical path tests against production URL and reports health status
- **Evidence:** Output shows production URL, test results for each critical path, and overall HEALTHY/UNHEALTHY status
- **Test:** Run `/merge-feature verify-production` and verify tests execute against production

#### F5: Rollback Mode Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `/merge-feature rollback` shows confirmation prompt with last merge details, creates revert commit on confirmation, pushes to origin, waits for redeploy, and runs post-deploy verification
- **Evidence:** Confirmation prompt shown; git log shows revert commit after confirmation; verification results displayed
- **Test:** Run `/merge-feature rollback`, confirm, verify revert commit created and verification runs

#### F6: Extended Merge Process
- **Tag:** AUTO_VERIFY
- **Criterion:** Running `/merge-feature <branch>` executes extended flow: check prerequisites → merge → push → wait for Vercel deploy → run verify-production; if post-deploy fails, output recommends rollback command
- **Evidence:** Merge report includes "Deployment Verification" section with pre-merge and post-merge results
- **Test:** Complete merge of a feature branch and verify merge report contains deployment verification section

#### F7: Config File Created
- **Tag:** AUTO_VERIFY
- **Criterion:** File `docs/agents/merge-feature/config.json` exists with valid JSON containing: `vercel.productionUrl`, `vercel.previewUrlPattern`, `vercel.deployTimeout`, `verification.pageLoadTimeout`, `verification.checkConsoleErrors`, `tracks.feature.*`, `tracks.fix.*`
- **Evidence:** File exists and parses as valid JSON with all required fields
- **Test:** `JSON.parse(fs.readFileSync('docs/agents/merge-feature/config.json'))` succeeds and contains required keys

#### F8: Critical Paths File Created
- **Tag:** AUTO_VERIFY
- **Criterion:** File `docs/agents/merge-feature/critical-paths.ts` exists with exported `criticalPaths` array containing Playwright test definitions for: Dashboard (`/`), Inventory (`/inventory`), Orders (`/orders`), Single Order (`/orders/[id]`)
- **Evidence:** File exists with TypeScript export; array contains 4 path definitions with name, path, expect, and timeout fields
- **Test:** File can be imported and `criticalPaths.length === 4`

#### F9: Last Deploy Tracking
- **Tag:** AUTO_VERIFY
- **Criterion:** After each successful merge, file `docs/agents/merge-feature/last-deploy.json` is created/updated containing: `commit`, `branch`, `mergedAt` (ISO timestamp), `verificationStatus`, `criticalPathResults` array
- **Evidence:** File content matches expected schema after merge completes
- **Test:** After merge, read file and verify all required fields present with valid values

#### F10: Vercel CLI Preview URL Retrieval
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent uses `vercel ls` command to retrieve preview deployment URL for the current branch; handles "not ready yet" state by polling with configurable timeout
- **Evidence:** Agent logs show `vercel ls` execution; preview URL matches expected pattern
- **Test:** Run preview mode on pushed branch, verify Vercel CLI called and URL retrieved

#### F11: Playwright Tests Run Authenticated
- **Tag:** AUTO_VERIFY
- **Criterion:** Critical path Playwright tests authenticate before accessing protected routes; tests successfully access pages that require login
- **Evidence:** Playwright test logs show auth step; protected pages return 200 not 401/redirect
- **Test:** Run critical path tests, verify `/inventory` and `/orders` pages load successfully (not redirected to login)

#### F12: Check Mode Validates Track Prerequisites
- **Tag:** AUTO_VERIFY
- **Criterion:** For FEATURE track, check mode validates: done-criteria exists in `docs/features/<name>/`, verify-done passed, `/test-execute pre-merge` passed, `/code-review branch` completed. For FIX track, validates: `/code-review branch` completed only
- **Evidence:** Check output shows each prerequisite with pass/fail status appropriate to detected track
- **Test:** Run check on feature branch missing done-criteria, verify it shows as blocker; run on fix branch, verify done-criteria not required

#### F13: Uses Existing Playwright Auth Helpers
- **Tag:** AUTO_VERIFY
- **Criterion:** Critical path tests import and use existing Playwright authentication helpers from the test infrastructure rather than implementing new auth flow
- **Evidence:** `critical-paths.ts` or test file imports from existing auth helper location
- **Test:** Grep critical paths file for import statement referencing existing auth helpers

---

### Error Handling

#### E1: Vercel CLI Not Available
- **Tag:** AUTO_VERIFY
- **Criterion:** If `vercel` command is not found in PATH, agent displays error message that includes installation instructions (`npm i -g vercel` or `pnpm add -g vercel`)
- **Evidence:** Error output contains "vercel" and installation command
- **Test:** Temporarily rename/hide vercel binary, run preview mode, verify error message

#### E2: Preview URL Not Ready
- **Tag:** AUTO_VERIFY
- **Criterion:** If Vercel preview deployment is still building, agent polls every 5 seconds up to configured timeout; after timeout expires, shows clear message with instructions to check Vercel dashboard manually
- **Evidence:** Agent logs show polling attempts; timeout message includes Vercel dashboard URL
- **Test:** Run preview immediately after push (before deploy completes), verify polling behavior and timeout handling

#### E3: Critical Path Test Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If any critical path test fails, agent reports which specific paths failed with error details (timeout, HTTP status, or error message); for preview mode, does not proceed to merge; for production mode, recommends rollback
- **Evidence:** Failure output lists failed path names with specific error details
- **Test:** Modify critical path to expect non-existent element, run tests, verify failure report format

#### E4: Rollback Confirmation Required
- **Tag:** AUTO_VERIFY
- **Criterion:** Rollback mode displays confirmation prompt showing: merge commit hash, branch name, merge timestamp, and what will happen; requires explicit user input before proceeding; typing anything other than 'confirm' aborts
- **Evidence:** Prompt text includes commit details and "Type 'confirm' to proceed" instruction
- **Test:** Run rollback, verify prompt appears; type 'cancel', verify no revert commit created

#### E5: Post-Deploy Verification Failure Warning
- **Tag:** AUTO_VERIFY
- **Criterion:** If post-deploy verification fails after merge, agent outputs warning banner with "POST-DEPLOY VERIFICATION FAILED", lists failed paths, and includes exact command `/merge-feature rollback` for quick recovery
- **Evidence:** Warning output contains failure banner, failed path list, and rollback command
- **Test:** Mock critical path failure after deploy, verify warning format includes rollback command

---

### Performance

#### P1: Deploy Wait Timeout Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** Config file contains `vercel.deployTimeout` set to 120000 (120 seconds) as default; agent respects this timeout when waiting for deployment
- **Evidence:** Config JSON has `deployTimeout: 120000`; agent stops waiting after configured time
- **Test:** Read config file and verify value; set low timeout and verify agent respects it

#### P2: Page Load Timeout Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** Config file contains `verification.pageLoadTimeout` set to 15000 (15 seconds) as default; Playwright tests use this timeout for page navigation
- **Evidence:** Config JSON has `pageLoadTimeout: 15000`; Playwright tests configured with this timeout
- **Test:** Read config file and verify value; check Playwright test timeout configuration

#### P3: Polling Interval
- **Tag:** AUTO_VERIFY
- **Criterion:** When waiting for deployment, agent polls for readiness every 5 seconds (not more frequently to avoid rate limits, not less frequently for reasonable UX)
- **Evidence:** Agent logs show approximately 5-second gaps between poll attempts
- **Test:** Run preview on pending deployment, measure time between poll log entries

---

### Integration

#### I1: Agent Spec Updated
- **Tag:** AUTO_VERIFY
- **Criterion:** File `docs/agents/merge-feature-agent.md` is updated to include: new modes (`check`, `preview`, `verify-production`, `rollback`), track detection documentation, extended merge process flow, configuration file references
- **Evidence:** Markdown file contains sections for all new modes and track detection
- **Test:** Grep agent spec for new mode names and track detection section

#### I2: Existing Modes Preserved
- **Tag:** AUTO_VERIFY
- **Criterion:** Existing `/merge-feature` modes (`<branch-name>`, `auto`, `list`, `status`) continue to function as documented in original spec
- **Evidence:** Running each existing mode produces expected output matching original behavior
- **Test:** Run `list` and `status` modes, verify output format unchanged

#### I3: Playwright Test Infrastructure Integration
- **Tag:** AUTO_VERIFY
- **Criterion:** Critical path tests integrate with existing Playwright setup in `tests/e2e/playwright/`; no additional Playwright configuration or dependencies required
- **Evidence:** Tests run using existing `playwright.config.ts`; no new devDependencies added for Playwright
- **Test:** Run critical path tests, verify they use existing config; check package.json for no new Playwright deps

---

## Out of Scope

- Sentry integration for error monitoring
- GitHub deployment API integration (using Vercel CLI instead)
- Automatic rollback without confirmation
- PR-based workflow (project uses direct push to main)
- CI/CD pipeline integration beyond Vercel auto-deploy
- Custom verification for specific features (only critical paths)
- Slack/Discord notifications for deploy status
- Deploy history beyond last deploy (single `last-deploy.json`)

---

## Dependencies

- Vercel CLI installed globally (`npm i -g vercel`)
- Vercel project linked and authenticated
- Existing Playwright test infrastructure in `tests/e2e/playwright/`
- Existing Playwright auth helpers
- Existing merge-feature-agent.md spec

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Track detection from branch name | AUTO_VERIFY | PENDING |
| F2 | Check mode exists | AUTO_VERIFY | PENDING |
| F3 | Preview mode exists | AUTO_VERIFY | PENDING |
| F4 | Verify-production mode exists | AUTO_VERIFY | PENDING |
| F5 | Rollback mode exists | AUTO_VERIFY | PENDING |
| F6 | Extended merge process | AUTO_VERIFY | PENDING |
| F7 | Config file created | AUTO_VERIFY | PENDING |
| F8 | Critical paths file created | AUTO_VERIFY | PENDING |
| F9 | Last deploy tracking | AUTO_VERIFY | PENDING |
| F10 | Vercel CLI preview URL retrieval | AUTO_VERIFY | PENDING |
| F11 | Playwright tests run authenticated | AUTO_VERIFY | PENDING |
| F12 | Check mode validates track prerequisites | AUTO_VERIFY | PENDING |
| F13 | Uses existing Playwright auth helpers | AUTO_VERIFY | PENDING |
| E1 | Vercel CLI not available error | AUTO_VERIFY | PENDING |
| E2 | Preview URL not ready handling | AUTO_VERIFY | PENDING |
| E3 | Critical path test failure reporting | AUTO_VERIFY | PENDING |
| E4 | Rollback confirmation required | AUTO_VERIFY | PENDING |
| E5 | Post-deploy verification failure warning | AUTO_VERIFY | PENDING |
| P1 | Deploy wait timeout configurable | AUTO_VERIFY | PENDING |
| P2 | Page load timeout configurable | AUTO_VERIFY | PENDING |
| P3 | Polling interval | AUTO_VERIFY | PENDING |
| I1 | Agent spec updated | AUTO_VERIFY | PENDING |
| I2 | Existing modes preserved | AUTO_VERIFY | PENDING |
| I3 | Playwright test infrastructure integration | AUTO_VERIFY | PENDING |

**Total:** 24 criteria (24 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature merge-feature-extended`

**Key files to create/modify:**
- `docs/agents/merge-feature-agent.md` (update)
- `docs/agents/merge-feature/config.json` (new)
- `docs/agents/merge-feature/critical-paths.ts` (new)
- `docs/agents/merge-feature/last-deploy.json` (new, created at runtime)
- `.claude/commands/merge-feature.md` (update if command implementation exists)
