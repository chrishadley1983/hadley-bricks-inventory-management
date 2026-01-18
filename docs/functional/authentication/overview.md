# Authentication

## Purpose

Authentication provides secure user access to the Hadley Bricks inventory management system. It uses Supabase Auth with email/password login, supporting user registration with business name metadata, email verification, session management, and route protection to secure dashboard and operational pages from unauthorised access.

## Key Capabilities

- Email/password authentication via Supabase Auth
- User registration with business name metadata
- Email verification flow for new accounts
- Password validation (minimum 8 characters)
- Automatic session refresh via middleware
- Protected route enforcement (dashboard, inventory, purchases, orders, reports, settings)
- Redirect to intended page after login
- Redirect authenticated users away from auth pages
- User profile management with business name and home postcode

## User Journeys

- [Sign In](./sign-in.md) — Log in to an existing account
- [Registration](./registration.md) — Create a new account with email verification

## Pages

| Page | Route | Purpose |
|------|-------|---------|
| Login | `/login` | Email/password sign in form |
| Register | `/register` | New account registration form |

## Business Logic

Summary of key business rules — see individual journey docs for details.

| Logic | Description | Source |
|-------|-------------|--------|
| Password validation | Minimum 8 characters required | [register/page.tsx:36](../../apps/web/src/app/(auth)/register/page.tsx#L36) |
| Password match | Confirm password must match password | [register/page.tsx:30](../../apps/web/src/app/(auth)/register/page.tsx#L30) |
| Email verification | New users must verify email before accessing app | [use-auth.ts:80-88](../../apps/web/src/hooks/use-auth.ts#L80-L88) |
| Route protection | Unauthenticated users redirected to `/login` | [middleware.ts:52-56](../../apps/web/src/middleware.ts#L52-L56) |
| Auth redirect | Authenticated users redirected away from auth pages | [middleware.ts:60-66](../../apps/web/src/middleware.ts#L60-L66) |
| Session refresh | Sessions automatically refreshed on each request | [middleware.ts:34-36](../../apps/web/src/middleware.ts#L34-L36) |

## Technical Architecture

### Client-Side Authentication

The `useAuth` hook provides authentication state and methods to React components:

```typescript
const { user, session, isLoading, signIn, signUp, signOut, refreshSession } = useAuth();
```

**State management:**
- Initial session loaded from Supabase on mount
- Real-time updates via `onAuthStateChange` subscription
- Loading state tracked during initialisation

**Source:** [use-auth.ts](../../apps/web/src/hooks/use-auth.ts)

### Server-Side Authentication

Two Supabase clients are available for server-side operations:

| Client | Use Case | RLS |
|--------|----------|-----|
| `createClient()` | Standard operations, respects user permissions | Yes |
| `createServiceRoleClient()` | Admin operations, bypasses RLS | No |

**Source:** [server.ts](../../apps/web/src/lib/supabase/server.ts)

### Middleware Protection

The Next.js middleware intercepts all non-static requests and:

1. Refreshes the user session if expired
2. Redirects unauthenticated users to `/login` for protected routes
3. Redirects authenticated users away from `/login` and `/register`
4. Preserves the intended destination via `redirectTo` query param

**Protected routes:**
- `/dashboard`
- `/inventory`
- `/purchases`
- `/orders`
- `/reports`
- `/integrations`
- `/settings`

**Source:** [middleware.ts](../../apps/web/src/middleware.ts)

### OAuth Callback

Handles email confirmation and OAuth callback flows:

1. Receives verification code from email link
2. Exchanges code for session via Supabase
3. Redirects to `/dashboard` (or custom `next` param)
4. Falls back to `/login` with error on failure

**Source:** [callback/route.ts](../../apps/web/src/app/api/auth/callback/route.ts)

## Data Model

Key entities and their relationships:

| Entity | Table | Key Fields |
|--------|-------|------------|
| User | `auth.users` (Supabase managed) | id, email, email_confirmed_at, user_metadata |
| Profile | `profiles` | id (user FK), business_name, home_postcode |

**Note:** The `profiles` table is automatically populated by a database trigger when a new user is created in `auth.users`.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/login` | POST | Programmatic login (returns session) |
| `/api/auth/register` | POST | Programmatic registration |
| `/api/auth/callback` | GET | OAuth/email verification callback |

## Related Features

- [Settings](../settings/overview.md) — User profile settings including business name
- [Dashboard](../dashboard/overview.md) — Landing page after authentication

---

*Generated: 2026-01-18*
*Source files: 9*
*Last verified: 2026-01-18*
