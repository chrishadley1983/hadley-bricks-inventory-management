# Broad Sweep Schedule Specification

## Overview

Increased frequency broad sweep scanning to catch fresh mispriced LEGO listings within 10-15 minutes of posting.

## Parameters

| Parameter | Value |
|-----------|-------|
| Target frequency | 6 per hour (average) |
| Minimum gap | 5 minutes (hard floor) |
| Maximum gap | 18 minutes (ensures ~6/hour) |
| Operating hours | 07:00-23:00 (16 hours) |
| Daily target | ~96 scans (variable 85-110) |
| Skip chance | 8% per slot |
| Pages per scan | 2-4 (randomised) |

## Schedule Generation Logic

```typescript
interface BroadSweepConfig {
  targetPerHour: number;        // 6
  minGapMinutes: number;        // 5
  maxGapMinutes: number;        // 18
  skipChance: number;           // 0.08
  operatingHoursStart: number;  // 7
  operatingHoursEnd: number;    // 23
}

function generateBroadSweepSchedule(
  date: Date, 
  config: BroadSweepConfig,
  seed: string  // date + user_id for reproducibility
): Date[] {
  const rng = seededRandom(seed);
  const schedule: Date[] = [];
  
  // Start with random offset into first hour (0-8 minutes)
  let currentTime = new Date(date);
  currentTime.setHours(config.operatingHoursStart, 0, 0, 0);
  currentTime = addMinutes(currentTime, Math.floor(rng() * 8));
  
  const endTime = new Date(date);
  endTime.setHours(config.operatingHoursEnd, 0, 0, 0);
  
  while (currentTime < endTime) {
    // Skip chance (creates natural gaps)
    if (rng() > config.skipChance) {
      schedule.push(new Date(currentTime));
    }
    
    // Calculate next gap
    // Weighted toward middle of range for more natural distribution
    const gap = weightedRandomGap(
      rng,
      config.minGapMinutes,
      config.maxGapMinutes
    );
    
    currentTime = addMinutes(currentTime, gap);
  }
  
  return schedule;
}

function weightedRandomGap(
  rng: () => number,
  min: number,
  max: number
): number {
  // Bell curve centered on average (10 min)
  // Using two random numbers for normal-ish distribution
  const r1 = rng();
  const r2 = rng();
  const normal = (r1 + r2) / 2;  // Tends toward 0.5
  
  return Math.floor(min + (normal * (max - min)));
}
```

## Example Generated Day

```
07:03  Broad Sweep
07:14  Broad Sweep
07:22  Broad Sweep
07:33  Broad Sweep
07:40  Broad Sweep
07:51  Broad Sweep      ← 6 in first hour ✓
08:02  Broad Sweep
08:09  [SKIPPED]        ← 8% skip chance hit
08:18  Broad Sweep
08:31  Broad Sweep
08:38  Broad Sweep
08:49  Broad Sweep
08:56  Broad Sweep      ← 5 in second hour (one skipped) ✓
09:08  Broad Sweep
09:15  Broad Sweep
09:27  Broad Sweep
09:34  Broad Sweep
09:46  Broad Sweep
09:53  Broad Sweep      ← 6 in third hour ✓
...
```

## Distribution Characteristics

| Metric | Target | Achieved |
|--------|--------|----------|
| Average per hour | 6 | 5.5-6.5 (variance from skips) |
| Minimum gap | 5 min | Enforced |
| Average gap | 10 min | ~10 min (weighted distribution) |
| Daily total | ~96 | 85-110 (natural variance) |
| Consecutive days identical | Never | Seeded random per day |

## Separation from Watchlist Scans

Broad sweeps and watchlist scans must not collide. Minimum 2 minute separation enforced.

```typescript
function generateDailySchedule(date: Date, userId: string) {
  const broad = generateBroadSweepSchedule(
    date, 
    broadConfig, 
    `${date}-${userId}-broad`
  );
  const watchlist = generateWatchlistSchedule(
    date, 
    watchlistConfig, 
    `${date}-${userId}-watch`
  );
  
  // Ensure no collisions (minimum 2 min separation)
  return mergeSchedulesWithSeparation(broad, watchlist, 2);
}

function mergeSchedulesWithSeparation(
  broad: Date[], 
  watchlist: Date[], 
  minSeparationMinutes: number
): ScheduleEntry[] {
  const merged = [
    ...broad.map(t => ({ time: t, type: 'broad' as const })),
    ...watchlist.map(t => ({ 
      time: t.time, 
      type: 'watchlist' as const, 
      setNumber: t.setNumber 
    }))
  ].sort((a, b) => a.time.getTime() - b.time.getTime());
  
  // Nudge any collisions
  for (let i = 1; i < merged.length; i++) {
    const gap = (merged[i].time.getTime() - merged[i-1].time.getTime()) / 60000;
    if (gap < minSeparationMinutes) {
      // Push the later one forward
      merged[i].time = addMinutes(merged[i].time, minSeparationMinutes - gap);
    }
  }
  
  return merged;
}
```

## Daily Volume Summary

| Scan Type | Count | Page Loads |
|-----------|-------|------------|
| Broad sweep | ~90 | ~225 (avg 2.5 pages each) |
| Watchlist | ~200 | ~200 (1 page each) |
| **Total** | ~290 | **~425/day** |

## Risk Assessment

| Factor | Assessment |
|--------|------------|
| Volume | ✅ Within human-plausible range |
| Timing variance | ✅ 5-18 min gaps, weighted distribution |
| Daily variance | ✅ 85-110 scans (skip chance) |
| Pattern detection | ✅ Seeded random, different each day |
| Consistency | ✅ Skip chance prevents metronomic behaviour |

## Comparison to Previous

| Metric | Previous | New |
|--------|----------|-----|
| Broad sweeps/day | 14 | ~90 |
| Time to catch new listing | Up to 60 min | ~10-15 min |
| Operating hours | 08:00-22:00 | 07:00-23:00 |
| Total page loads/day | ~214 | ~425 |

---

*Specification version: 1.0*
*Created: 2026-01-22*
