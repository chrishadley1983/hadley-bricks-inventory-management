# DataDome Security Hardening Plan

## Overview

Address anti-bot detection concerns by adding randomization and post-CAPTCHA recovery mechanisms.

---

## Issue 1: Reproducible Schedule Creates Fingerprint Pattern

**Problem**: Same date + user ID produces same schedule daily. DataDome could correlate timing patterns.

**Solution**: Add a daily random nonce that changes the schedule seed.

### Changes Required

**Database Migration** - Add `daily_nonce` column:
```sql
ALTER TABLE vinted_scanner_config
ADD COLUMN daily_nonce text,
ADD COLUMN daily_nonce_date date;
```

**Schedule Service** (`vinted-schedule.service.ts`):
- On schedule generation, check if `daily_nonce_date` matches today
- If not, generate a new random nonce and store it
- Include nonce in seed: `Date + UserID + Salt + DailyNonce`

```typescript
// In generateSchedule():
const nonce = await this.getOrCreateDailyNonce(userId, targetDate);
const seed = createDailySeed(targetDate, this.SALT + userId + nonce);
```

---

## Issue 2: Heartbeat Interval Inconsistency

**Problem**: Documentation says both 5 minutes and 60 seconds in different places.

**Current Code** (SchedulerEngine.cs):
- `HeartbeatIntervalMs = 300_000` (5 minutes)
- `ConfigPollIntervalMs = 300_000` (5 minutes)

**Solution**: This is already consistent at 5 minutes. The "60 seconds" reference was in error in the requirements doc. No code change needed - just documentation clarification.

---

## Issue 3: Fixed Operating Hours Start/End

**Problem**: Starting at exactly 06:00 every day is detectable.

**Solution**: Add ±15 minute variance to actual start/end times.

### Changes Required

**Database Migration** - Add variance columns:
```sql
ALTER TABLE vinted_scanner_config
ADD COLUMN start_variance_mins integer DEFAULT 15,
ADD COLUMN end_variance_mins integer DEFAULT 15;
```

**Schedule Service** (`vinted-schedule.service.ts`):
- Use the daily nonce (from Issue 1) to derive consistent variance for the day
- Apply variance: `actualStart = configStart + random(0, startVariance)`
- Apply variance: `actualEnd = configEnd - random(0, endVariance)`

```typescript
// Calculate daily variance using the same nonce
const startVariance = rng.nextInt(0, config.start_variance_mins || 15);
const endVariance = rng.nextInt(0, config.end_variance_mins || 15);

const actualStartMins = startHour * 60 + startVariance;
const actualEndMins = endHour * 60 - endVariance;
```

---

## Issue 4: No Post-CAPTCHA Cooldown

**Problem**: After CAPTCHA, resuming immediately at full rate looks suspicious.

**Solution**: Add recovery mode with mandatory cooldown and gradual ramp-up.

### Changes Required

**Database Migration** - Add recovery columns:
```sql
ALTER TABLE vinted_scanner_config
ADD COLUMN captcha_detected_at timestamptz,
ADD COLUMN recovery_mode boolean DEFAULT false,
ADD COLUMN recovery_rate_percent integer DEFAULT 100,
ADD COLUMN captcha_count_30d integer DEFAULT 0;
```

**New Recovery Logic**:

1. **On CAPTCHA Detection** (process API):
   - Set `captcha_detected_at = NOW()`
   - Set `recovery_mode = true`
   - Set `recovery_rate_percent = 25` (start at 25%)
   - Increment `captcha_count_30d`
   - Auto-pause scanner

2. **Recovery Ramp-Up Schedule**:
   - Day 0-1: 25% rate (skip 3 of every 4 scans)
   - Day 2-3: 50% rate (skip every other scan)
   - Day 4-5: 75% rate (skip 1 of every 4 scans)
   - Day 6+: 100% rate (normal operation)

3. **UI Changes** (`ScannerControlPanel.tsx`):
   - Show recovery mode banner with time remaining
   - Show current rate percentage
   - "Resume" button shows warning about recommended 24-48hr wait
   - Option to resume at reduced rate immediately

4. **Schedule Service Changes**:
   - When `recovery_mode = true`, apply rate limiting
   - Use seeded random to deterministically skip scans based on rate

```typescript
// In generateSchedule() or scanner execution:
if (config.recovery_mode && config.recovery_rate_percent < 100) {
  // Filter scans based on recovery rate
  const keepRatio = config.recovery_rate_percent / 100;
  allScans = allScans.filter((_, i) => rng.next() < keepRatio);
}
```

5. **Cron Job** (or check on heartbeat):
   - Auto-increment `recovery_rate_percent` based on time since `captcha_detected_at`
   - Exit recovery mode when rate reaches 100%

---

## Implementation Order

1. **Migration**: Create single migration with all new columns
2. **Issue 1**: Daily nonce (prevents pattern fingerprinting)
3. **Issue 3**: Operating hours variance (uses same nonce)
4. **Issue 4**: Post-CAPTCHA recovery (largest change)
5. **Issue 2**: No code change, just docs

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/XXXXXX_datadome_hardening.sql` | Add new columns |
| `apps/web/src/lib/services/vinted-schedule.service.ts` | Nonce, variance, recovery rate |
| `apps/web/src/app/api/arbitrage/vinted/automation/process/route.ts` | Set recovery mode on CAPTCHA |
| `apps/web/src/app/api/arbitrage/vinted/automation/config/route.ts` | Return recovery info |
| `apps/web/src/components/features/vinted-automation/ScannerControlPanel.tsx` | Recovery mode UI |
| `apps/web/src/hooks/use-vinted-automation.ts` | Add recovery types |
| `packages/database/src/types.ts` | Regenerate types |

---

## Estimated Scope

- **Database**: 1 migration
- **Backend**: 3 files modified
- **Frontend**: 2 files modified
- **Rebuild Scanner**: Not required (reads config from API)

---

## Risks & Considerations

1. **Nonce storage**: If nonce is lost mid-day, schedule changes. Acceptable - scanner polls for schedule version changes.

2. **Recovery mode aggressiveness**: 25% starting rate may miss opportunities. User can override if they accept the risk.

3. **Backwards compatibility**: New columns have sensible defaults, existing behavior unchanged until CAPTCHA triggers recovery.
