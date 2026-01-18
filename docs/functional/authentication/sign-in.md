# Sign In

## Overview

The sign-in journey allows existing users to authenticate and access the Hadley Bricks inventory management system. Users enter their email and password, and upon successful authentication are redirected to their intended destination or the dashboard.

## Entry Points

- Direct URL: `/login`
- Automatic redirect: Any protected page redirects unauthenticated users here
- Registration page: "Sign in" link at bottom of register form

## Flow

### Step 1: Access Login Page

Navigate to `/login` directly or get redirected from a protected route.

If redirected from a protected route, the original URL is preserved in the `redirectTo` query parameter.

**Layout:**
- Centered card on light grey background
- Hadley Bricks logo with package icon
- "Inventory Management System" tagline

**Source:** [layout.tsx](../../apps/web/src/app/(auth)/layout.tsx)

### Step 2: Enter Credentials

Fill in the login form with email and password.

**Fields/Elements:**

| Element | Type | Description | Validation |
|---------|------|-------------|------------|
| Email | Text input | User's registered email address | Required, valid email format |
| Password | Password input | User's password | Required |
| "Forgot password?" | Link | Navigate to password reset | Links to `/forgot-password` |
| "Sign in" | Button | Submit the form | Disabled while submitting |

**Source:** [login/page.tsx](../../apps/web/src/app/(auth)/login/page.tsx)

### Step 3: Authentication

Form submission triggers the authentication process:

1. Form is validated client-side
2. `signIn(email, password)` called via `useAuth` hook
3. Supabase Auth validates credentials
4. On success: session created, cookies set
5. User redirected to `redirectTo` param or `/dashboard`
6. Router refresh ensures server components see new session

**Source:** [use-auth.ts:67-76](../../apps/web/src/hooks/use-auth.ts#L67-L76)

### Step 4: Dashboard Access

After successful authentication:
- User lands on dashboard (or intended destination)
- Session is stored in HTTP-only cookies
- Middleware will auto-refresh session on subsequent requests

## Business Logic

### Credential Validation

**Plain English:**
The email must be a valid email format and password must not be empty. Server-side, Supabase Auth validates the credentials against stored user records.

**Rules:**
- Email: Required, valid email format
- Password: Required (no minimum length on login, only registration)

**Edge Cases:**
- Invalid email format: Shows validation error
- Wrong password: Shows "Invalid login credentials" error
- Unverified email: May require email verification depending on Supabase settings

**Source:** [login/page.tsx:25-44](../../apps/web/src/app/(auth)/login/page.tsx#L25-L44)

### Redirect After Login

**Plain English:**
If the user was trying to access a protected page before being redirected to login, they are sent back to that page after successful authentication. Otherwise, they go to the dashboard.

**Rules:**
```
redirectUrl = searchParams.get('redirectTo') || '/dashboard'
```

**Example:**
- User visits `/inventory` while logged out
- Middleware redirects to `/login?redirectTo=/inventory`
- After login, user is redirected to `/inventory`

**Source:** [login/page.tsx:23](../../apps/web/src/app/(auth)/login/page.tsx#L23), [middleware.ts:54-56](../../apps/web/src/middleware.ts#L54-L56)

## Error Handling

| Error | Cause | User Sees | Resolution |
|-------|-------|-----------|------------|
| "Invalid login credentials" | Wrong email or password | Red error banner above form | Check credentials and retry |
| "Email not confirmed" | User hasn't verified email | Red error banner | Check email for verification link |
| "An unexpected error occurred" | Network or server error | Red error banner | Retry later |

## States

| State | Condition | UI |
|-------|-----------|------------|
| Default | Page loaded | Empty form with email and password fields |
| Submitting | Form submitted | "Signing in..." button text, inputs disabled |
| Error | Auth failed | Red error banner above form |
| Success | Auth succeeded | Redirect to dashboard/intended page |

## Permissions

| Action | Required Permission |
|--------|---------------------|
| View login page | None (public) |
| Submit login form | None (public) |
| Access after login | Valid session |

## Related

- [Registration](./registration.md) — Create a new account
- [Authentication Overview](./overview.md) — Full authentication system docs

---

*Generated: 2026-01-18*
*Sources: login/page.tsx, use-auth.ts, middleware.ts*
*Screenshots: pending (app not running)*
