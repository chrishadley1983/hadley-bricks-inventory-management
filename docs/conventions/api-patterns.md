# API Route Conventions

## File Location

`src/app/api/[resource]/route.ts`

## Standard Pattern

Every API route follows this structure:

1. **Auth check** - Verify session via `createClient()` → `getUser()`
2. **Validate input** - Parse request body with a Zod schema
3. **Business logic** - Call service/repository layer
4. **Return response** - JSON with appropriate status code

### Canonical Examples

| Pattern | Reference File |
|---------|---------------|
| Standard CRUD route | `src/app/api/inventory/bulk/route.ts` |
| Bulk operations | `src/app/api/purchases/bulk/route.ts` |
| Dynamic params | `src/app/api/orders/amazon/[orderId]/rematch/route.ts` |
| AI endpoint | `src/app/api/ai/parse-purchase/route.ts` |

### Key Rules

- Always use Zod schemas for request validation (schemas in `src/lib/schemas/`)
- Auth check on every protected route: `supabase.auth.getUser()`
- Error responses: `{ error: string, details?: object }`
- Success responses: `{ data: T }`
- Console errors with route context: `console.error('[POST /api/inventory] Error:', error)`

## Bulk Operations

All bulk operations must:
1. Have a dedicated batch endpoint (`/api/[resource]/bulk`)
2. Accept arrays and process in a single database operation
3. Never use sequential loops for bulk API calls

## Naming

| Type | Convention |
|------|-----------|
| API endpoints | kebab-case (`/api/inventory-items`) |
| Route files | `route.ts` in directory matching the endpoint |
