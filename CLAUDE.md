# Hadley Bricks Inventory System

LEGO resale business management — inventory, purchases, orders across Amazon, eBay, BrickLink, Brick Owl, Bricqer. Built with Next.js 14 (App Router), React 19, TypeScript, Tailwind + shadcn/ui, Supabase PostgreSQL, TanStack Query, Zustand. Hosted on Vercel.

**PRD:** `docs/PRD.md`

---

## CRITICAL Rules

### Cloud Supabase Only (No Local)

- **Project ID:** `modjoikyuhqzouxvieua`
- No local Supabase instance — no `npx supabase start`
- Migrations pushed directly to cloud: `npm run db:push`
- Types generated from cloud: `npm run db:types`
- No `db:reset` — manual reset via Supabase dashboard only

### Supabase 1,000 Row Limit

Supabase returns max 1,000 rows by default. **Always paginate** queries on tables that may exceed this. This applies to counts and aggregations too.

### Local Windows Environment

- Use PowerShell syntax, not bash/Linux
- `Remove-Item -Recurse -Force` not `rm -rf`
- `$env:VARIABLE` not `export VARIABLE`
- Semicolon `;` to chain commands, not `&&`
- Write commands as single lines

---

## Project Structure

```
apps/web/src/              # Next.js application (note: src/ directory)
  app/                     # App router pages + API routes
    (auth)/                # Auth pages
    (dashboard)/           # Protected dashboard pages
    api/                   # API routes
  components/              # React components (ui/, forms/, features/)
  hooks/                   # Custom React hooks
  stores/                  # Zustand stores
  lib/                     # Core logic
    adapters/              # Platform adapters (BrickLink, etc.)
    repositories/          # Data access layer
    services/              # Business logic
    api/                   # API client functions
    supabase/              # Supabase client
    ai/                    # AI prompts and services
  types/                   # TypeScript types
supabase/
  functions/               # Edge Functions
  migrations/              # Database migrations
docs/
  conventions/             # Code patterns & conventions (read on demand)
  agents/                  # Agent specifications
  testing/                 # Test infrastructure & specs
```

---

## Development Agents

| Command | Purpose |
|---------|---------|
| `/define-done` | Define success criteria for a feature |
| `/feature-spec` | Create implementation plan |
| `/build-feature` | Autonomous build-verify loop |
| `/verify-done` | Adversarial verification against done criteria |
| `/test` | Test planning, generation, and execution (modes: `quick`, `plan analyze`, `build critical`, `pre-merge`, etc.) |
| `/code-review` | Review code changes |
| `/merge-feature` | Safely merge branches |
| `/fix` | Quick fix cycle for isolated bugs |
| `/performance` | Analyse app performance |
| `/docs` | Generate & maintain functional documentation |

### Workflow

- **Feature track:** `/define-done` → `/build-feature` → `/test pre-merge` → `/code-review branch` → `/merge-feature`
- **Fix track:** `/fix` → `/code-review branch` → `/merge-feature`
- **During dev:** `/test quick` — **Before merge:** `/test pre-merge`

### Verification

Run `/verify-done` before marking any change complete. The agent determines what to check based on what changed.

---

## Branch Policy

1. **All code changes require a branch** — main is protected
2. **No code changes without approval** — present a plan, wait for explicit "yes", "approved", "go ahead", etc.
3. **Branch naming determines workflow:**

| Pattern | Track |
|---------|-------|
| `feature/*`, `chore/*`, `refactor/*` | Feature (full cycle) |
| `fix/*`, `hotfix/*`, `bugfix/*` | Fix (quick cycle) |

---

## Conventions & Patterns

Detailed patterns live in `docs/conventions/` — read them when working on the relevant area:

| File | When to read |
|------|-------------|
| `docs/conventions/api-patterns.md` | Building or modifying API routes |
| `docs/conventions/ui-patterns.md` | Frontend work — loading states, bulk ops, caching, naming |
| `docs/conventions/data-access.md` | Repository, service, adapter patterns; Sheets-Primary architecture |
| `docs/conventions/testing.md` | Writing or running tests |

---

## Common Commands

```powershell
npm run dev                # Start dev server
npm run typecheck          # TypeScript check
npm run lint               # ESLint
npm run format             # Prettier
npm test                   # Run all tests
npm run db:push            # Push migrations to cloud Supabase
npm run db:types           # Regenerate types from cloud schema
npm run build              # Production build
```

Cache clearing:
```powershell
Remove-Item -Recurse -Force node_modules/.cache, .next -ErrorAction SilentlyContinue
```

---

## Security

1. Never commit credentials — use environment variables
2. Always use RLS — every table needs Row Level Security policies
3. Validate all inputs with Zod schemas
4. Check auth on every protected route
5. Encrypt platform credentials in `platform_credentials` table
6. Use parameterized queries — never concatenate SQL
