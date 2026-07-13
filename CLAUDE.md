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
- **Shared project**: other repos (tournament/chat app, energy) also apply migrations to this
  Supabase project via MCP. `supabase/migrations/` mirrors the FULL remote history, including
  their migrations. If `db:push` reports remote-only versions, run `npx supabase migration fetch`
  (then `git checkout -- supabase/migrations` to restore overwritten files, keeping only the new
  ones). Never apply migrations with `execute_sql` — use `db:push` or MCP `apply_migration` so
  the history table stays in sync.

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

---

## BrickLink Price Data — Standard Pattern (MANDATORY)

**Every BL price lookup fetches ALL FOUR quadrants (sold N/U + stock N/U) through the
standard write-through service, which persists them to the unified
`bricklink_price_guide_cache`.** Each call must enrich the shared dataset — assessments,
bl-basket, offline re-scores, and future runs all read the same cache.

- CLI: `scripts/pg/pg-live-check.ts` — ALWAYS pass `--include-stock`. The sold-only
  default is a trap: it leaves stock quadrants empty, STR renders as bogus `x/0L`
  (stock-unknown coerced to zero supply), and the quadrants have to be re-bought.
- Service: `src/lib/bricklink/live-check.service.ts` (`liveCheckBatch`) — the only
  sanctioned API price-fetch path. Never make ad-hoc BL price calls or scrapes that
  bypass the cache write-through; partial rows poison downstream consumers silently.
- API budget is never the argument for skipping quadrants: 5,000 calls/day, typical
  usage <5%. Doing it right once is always cheaper than a second pass.
  (Origin: 2026-07-13 Andrew toys verification — sold-only first pass, ~640 quadrants
  re-bought. Chris: "every price call needs to follow the standard pattern as we want
  it to enrich the data too.")
