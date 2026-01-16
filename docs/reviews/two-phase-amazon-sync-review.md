# Code Review: Two-Phase Amazon Sync

**Branch:** `feature/two-phase-amazon-sync`
**Reviewed:** 2026-01-16
**Commits:** 2 (d175f65, ce8b3a5)
**Files Changed:** 19 (+2423, -92)

---

## Summary

This feature implements a two-phase sync mechanism for Amazon inventory updates to prevent a race condition where quantity updates could be processed before price updates propagate (up to 30 minutes). The solution splits sync operations into:

1. **Price Phase**: Submit price update → Poll until Amazon accepts → Verify price is live on Amazon
2. **Quantity Phase**: Submit quantity update → Poll until complete

Includes email (Resend) and push (Pushover) notifications for background completion.

---

## Verdict: ✅ APPROVED with Minor Recommendations

The implementation is well-structured, follows project patterns, and addresses a real business problem. The code is production-ready with a few minor improvements recommended below.

---

## Findings

### Critical Issues (0)

None.

### Major Issues (0)

None.

### Minor Issues (3)

#### M1: Missing environment variable documentation

**File:** Multiple services
**Severity:** Minor

New environment variables are required but not documented in CLAUDE.md:
- `RESEND_API_KEY` - Email service
- `PUSHOVER_USER_KEY` - Push notifications
- `PUSHOVER_API_TOKEN` - Push notifications

**Recommendation:** Add to Environment Variables section in CLAUDE.md.

---

#### M2: Email sender domain may not be verified

**File:** [apps/web/src/lib/email/email.service.ts:54](apps/web/src/lib/email/email.service.ts#L54)
**Severity:** Minor

```typescript
private defaultFrom = 'Hadley Bricks <notifications@hadleybricks.com>';
```

Resend requires domain verification. If `hadleybricks.com` is not verified, emails will fail silently (the service returns success even when disabled).

**Recommendation:** Verify domain in Resend dashboard or use Resend's default sender during development.

---

#### M3: Type assertion in service could be cleaner

**File:** [apps/web/src/lib/amazon/amazon-sync.service.ts](apps/web/src/lib/amazon/amazon-sync.service.ts)
**Severity:** Minor

Multiple places use type assertions like:
```typescript
} as Parameters<typeof this.updateFeedRecord>[1]);
```

This is a workaround for new columns not being in the generated types at development time.

**Recommendation:** Now that types are generated, these assertions can be removed for cleaner code.

---

### Nitpicks (2)

#### N1: Unused parameter in hook dependencies

**File:** [apps/web/src/hooks/use-amazon-sync.ts:492](apps/web/src/hooks/use-amazon-sync.ts#L492)

```typescript
}, [feedId, queryClient, onComplete, onError]);
```

The `poll` function doesn't change with `queryClient` (it's always the same instance), but including it is technically correct per React rules.

---

#### N2: Console logs in production code

**File:** [apps/web/src/lib/amazon/amazon-sync.service.ts](apps/web/src/lib/amazon/amazon-sync.service.ts)

Extensive `console.log` statements for debugging. These are useful during development but should be controlled via a debug flag or log level in production.

---

## Positive Highlights

### Well-Designed Architecture

The two-phase sync design is clean and handles the async nature well:

1. **Immediate return** after price feed submission - no blocking
2. **Polling-based progress** via `processTwoPhaseStep()` - resumable
3. **Clear state machine** with explicit steps: `price_polling → price_verifying → quantity_submission → quantity_polling → complete`

### Good Test Coverage

Both new services have unit tests:
- `email.service.test.ts` - 3 test suites, covers all email types
- `pushover.service.test.ts` - 4 test suites, covers error handling

### Graceful Degradation

Services are designed to work when unconfigured:
```typescript
if (!resend) {
  console.log('[EmailService] Skipping - not configured');
  return { success: true }; // Silent skip
}
```

### Clear Documentation

Excellent inline documentation with ASCII diagrams for status flow:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FEED STATUS REFERENCE TABLE                          │
├─────────────────────┬───────────────────────────────────────────────────────┤
│ Status              │ Meaning                                               │
├─────────────────────┼───────────────────────────────────────────────────────┤
...
```

### Proper UI Feedback

The `SyncSubmitControls` component provides:
- Progress indicator with percentage
- Clear status messages per step
- "You can safely navigate away" messaging
- Error dismissal

### Database Schema Design

Migration is well-designed:
- Uses `IF NOT EXISTS` for idempotency
- Includes index for parent-child feed relationships
- Documents columns with `COMMENT ON`

---

## Security Checklist

| Item | Status |
|------|--------|
| Auth check on API routes | ✅ Uses `supabase.auth.getUser()` |
| Input validation | ✅ Zod schema for request body |
| No credentials in code | ✅ Uses environment variables |
| RLS policies | ✅ Existing policies apply (same tables) |
| Error messages sanitized | ✅ Generic errors for 500s |

---

## Performance Checklist

| Item | Status |
|------|--------|
| No N+1 queries | ✅ Single feed fetch per poll |
| Batch operations | ✅ Aggregates items before submission |
| Reasonable polling interval | ✅ 5-30 seconds depending on phase |
| Timeout protection | ✅ 30-minute max with clear failure path |

---

## Hadley Bricks Patterns

| Pattern | Followed |
|---------|----------|
| Repository pattern | N/A (extends existing service) |
| Zod validation | ✅ `SubmitSchema` in route |
| shadcn/ui components | ✅ Alert, Progress, Dialog, Tooltip |
| Sonner toasts | N/A (uses Alert inline) |
| TanStack Query | ✅ Proper query key factory, cache updates |

---

## Recommendations Summary

### Immediate (before merge)

1. Add environment variable documentation to CLAUDE.md

### Soon (follow-up PR)

2. Verify Resend domain or update default sender
3. Clean up type assertions now that types are regenerated
4. Consider adding a debug/log level flag

---

## Files Reviewed

| File | Lines | Notes |
|------|-------|-------|
| `amazon-sync.service.ts` | +752 | Core two-phase logic |
| `amazon-sync.types.ts` | +116 | Well-documented type definitions |
| `use-amazon-sync.ts` | +203 | Clean hook implementation |
| `email.service.ts` | +277 | Resend integration |
| `pushover.service.ts` | +158 | Push notification service |
| `email.service.test.ts` | +126 | Good coverage |
| `pushover.service.test.ts` | +218 | Comprehensive tests |
| `SyncSubmitControls.tsx` | +296 | Good UX with progress |
| `SyncFeedStatus.tsx` | +76 | Status display component |
| `route.ts` (submit) | +49 | Clean API route |
| `20260123000001_two_phase_sync.sql` | +33 | Well-designed migration |
| `types.ts` | +67 | Generated types |

---

**Reviewer:** Claude Code Review Agent
**Result:** APPROVED ✅
