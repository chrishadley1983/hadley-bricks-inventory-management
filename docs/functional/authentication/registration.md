# Registration

## Overview

The registration journey allows new users to create an account for the Hadley Bricks inventory management system. Users provide their business name, email, and password, then verify their email address before gaining access to the application.

## Entry Points

- Direct URL: `/register`
- Login page: "Sign up" link at bottom of login form

## Flow

### Step 1: Access Registration Page

Navigate to `/register` directly or via the "Sign up" link on the login page.

**Layout:**
- Centered card on light grey background
- Hadley Bricks logo with package icon
- "Inventory Management System" tagline

**Source:** [layout.tsx](../../apps/web/src/app/(auth)/layout.tsx)

### Step 2: Enter Account Details

Fill in the registration form with business name, email, and password.

**Fields/Elements:**

| Element | Type | Description | Validation |
|---------|------|-------------|------------|
| Business Name | Text input | Name of the user's LEGO resale business | Optional |
| Email | Text input | User's email address for login | Required, valid email format |
| Password | Password input | Chosen password | Required, minimum 8 characters |
| Confirm Password | Password input | Password confirmation | Required, must match password |
| "Create account" | Button | Submit the form | Disabled while submitting |

**Source:** [register/page.tsx](../../apps/web/src/app/(auth)/register/page.tsx)

### Step 3: Client-Side Validation

Before submitting, the form validates:

1. Passwords match
2. Password is at least 8 characters

**Source:** [register/page.tsx:29-39](../../apps/web/src/app/(auth)/register/page.tsx#L29-L39)

### Step 4: Account Creation

Form submission triggers account creation:

1. `signUp(email, password, { businessName })` called via `useAuth` hook
2. Supabase Auth creates user record
3. Business name stored in `user_metadata.business_name`
4. Database trigger creates corresponding `profiles` row

**Source:** [use-auth.ts:78-92](../../apps/web/src/hooks/use-auth.ts#L78-L92)

### Step 5: Email Verification

After successful registration:

1. Success message displayed: "Check your email"
2. User instructed to verify email address
3. Supabase sends verification email with confirmation link

**UI shows:**
- "Check your email" title
- "We've sent you a verification link" message
- "Back to sign in" button

**Source:** [register/page.tsx:62-78](../../apps/web/src/app/(auth)/register/page.tsx#L62-L78)

### Step 6: Email Confirmation

User clicks verification link in email:

1. Link redirects to `/api/auth/callback?code=...`
2. Callback exchanges code for session
3. User redirected to `/dashboard`
4. User is now fully authenticated

**Source:** [callback/route.ts](../../apps/web/src/app/api/auth/callback/route.ts)

## Business Logic

### Password Validation

**Plain English:**
Passwords must be at least 8 characters long to provide basic security. The password confirmation must exactly match the password to prevent typos.

**Rules:**
```
password.length >= 8
password === confirmPassword
```

**Example:**
- Password "short" (5 chars) → Error: "Password must be at least 8 characters"
- Password "Lego1234" with confirm "Lego1235" → Error: "Passwords do not match"
- Password "Lego1234" with confirm "Lego1234" → Valid

**Source:** [register/page.tsx:29-39](../../apps/web/src/app/(auth)/register/page.tsx#L29-L39)

### Business Name Storage

**Plain English:**
The optional business name is stored in Supabase user metadata, making it available immediately after registration. A database trigger also creates a profile record that can be updated later.

**Data flow:**
```
Registration form → signUp({ data: { business_name } })
                 → auth.users.raw_user_meta_data.business_name
                 → Database trigger → profiles.business_name
```

**Source:** [use-auth.ts:80-88](../../apps/web/src/hooks/use-auth.ts#L80-L88), [user.repository.ts](../../apps/web/src/lib/repositories/user.repository.ts)

### Email Verification

**Plain English:**
New accounts require email verification before the user can access protected features. This ensures the email address is valid and owned by the user.

**Rules:**
- Registration creates unverified user
- Verification email sent automatically by Supabase
- User must click email link to verify
- Verified status enables full application access

**Source:** [callback/route.ts](../../apps/web/src/app/api/auth/callback/route.ts)

## Error Handling

| Error | Cause | User Sees | Resolution |
|-------|-------|-----------|------------|
| "Passwords do not match" | Confirm password differs | Red error banner | Re-enter matching passwords |
| "Password must be at least 8 characters" | Password too short | Red error banner | Use longer password |
| "User already registered" | Email already exists | Red error banner | Use different email or sign in |
| "Invalid email" | Invalid email format | Red error banner | Correct email format |
| "An unexpected error occurred" | Network or server error | Red error banner | Retry later |

## States

| State | Condition | UI |
|-------|-----------|------------|
| Default | Page loaded | Empty form with all fields |
| Submitting | Form submitted | "Creating account..." button text, inputs disabled |
| Error | Validation/creation failed | Red error banner above form |
| Success | Account created | "Check your email" confirmation card |

## Permissions

| Action | Required Permission |
|--------|---------------------|
| View registration page | None (public) |
| Submit registration form | None (public) |
| Access app after verification | Verified email |

## Related

- [Sign In](./sign-in.md) — Log in to an existing account
- [Authentication Overview](./overview.md) — Full authentication system docs

---

*Generated: 2026-01-18*
*Sources: register/page.tsx, use-auth.ts, callback/route.ts*
*Screenshots: pending (app not running)*
