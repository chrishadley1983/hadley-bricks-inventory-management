# Done Criteria: fix-agent

**Created:** 2026-01-24
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Implement the Fix Agent - a lightweight agent for the fix/hotfix track that provides a controlled path for small changes and bug fixes without requiring the full Define Done → Build Feature → Verify Done cycle. Includes CLAUDE.md updates for branch-based development policy and smoke test infrastructure.

## Success Criteria

### Functional - File Structure

#### F1: Fix Agent Spec Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `docs/agents/fix-agent/spec.md` exists with full agent specification
- **Evidence:** File exists and contains required sections: Overview, Process Flow, Phase outputs, Scope Control, Configuration
- **Test:** `Test-Path docs/agents/fix-agent/spec.md` + grep for "## Process Flow"

#### F2: Fix Agent Config Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `docs/agents/fix-agent/config.json` exists with required schema
- **Evidence:** Valid JSON with keys: branchPrefix, maxFilesWarning, maxFilesBlock, requireApproval, runAffectedTests, runSmokeTests, smokeTestCommand, reportLocation
- **Test:** Parse JSON and validate all required keys present

#### F3: Fix Command File Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `.claude/commands/fix.md` exists and is loadable as a Claude Code command
- **Evidence:** File exists with correct frontmatter/structure for command loading
- **Test:** `Test-Path .claude/commands/fix.md` + validate structure

#### F4: Fix Reports Directory Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `docs/fixes/` directory exists (with .gitkeep)
- **Evidence:** Directory exists and is tracked in git
- **Test:** `Test-Path docs/fixes/.gitkeep`

#### F5: CLAUDE.md Contains Branch Policy
- **Tag:** AUTO_VERIFY
- **Criterion:** CLAUDE.md contains "## Branch Policy" section with Golden Rules, Branch Naming Convention, Approval Gates, Workflow Selection subsections
- **Evidence:** Grep finds all required headings
- **Test:** `Select-String -Path CLAUDE.md -Pattern "## Branch Policy"` + subsection checks

#### F6: CLAUDE.md Contains Agent Quick Reference
- **Tag:** AUTO_VERIFY
- **Criterion:** CLAUDE.md contains "## Agent Quick Reference" section with Feature Track and Fix Track subsections
- **Evidence:** Grep finds heading and both track subsections
- **Test:** `Select-String -Path CLAUDE.md -Pattern "## Agent Quick Reference"`

### Functional - Agent Phases

#### F7: Phase 1 Analyse Works
- **Tag:** AUTO_VERIFY
- **Criterion:** When `/fix` is invoked, agent searches codebase and identifies relevant files for the described issue
- **Evidence:** Agent output includes file paths related to the issue description
- **Test:** Invoke `/fix test issue` and verify output contains file analysis

#### F8: Phase 2 Plan Output Format
- **Tag:** AUTO_VERIFY
- **Criterion:** Phase 2 outputs plan in specified markdown format with sections: Problem, Root Cause, Proposed Fix (with files table), Risk Assessment, Scope
- **Evidence:** Output matches template structure from spec
- **Test:** Regex validation of output structure

#### F9: Phase 2 Approval Gate
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent outputs "Awaiting approval to proceed" and waits for explicit approval before continuing
- **Evidence:** Agent pauses after plan output, only continues on approval keywords
- **Test:** Verify agent does not create branch until approval received

