# Hadley Bricks - Agent Infrastructure Setup

## Role

You are a **Senior Developer** setting up development automation infrastructure. You are implementing a suite of 5 development agents that will support consistent, high-quality development workflows.

**CRITICAL: Read `CLAUDE.md` before starting. Follow all project conventions.**

---

## Task Overview

Set up the agent infrastructure for Hadley Bricks, adapting the proven agent system from FamilyFuel. This includes:

1. **Directory structure** for agent specifications and commands
2. **5 agent specifications** adapted for Hadley Bricks
3. **Claude Code commands** for invoking each agent
4. **Supporting configuration files**
5. **CLAUDE.md updates** to reference the agent system

---

## Phase 1: Create Directory Structure

Create the following directories:

```
hadley-bricks/
├── .claude/
│   └── commands/           # Claude Code slash commands
├── docs/
│   ├── agents/             # Agent specifications
│   │   └── config/         # Agent configuration
│   ├── testing/            # Test infrastructure
│   │   ├── analysis/       # Coverage analysis outputs
│   │   ├── config/         # Test configuration
│   │   ├── execution-history/  # Test run history
│   │   ├── registry/       # Test manifests
│   │   └── templates/      # Report templates
│   ├── reviews/            # Code review outputs
│   │   └── config/         # Review configuration
│   └── merges/             # Merge reports
└── tests/
    ├── unit/               # Unit tests
    ├── api/                # API tests
    ├── integration/        # Integration tests
    ├── e2e/                # E2E tests
    │   └── playwright/     # Playwright specs
    └── fixtures/           # Test data
        └── seeders/        # Database seeders
```

Commands:
```powershell
# Create all directories
New-Item -Path ".claude/commands" -ItemType Directory -Force
New-Item -Path "docs/agents/config" -ItemType Directory -Force
New-Item -Path "docs/testing/analysis" -ItemType Directory -Force
New-Item -Path "docs/testing/config" -ItemType Directory -Force
New-Item -Path "docs/testing/execution-history" -ItemType Directory -Force
New-Item -Path "docs/testing/registry" -ItemType Directory -Force
New-Item -Path "docs/testing/templates" -ItemType Directory -Force
New-Item -Path "docs/reviews/config" -ItemType Directory -Force
New-Item -Path "docs/merges" -ItemType Directory -Force
New-Item -Path "tests/unit" -ItemType Directory -Force
New-Item -Path "tests/api" -ItemType Directory -Force
New-Item -Path "tests/integration" -ItemType Directory -Force
New-Item -Path "tests/e2e/playwright" -ItemType Directory -Force
New-Item -Path "tests/fixtures/seeders" -ItemType Directory -Force
```

---

## Phase 2: Create Agent Specifications

Create the following agent specification files, adapting them for Hadley Bricks:

### 2.1 Test Plan Agent (`docs/testing/test-plan-agent.md`)

The Test Plan Agent analyses the codebase to identify test coverage gaps.

**Key adaptations for Hadley Bricks:**
- Features to analyse: Inventory, Purchases, Orders, Platform Sync (BrickLink, Brick Owl, Bricqer), Financial Reporting, Google Sheets Integration
- Critical paths: `app/api/**`, `lib/adapters/**`, `lib/repositories/**`, `lib/services/**`
- Coverage targets: 80% for critical features, 70% overall

### 2.2 Test Build Agent (`docs/testing/test-build-agent.md`)

The Test Build Agent creates test files based on Test Plan Agent outputs.

**Key adaptations for Hadley Bricks:**
- Test data fixtures for LEGO sets, purchases, orders
- Platform adapter mocking (BrickLink, Brick Owl, Bricqer APIs)
- Google Sheets API mocking
- Supabase test utilities

### 2.3 Test Execution Agent (`docs/testing/test-execution-agent.md`)

The Test Execution Agent runs tests and generates reports.

**Key adaptations for Hadley Bricks:**
- Cloud Supabase database (no local)
- Platform API mocking for tests
- Financial calculation validation
- Order sync verification

### 2.4 Code Review Agent (`docs/reviews/code-review-agent.md`)

The Code Review Agent performs thorough code reviews.

**Key adaptations for Hadley Bricks:**
- Security focus on platform credentials encryption
- API adapter pattern compliance
- Repository pattern compliance
- Dual-write verification (Sheets + Supabase)
- RLS policy verification

### 2.5 Merge Feature Agent (`docs/agents/merge-feature-agent.md`)

The Merge Feature Agent safely merges feature branches.

**Key adaptations for Hadley Bricks:**
- Pre-merge test requirements
- Cloud Supabase migration verification
- Platform integration smoke tests

---

## Phase 3: Create Claude Code Commands

Create slash command files for each agent:

### 3.1 Test Plan Command (`.claude/commands/test-plan.md`)

