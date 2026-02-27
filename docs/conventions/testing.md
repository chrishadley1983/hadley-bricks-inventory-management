# Testing Conventions

## Test Framework

- **Unit/Integration:** Vitest
- **E2E:** Playwright

## File Locations

| Type | Location | Example |
|------|----------|---------|
| API tests | `src/app/api/__tests__/` | `inventory-bulk.test.ts` |
| Unit tests | `src/__tests__/` or co-located `__tests__/` dirs | `src/lib/__tests__/` |
| E2E tests | Playwright config at project root | `playwright.config.ts` |
| Test fixtures | `tests/fixtures/` | Seed data |

## Canonical Examples

| Pattern | Reference File |
|---------|---------------|
| API route test | `src/app/api/__tests__/auth.test.ts` |
| API bulk test | `src/app/api/__tests__/inventory-bulk.test.ts` |
| AI endpoint test | `src/app/api/__tests__/ai.test.ts` |

## Key Rules

- Use `describe`/`it`/`expect` from Vitest
- Mock Supabase client for unit tests
- Test auth (401), validation (400), and success paths
- Maintain >80% coverage target
- Run `/test-execute quick` during development
- Run `/test-execute pre-merge` before merging

## Commands

```powershell
npm test                   # Run all tests
npm test -- --watch        # Watch mode
npm test -- --coverage     # Coverage report
```