#### F10: Phase 3 Branch Creation
- **Tag:** AUTO_VERIFY
- **Criterion:** On approval, agent creates branch with pattern `fix/<slugified-description>`
- **Evidence:** `git branch` shows new fix/* branch
- **Test:** After approval, `git branch --list "fix/*"` returns the new branch

#### F11: Phase 4 Build Scope Control
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent implements only the approved changes, no additional modifications
- **Evidence:** Git diff shows only files mentioned in approved plan
- **Test:** Compare `git diff --name-only` to approved file list

#### F12: Phase 5 Verify Runs Checks
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent runs typecheck, lint, affected tests, and smoke tests
- **Evidence:** Output shows execution of: `npm run typecheck`, `npm run lint`, affected test commands, `npm run test:smoke`
- **Test:** Verify all four check types appear in agent output

#### F13: Phase 6 Handoff Complete
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent commits changes, pushes branch, generates fix report, and prompts for code review
- **Evidence:** Commit exists, branch pushed, report file created, output contains "Ready for `/code-review branch`"
- **Test:** Verify commit, remote branch, report file, and handoff message

### Functional - Infrastructure

#### F14: Smoke Test Script Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** `npm run test:smoke` script exists in package.json and executes successfully
- **Evidence:** Script defined in package.json, runs without error on clean codebase
- **Test:** `npm run test:smoke` exits with code 0

#### F15: Affected Test Detection Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent can identify tests related to modified files using dependency and functional analysis
- **Evidence:** Given a modified file, agent finds test files that import it or test its functionality
- **Test:** Modify a known file, verify agent identifies its associated tests

### Error Handling

#### E1: Warning on >5 Files
- **Tag:** AUTO_VERIFY
- **Criterion:** If fix touches >5 files, agent displays warning: "This fix is larger than typical. Consider feature track?"
- **Evidence:** Warning message appears in output when file count exceeds 5
- **Test:** Simulate fix affecting 6 files, verify warning appears

#### E2: Block on >10 Files
- **Tag:** AUTO_VERIFY
- **Criterion:** If fix touches >10 files, agent blocks and outputs: "Too large for fix track. Use `/define-done` instead."
- **Evidence:** Agent stops and does not proceed with fix
- **Test:** Simulate fix affecting 11 files, verify agent blocks

#### E3: Warning on >100 Lines
- **Tag:** AUTO_VERIFY
- **Criterion:** If fix changes >100 lines, agent displays warning asking for confirmation
- **Evidence:** Warning message appears when line count exceeds 100
- **Test:** Simulate fix with 101+ line changes, verify warning appears

#### E4: Rejection Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If user rejects at approval gate, agent stops and asks for guidance
- **Evidence:** Agent does not create branch, outputs request for guidance
- **Test:** Reject plan, verify agent stops gracefully

#### E5: Additional Issues Noted Not Fixed
- **Tag:** AUTO_VERIFY
- **Criterion:** If agent discovers additional issues during fix, they are noted in report but not addressed
- **Evidence:** Fix report contains "Additional Issues Found (Not Addressed)" section when applicable
- **Test:** Verify scope control in fix report structure

### Performance

#### P1: Smoke Test Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Smoke test suite completes in under 30 seconds
- **Evidence:** `npm run test:smoke` execution time < 30000ms
- **Test:** Time smoke test execution

### Integration

#### I1: Merge Feature Detects Fix Branch
- **Tag:** AUTO_VERIFY
- **Criterion:** Merge Feature Agent detects `fix/*`, `hotfix/*`, `bugfix/*` branch patterns as fix track
- **Evidence:** Merge Feature Agent applies fix track rules when branch matches pattern
- **Test:** Check Merge Feature Agent spec includes fix track detection

#### I2: Fix Track Skips Define Done Check
- **Tag:** AUTO_VERIFY
- **Criterion:** When merging fix track branch, Define Done existence check is skipped
- **Evidence:** Merge proceeds without done-criteria.md file
- **Test:** Verify merge feature spec documents this skip

#### I3: Fix Track Skips Verify Done Check
- **Tag:** AUTO_VERIFY
- **Criterion:** When merging fix track branch, Verify Done passed check is skipped
- **Evidence:** Merge proceeds without verify-report.md file
- **Test:** Verify merge feature spec documents this skip

#### I4: Fix Track Runs Limited Tests
- **Tag:** AUTO_VERIFY
- **Criterion:** Fix track runs affected tests + smoke tests only, not full test suite
- **Evidence:** Test execution limited to affected + smoke, not `npm test`
- **Test:** Verify merge feature spec documents limited test scope

### Output Format

#### O1: Plan Format Matches Spec
- **Tag:** AUTO_VERIFY
- **Criterion:** Plan output contains all required sections: Problem, Root Cause, Proposed Fix (with files table), Risk Assessment, Scope
- **Evidence:** All section headers present in plan output
- **Test:** Regex match for required headers

#### O2: Fix Report Format Matches Spec
- **Tag:** AUTO_VERIFY
- **Criterion:** Fix report at `docs/fixes/YYYY-MM-DD_<slug>.md` contains: Problem, Root Cause, Solution, Files Modified, Commits, Verification checklist, Additional Notes
- **Evidence:** Report file exists at correct path with all required sections
- **Test:** Validate report structure after fix completion

#### O3: Handoff Message Correct
- **Tag:** AUTO_VERIFY
- **Criterion:** Agent outputs "Ready for `/code-review branch`" at completion
- **Evidence:** Handoff message appears in final agent output
- **Test:** String match in completion output

## Out of Scope

- Merge Feature Agent implementation changes (handled in separate `merge-feature-extended` feature)
- Visual UI components (this is CLI-based agent)
- Database schema changes (no tables needed)
- E2E Playwright tests for the agent (agent is tested via simulated invocation)

## Dependencies

- Existing agent infrastructure (command loading mechanism)
- Git available in environment
- npm test infrastructure (vitest)

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

## Files to Create

| File | Purpose |
|------|---------|
| `docs/agents/fix-agent/spec.md` | Full agent specification |
| `docs/agents/fix-agent/config.json` | Agent configuration |
| `.claude/commands/fix.md` | Claude Code command trigger |
| `docs/fixes/.gitkeep` | Fix reports directory |

## Files to Update

| File | Changes |
|------|---------|
| `CLAUDE.md` | Add Branch Policy + Agent Quick Reference sections |
| `apps/web/package.json` | Add `test:smoke` script |
| `package.json` | Add root `test:smoke` script |