```markdown
# Test Plan Command

You are now operating as the **Test Plan Agent**. Follow the comprehensive instructions in `docs/testing/test-plan-agent.md`.

## Quick Reference

### Usage
```
/test-plan <mode>
```

### Available Modes

| Mode | Description |
|------|-------------|
| `analyze` | Full gap analysis |
| `coverage` | Coverage report only |
| `feature:<n>` | Analyze specific feature |
| `generate-manifest <mode>` | Create test manifest |

### Examples
```powershell
/test-plan analyze          # Full analysis
/test-plan coverage         # Quick coverage check
/test-plan feature:orders   # Analyze orders feature
/test-plan generate-manifest regression
```
```

### 3.2 Test Build Command (`.claude/commands/test-build.md`)

```markdown
# Test Build Command

You are now operating as the **Test Build Agent**. Follow the comprehensive instructions in `docs/testing/test-build-agent.md`.

## Quick Reference

### Usage
```
/test-build <mode>
```

### Available Modes

| Mode | Description |
|------|-------------|
| `critical` | Build tests for CRITICAL priority gaps |
| `high` | Build tests for HIGH priority gaps |
| `feature:<n>` | Build tests for specific feature |
| `type:<type>` | Build specific test type (unit/api/e2e) |
| `all` | Build all missing tests |

### Examples
```powershell
/test-build critical        # Critical gaps first
/test-build feature:orders  # Order tests
/test-build type:api        # API tests only
```
```

### 3.3 Test Execute Command (`.claude/commands/test-execute.md`)

```markdown
# Test Execute Command

You are now operating as the **Test Execution Agent**. Follow the comprehensive instructions in `docs/testing/test-execution-agent.md`.

## Quick Reference

### Usage
```
/test-execute <mode>
```

### Available Modes

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

### Examples
```powershell
/test-execute quick         # Fast check
/test-execute regression    # Before merging
/test-execute pre-merge     # Full pre-merge validation
/test-execute feature:inventory
```
```

### 3.4 Code Review Command (`.claude/commands/code-review.md`)

```markdown
# Code Review Command

You are now operating as the **Code Review Agent**. Follow the comprehensive instructions in `docs/reviews/code-review-agent.md`.

## Quick Reference

### Usage
```
/code-review <mode>
```

### Available Modes

| Mode | Description |
|------|-------------|
| `staged` | Review staged changes only |
| `branch` | Review all changes vs main |
| `security` | Security-focused review |
| `performance` | Performance-focused review |
| `dry` | Find duplicate/redundant code |
| `architecture` | File organisation check |
| `full` | Complete review (all checks) |

### Examples
```powershell
/code-review staged         # Before committing
/code-review branch         # Before PR/merge
/code-review security       # Security audit
```
```

### 3.5 Merge Feature Command (`.claude/commands/merge-feature.md`)

```markdown
# Merge Feature Command

You are now operating as the **Merge Feature Agent**. Follow the comprehensive instructions in `docs/agents/merge-feature-agent.md`.

## Quick Reference

### Usage
```
/merge-feature <mode>
```

### Available Modes

| Mode | Description |
|------|-------------|
| `<branch-name>` | Merge specific branch to main |
| `auto` | Auto-detect current feature branch |
| `list` | List unmerged branches |
| `status` | Show merge status |

### Examples
```powershell
/merge-feature feature/bricklink-orders
/merge-feature auto
/merge-feature list
```

## Permissions

For this project:
- ✅ Can push directly to main
- ✅ Can delete local and remote branches
- ❌ Never force push to main
```

---

## Phase 4: Create Configuration Files

### 4.1 Project Config (`docs/testing/config/project-config.ts`)

```typescript
/**
 * Hadley Bricks - Test Configuration
 * Defines features, priorities, and coverage targets
 */

export const projectConfig = {
  name: 'Hadley Bricks',
  
  features: {
    // Core Features
    auth: { priority: 'CRITICAL', module: 'auth' },
    inventory: { priority: 'CRITICAL', module: 'inventory' },
    purchases: { priority: 'CRITICAL', module: 'purchases' },
    orders: { priority: 'CRITICAL', module: 'orders' },
    
    // Platform Integrations
    bricklink: { priority: 'HIGH', module: 'adapters/bricklink' },
    brickowl: { priority: 'HIGH', module: 'adapters/brickowl' },
    bricqer: { priority: 'HIGH', module: 'adapters/bricqer' },
    
    // Data Layer
    sheetsSync: { priority: 'HIGH', module: 'google' },
    repositories: { priority: 'HIGH', module: 'repositories' },
    
    // Reporting
    financials: { priority: 'MEDIUM', module: 'reports' },
    dashboard: { priority: 'MEDIUM', module: 'dashboard' },
  },
  
  coverageTargets: {
    overall: { branches: 70, functions: 80, lines: 80, statements: 80 },
    critical: { branches: 80, functions: 85, lines: 85, statements: 85 },
    high: { branches: 70, functions: 75, lines: 75, statements: 75 },
    medium: { branches: 60, functions: 70, lines: 70, statements: 70 },
  },
  
  criticalPaths: [
    'app/api/**',
    'lib/adapters/**',
    'lib/repositories/**',
    'lib/services/**',
    'supabase/migrations/**',
  ],
  
  testTypes: ['unit', 'api', 'integration', 'e2e'],
};
```

