# Feature Specification: fix-agent

**Generated:** 2026-01-24
**Based on:** done-criteria.md (28 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

Implement the Fix Agent - a lightweight agent for the fix/hotfix track that provides a controlled path for small changes and bug fixes. The agent follows a 6-phase workflow (Analyse → Plan → Approve → Branch → Build → Verify → Handoff) with an explicit approval gate before any code changes. This feature also includes CLAUDE.md updates for branch-based development policy and creates smoke test infrastructure.

This is primarily a **documentation/configuration feature** - the agent behavior is defined in markdown files that Claude Code interprets, not in application code.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1:** Fix Agent Spec Exists | Copy and adapt from `docs/fix-agent-spec.md` reference document |
| **F2:** Fix Agent Config Exists | Create JSON config with thresholds and commands |
| **F3:** Fix Command File Exists | Create command file following `code-review.md` pattern |
| **F4:** Fix Reports Directory | Create `docs/fixes/.gitkeep` |
| **F5:** Branch Policy in CLAUDE.md | Add section from reference spec Part 1 |
| **F6:** Agent Quick Reference in CLAUDE.md | Add section from reference spec Part 1 |
| **F7-F13:** Agent Phases | Defined in spec.md - agent reads and follows |
| **F14:** Smoke Test Script | Add vitest pattern filter for smoke tests |
| **F15:** Affected Test Detection | Document analysis approach in spec |
| **E1-E5:** Error Handling | Define thresholds and behaviors in spec + config |
| **P1:** Smoke Test Speed | Use fast tests only (no integration/e2e) |
| **I1-I4:** Merge Feature Integration | Document expected behavior (Merge Feature handles detection) |
| **O1-O3:** Output Formats | Define templates in spec.md |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code CLI                               │
│                                                                  │
│  /fix <description>                                             │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ .claude/commands/fix.md                                  │    │
│  │                                                          │    │
│  │ Loads command, points to spec                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ docs/agents/fix-agent/spec.md                           │    │
│  │                                                          │    │
│  │ • Phase definitions                                      │    │
│  │ • Output templates                                       │    │
│  │ • Guardrails                                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ docs/agents/fix-agent/config.json                       │    │
│  │                                                          │    │
│  │ • Thresholds (5 files warning, 10 files block)          │    │
│  │ • Commands (npm run test:smoke)                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Output:                                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ docs/fixes/YYYY-MM-DD_<slug>.md                         │    │
│  │                                                          │    │
│  │ Fix report with verification checklist                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Workflow Integration

```
                    USER REQUEST
                         │
                         ▼
         ┌───────────────────────────────┐
         │  Is this a fix or a feature?  │
         └───────────────────────────────┘
                    │           │
              fix/hotfix     feature
                    │           │
                    ▼           ▼
         ┌──────────────┐  ┌──────────────┐
         │   /fix       │  │ /define-done │
         │   agent      │  │ → /build     │
         └──────────────┘  └──────────────┘
                    │           │
                    ▼           ▼
         ┌──────────────┐  ┌──────────────┐
         │ /code-review │  │ /verify-done │
         │   branch     │  │ → /code-rev  │
         └──────────────┘  └──────────────┘
                    │           │
                    └─────┬─────┘
                          ▼
              ┌──────────────────────┐
              │   /merge-feature     │
              │   (detects track)    │
              └──────────────────────┘
```

### 3.3 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Spec format | Markdown | Consistent with other agents |
| Config format | JSON | Easily parseable, editable |
| Smoke test approach | Vitest pattern filter | Reuses existing infrastructure |
| Report location | `docs/fixes/` | Separate from feature docs |
| Branch prefix | `fix/` | Clear track identification |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `docs/agents/fix-agent/spec.md` | Full agent specification with phases, templates, guardrails | ~400 |
| `docs/agents/fix-agent/config.json` | Configuration with thresholds and commands | ~15 |
| `.claude/commands/fix.md` | Command file to trigger agent | ~50 |
| `docs/fixes/.gitkeep` | Directory placeholder for fix reports | 0 |
| `apps/web/src/__tests__/smoke/smoke.test.ts` | Smoke test suite (fast critical path tests) | ~50 |

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `CLAUDE.md` | Add Branch Policy + Agent Quick Reference sections | ~80 |
| `apps/web/package.json` | Add `test:smoke` script | 1 |
| `package.json` | Add root `test:smoke` script | 1 |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| Database schema | Agent is documentation-only |
| API routes | No backend changes |
| UI components | CLI-based agent |
| Existing agent specs | Independent agent |

---

## 5. Implementation Details

### 5.1 Fix Agent Spec Structure

The spec.md follows the established agent pattern with sections:

```markdown
# Fix Agent Specification

## 1. Overview
- Purpose, agent type, interactions

## 2. Design Principles
- Lightweight, approval-gated, scope-controlled

## 3. Modes
- Standard (default): Full fix cycle

## 4. Standard Boot Sequence
- Read CLAUDE.md, read config, confirm on main branch

## 5. Phase 1: Analyse
- Search codebase, identify root cause, estimate scope

## 6. Phase 2: Plan + Approval Gate
- Present plan format, wait for approval

## 7. Phase 3: Branch
- Create fix/<slug> branch

## 8. Phase 4: Build
- Implement approved fix only, scope control

## 9. Phase 5: Verify
- typecheck, lint, affected tests, smoke tests

## 10. Phase 6: Handoff
- Commit, push, generate report, prompt for code review

## 11. Guardrails
- File count warnings/blocks, line count warnings

## 12. Output Templates
- Plan format, fix report format

## 13. Integration
- Merge Feature Agent track detection
```

### 5.2 Config.json Schema

```json
{
  "branchPrefix": "fix/",
  "maxFilesWarning": 5,
  "maxFilesBlock": 10,
  "maxLinesWarning": 100,
  "requireApproval": true,
  "runAffectedTests": true,
  "runSmokeTests": true,
  "smokeTestCommand": "npm run test:smoke",
  "reportLocation": "docs/fixes/"
}
```

### 5.3 Command File Pattern

Following `.claude/commands/code-review.md` structure:

```markdown
# Fix Command

You are now operating as the **Fix Agent**. Follow the comprehensive instructions in `docs/agents/fix-agent/spec.md`.

## Quick Reference
<usage, examples, process summary, key rules>
```

### 5.4 CLAUDE.md Additions

**Location:** After "## Development Agents" section, before existing content.

**Branch Policy section includes:**
- Golden Rules (3 rules)
- Branch Naming Convention table
- Approval Gates (what counts, what doesn't)
- Workflow Selection guidance

**Agent Quick Reference section includes:**
- Feature Track commands
- Fix Track commands
- Standalone commands

### 5.5 Smoke Test Infrastructure

**Approach:** Create a dedicated smoke test file that runs fast, critical-path tests.

**Pattern:** `apps/web/src/__tests__/smoke/smoke.test.ts`

```typescript
// Smoke tests - fast critical path validation
// These run on every fix to ensure nothing is broken

describe('Smoke Tests', () => {
  describe('Build & Types', () => {
    // TypeScript compilation checked by vitest
  });

  describe('Critical Imports', () => {
    it('imports core utilities', async () => {
      await import('@/lib/utils');
    });

    it('imports supabase client', async () => {
      await import('@/lib/supabase/client');
    });
  });

  describe('Critical Components', () => {
    // Fast render tests for key components
  });
});
```

**Script:** `"test:smoke": "vitest run src/__tests__/smoke --reporter=verbose"`

### 5.6 Affected Test Detection

**Documented approach in spec.md:**

1. **Dependency analysis:** Find test files that import the modified file
   ```powershell
   # Agent uses grep to find imports
   Select-String -Path "src/**/*.test.ts" -Pattern "from.*modified-file"
   ```

2. **Functional analysis:** Find tests that exercise the same feature area
   - Match test file names to source file names
   - Look for describe blocks mentioning the modified functionality

3. **Fallback:** If uncertain, run smoke tests only (quick feedback)

---

## 6. Build Order

### Step 1: Create Fix Agent Directory Structure
- Create `docs/agents/fix-agent/` directory
- Create `docs/fixes/` directory with `.gitkeep`

### Step 2: Create Fix Agent Spec
- Copy and adapt content from `docs/fix-agent-spec.md`
- Reorganize into standard agent spec format
- Add all phase definitions and templates

### Step 3: Create Config File
- Create `docs/agents/fix-agent/config.json`
- Define all thresholds and commands

### Step 4: Create Command File
- Create `.claude/commands/fix.md`
- Follow code-review.md pattern

### Step 5: Update CLAUDE.md
- Add Branch Policy section
- Add Agent Quick Reference section
- Position after Development Agents section

### Step 6: Create Smoke Test Infrastructure
- Create `apps/web/src/__tests__/smoke/smoke.test.ts`
- Add `test:smoke` script to both package.json files

### Step 7: Verify Integration
- Confirm all files exist
- Verify CLAUDE.md sections are complete
- Run smoke tests to confirm they work

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Smoke tests too slow | Low | Medium | Only include import/render tests, no API calls |
| Agent doesn't stop at approval gate | Medium | High | Explicit instructions in spec with clear stop language |
| Scope creep during fix | Medium | Medium | Strong guardrails in spec, file count warnings |
| Merge Feature doesn't detect track | Low | Medium | Out of scope - handled by merge-feature-extended |

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Feature creep into agent | Done criteria is the contract - build only what's specified |
| Over-engineering smoke tests | Start minimal, add tests only as needed |

### Integration Risks

| Risk | Mitigation |
|------|------------|
| CLAUDE.md sections conflict with existing content | Insert at specific location, don't modify existing |
| Command file naming conflict | Check existing commands first (done - no conflict) |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Spec exists | ✅ Yes | High | Reference doc provides all content |
| F2: Config exists | ✅ Yes | High | Simple JSON file |
| F3: Command exists | ✅ Yes | High | Standard pattern from other commands |
| F4: Reports dir exists | ✅ Yes | High | Just a .gitkeep file |
| F5: Branch Policy in CLAUDE.md | ✅ Yes | High | Content defined in reference spec |
| F6: Quick Reference in CLAUDE.md | ✅ Yes | High | Content defined in reference spec |
| F7-F13: Agent phases | ✅ Yes | High | Defined by spec, executed by Claude |
| F14: Smoke test script | ✅ Yes | High | Vitest pattern filter |
| F15: Affected test detection | ✅ Yes | Medium | Grep-based analysis documented in spec |
| E1-E5: Error handling | ✅ Yes | High | Thresholds in config, behavior in spec |
| P1: Smoke test speed | ✅ Yes | High | Import tests are fast |
| I1-I4: Merge integration | ✅ Yes | High | Document expected behavior |
| O1-O3: Output formats | ✅ Yes | High | Templates in spec |

**Issues:** None. All criteria feasible with planned approach.

---

## 9. Notes for Build Agent

### Key Implementation Hints

1. **Start with the reference spec:** `docs/fix-agent-spec.md` contains all the content - reorganize it into the standard agent spec format.

2. **CLAUDE.md insertion point:** Add new sections AFTER the "## Development Agents" section and its table, BEFORE "### Standard Workflow".

3. **Command file structure:** Match the exact structure of `.claude/commands/code-review.md` - header, reference to spec, quick reference.

4. **Smoke test philosophy:** These should run in <5 seconds. Only test that critical imports work and core components render. No API calls, no database.

5. **Config is simple:** Don't over-engineer. The config is read by the agent (Claude) when processing the fix command.

6. **Fix report directory:** Just create the .gitkeep - reports are generated during actual /fix usage.

### Files to Copy/Reference

| Source | Target | Action |
|--------|--------|--------|
| `docs/fix-agent-spec.md` Part 2 | `docs/agents/fix-agent/spec.md` | Reorganize into standard format |
| `docs/fix-agent-spec.md` Part 1 | CLAUDE.md additions | Copy markdown content |
| `.claude/commands/code-review.md` | `.claude/commands/fix.md` | Use as template, adapt content |

### Verification Checklist

After build, verify:
- [ ] `docs/agents/fix-agent/spec.md` has all 13 sections
- [ ] `docs/agents/fix-agent/config.json` parses as valid JSON
- [ ] `.claude/commands/fix.md` follows command pattern
- [ ] `docs/fixes/.gitkeep` exists
- [ ] CLAUDE.md has "## Branch Policy" heading
- [ ] CLAUDE.md has "## Agent Quick Reference" heading
- [ ] `npm run test:smoke` exits with code 0
- [ ] Smoke tests complete in <30 seconds

---

## Feature Spec → Build Feature Handoff

**Feature:** fix-agent
**Spec:** docs/features/fix-agent/feature-spec.md
**Status:** READY_FOR_BUILD

**Summary:**
- 5 files to create, 3 files to modify
- ~600 lines of documentation/config
- No database changes
- No application code changes

**Build order:**
1. Directory structure
2. Spec file (largest file)
3. Config file
4. Command file
5. CLAUDE.md updates
6. Smoke test infrastructure
7. Verification

**Risks flagged:** 1 medium (approval gate behavior - mitigated by explicit spec language)

Ready for: `/build-feature fix-agent`
