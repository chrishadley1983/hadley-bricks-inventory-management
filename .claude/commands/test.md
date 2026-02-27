# Test Command

You are now operating as the **Test Agent** — a senior QA engineer handling test planning, generation, and execution. Follow the comprehensive instructions in `docs/testing/test-agent.md`.

## Quick Reference

### Usage
```
/test <action> [mode]
```

### Actions

**Run tests** (default — no action keyword needed):

| Mode | Description | Duration |
|------|-------------|----------|
| `quick` | Critical unit tests only | ~1 min |
| `unit` | All unit tests | ~2 min |
| `api` | All API tests | ~3 min |
| `integration` | API + integration tests | ~5 min |
| `e2e` | All E2E browser tests | ~10 min |
| `regression` | Unit + API + integration | ~10 min |
| `complete` | All test types | ~15 min |
| `pre-merge` | Regression + critical E2E | ~10 min |
| `feature:<n>` | Tests for specific feature | Varies |

**Plan tests** (`plan` action):

| Mode | Description |
|------|-------------|
| `plan analyze` | Full gap analysis |
| `plan coverage` | Coverage report only |
| `plan feature:<n>` | Analyse specific feature |
| `plan generate-manifest <mode>` | Create test manifest |

**Build tests** (`build` action):

| Mode | Description |
|------|-------------|
| `build critical` | Build tests for CRITICAL priority gaps |
| `build high` | Build tests for HIGH priority gaps |
| `build medium` | Build tests for MEDIUM priority gaps |
| `build feature:<n>` | Build tests for specific feature |
| `build type:<type>` | Build specific test type (unit/api/e2e) |
| `build all` | Build all missing tests |
| `build fix-mocks` | Fix mock infrastructure issues |

### Examples
```powershell
/test quick                    # Fast check during development
/test pre-merge                # Full validation before merge
/test feature:inventory        # Run inventory tests

/test plan analyze             # Full gap analysis
/test plan coverage            # Quick coverage check

/test build critical           # Build tests for critical gaps
/test build feature:orders     # Build order tests
```

### Standard Workflow

1. **During development:** `/test quick`
2. **Before committing:** `/test unit`
3. **Before merging:** `/test pre-merge`
4. **Find coverage gaps:** `/test plan analyze`
5. **Generate missing tests:** `/test build critical`

### Output Files

| Type | Location |
|------|----------|
| Coverage Report | `docs/testing/analysis/coverage-report-{date}.md` |
| Test Manifest | `docs/testing/registry/test-manifest-{date}.json` |
| Execution Report | `docs/testing/execution-history/test-run-{timestamp}.md` |
| Execution History | `docs/testing/execution-history/history.json` |

### Coverage Targets

| Priority | Target |
|----------|--------|
| Critical | 85% |
| High | 75% |
| Medium | 70% |
| Overall | 80% |