### 4.2 Review Config (`docs/reviews/config/review-config.ts`)

```typescript
/**
 * Hadley Bricks - Code Review Configuration
 */

export const reviewConfig = {
  strictness: 'moderate',
  
  enabledCategories: [
    'correctness',
    'security',
    'performance',
    'maintainability',
    'dry',
    'architecture',
    'standards',
    'testing',
  ],
  
  criticalPaths: [
    'app/api/**',
    'lib/adapters/**',
    'lib/repositories/**',
    'lib/services/**',
    'supabase/migrations/**',
  ],
  
  relaxedPaths: [
    'scripts/**',
    'tools/**',
  ],
  
  minCoverageNew: 80,
  maxComplexity: 15,
  maxFunctionLength: 50,
  maxFileLength: 500,
  
  // Hadley Bricks specific
  hadleyBricksChecks: {
    platformCredentials: 'Encrypted at rest?',
    adapterPattern: 'Following adapter interface?',
    repositoryPattern: 'Using repository layer?',
    dualWrite: 'Sheets + Supabase both updated?',
    rlsPolicies: 'RLS policies for new tables?',
  },
};
```

---

## Phase 5: Update CLAUDE.md

Add an "Agents" section to CLAUDE.md referencing the agent system:

```markdown
## Development Agents

This project uses a suite of development agents to ensure consistent, high-quality development workflows.

### Available Agents

| Command | Agent | Purpose |
|---------|-------|---------|
| `/test-plan` | Test Plan Agent | Analyse coverage gaps |
| `/test-build` | Test Build Agent | Generate tests for gaps |
| `/test-execute` | Test Execution Agent | Run tests and report |
| `/code-review` | Code Review Agent | Review code changes |
| `/merge-feature` | Merge Feature Agent | Safely merge branches |

### Standard Workflow

1. **During development:**
   ```powershell
   /test-execute quick          # Fast validation
   /code-review staged          # Before committing
   ```

2. **Before merging:**
   ```powershell
   /test-execute pre-merge      # Full test suite
   /code-review branch          # Full review
   /merge-feature <branch>      # Safe merge
   ```

3. **When adding features:**
   ```powershell
   /test-plan analyze           # Find coverage gaps
   /test-build feature:<name>   # Generate tests
   /test-execute feature:<name> # Verify tests
   ```

### Agent Documentation

- Test Plan Agent: `docs/testing/test-plan-agent.md`
- Test Build Agent: `docs/testing/test-build-agent.md`
- Test Execution Agent: `docs/testing/test-execution-agent.md`
- Code Review Agent: `docs/reviews/code-review-agent.md`
- Merge Feature Agent: `docs/agents/merge-feature-agent.md`
```

---

## Phase 6: Verification

After setting up:

1. **Verify directory structure:**
   ```powershell
   Test-Path .claude/commands
   Test-Path docs/agents
   Test-Path docs/testing
   Test-Path docs/reviews
   ```

2. **Verify files created:**
   ```powershell
   Get-ChildItem -Recurse docs/testing/*.md
   Get-ChildItem -Recurse docs/reviews/*.md
   Get-ChildItem -Recurse docs/agents/*.md
   Get-ChildItem -Recurse .claude/commands/*.md
   ```

3. **Test a command:**
   ```powershell
   /test-plan analyze
   ```

4. **Commit changes:**
   ```powershell
   git add .
   git commit -m "feat: Add development agent infrastructure"
   git push origin main
   ```

---

## Completion Report

When complete, provide:

```markdown
## Agent Infrastructure Setup Complete ✅

### Files Created

| Category | Files |
|----------|-------|
| Agent Specs | 5 |
| Commands | 5 |
| Config Files | 2 |
| Directories | 15 |

### Agents Ready

| Agent | Command | Status |
|-------|---------|--------|
| Test Plan | `/test-plan` | ✅ Ready |
| Test Build | `/test-build` | ✅ Ready |
| Test Execution | `/test-execute` | ✅ Ready |
| Code Review | `/code-review` | ✅ Ready |
| Merge Feature | `/merge-feature` | ✅ Ready |

### Next Steps

1. Run `/test-plan analyze` to identify initial test gaps
2. Run `/code-review staged` to validate current code
3. Begin using agents in development workflow
```

---

## Notes

- Agent specifications should be adapted from the FamilyFuel versions
- All paths should match Hadley Bricks project structure
- Windows/PowerShell syntax should be used throughout
- Configuration should reference Hadley Bricks-specific features (inventory, platforms, etc.)
