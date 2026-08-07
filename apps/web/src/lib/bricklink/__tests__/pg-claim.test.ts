import { describe, expect, it } from 'vitest';
import {
  PG_QUEUE_CLAIM_COLS,
  applyStageFilters,
  isClaimableAtStage,
  pgStageSpec,
  type ClaimableRow,
} from '../pg-claim';
import {
  ERROR_PARK_ATTEMPTS,
  WORK_AHEAD_HORIZON_DAYS,
  WORK_AHEAD_MIN_LEAD_DAYS,
} from '../pg-cycle-policy';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

/** Records the filter chain applyStageFilters builds, so an inverted or dropped filter is
 *  visible to the suite. Before this existed, flipping .is('last_refreshed_at', null) to
 *  .not(...) took the backlog pool from 5,322 rows to 149,699 with the suite still green. */
function recordingBuilder() {
  const calls: string[] = [];
  const self = {
    calls,
    is(column: string, value: null) {
      calls.push(`is(${column},${String(value)})`);
      return self;
    },
    not(column: string, operator: string, value: null) {
      calls.push(`not(${column},${operator},${String(value)})`);
      return self;
    },
    eq(column: string, value: string) {
      calls.push(`eq(${column},${value})`);
      return self;
    },
    gt(column: string, value: string) {
      calls.push(`gt(${column},${value})`);
      return self;
    },
    lt(column: string, value: string | number) {
      calls.push(`lt(${column},${value})`);
      return self;
    },
    lte(column: string, value: string) {
      calls.push(`lte(${column},${value})`);
      return self;
    },
  };
  return self;
}

const chainFor = (stage: 'due' | 'backlog' | 'ahead', tier: 'active' | 'tail' = 'active') =>
  applyStageFilters(recordingBuilder(), stage, tier, NOW).calls;

describe('applyStageFilters — the filters actually sent to PostgREST', () => {
  it("'due' keeps the pre-work-ahead semantics exactly: unlocked, tier, next_due_at <= now", () => {
    expect(chainFor('due')).toEqual(['is(locked_by,null)', 'eq(tier,active)', `lte(next_due_at,${at(0)})`]);
  });

  it("'due' does NOT exclude parked tuples — a park still gets retried when its date arrives", () => {
    expect(chainFor('due').some((c) => c.startsWith('lt(attempts'))).toBe(false);
  });

  it("'backlog' selects NEVER-scraped rows (is null), not already-scraped ones", () => {
    const chain = chainFor('backlog');
    expect(chain).toContain('is(last_refreshed_at,null)');
    // the inversion that a constants-only test cannot see
    expect(chain).not.toContain('not(last_refreshed_at,is,null)');
  });

  it("'ahead' selects ALREADY-scraped rows (not null), not first-touch ones", () => {
    const chain = chainFor('ahead');
    expect(chain).toContain('not(last_refreshed_at,is,null)');
    expect(chain).not.toContain('is(last_refreshed_at,null)');
  });

  it('both work-ahead stages hold off anything due inside the +1d cool-off window', () => {
    expect(chainFor('backlog')).toContain(`gt(next_due_at,${at(WORK_AHEAD_MIN_LEAD_DAYS)})`);
    expect(chainFor('ahead')).toContain(`gt(next_due_at,${at(WORK_AHEAD_MIN_LEAD_DAYS)})`);
  });

  it("'backlog' is bounded at a year so the +100y park sentinels stay out", () => {
    expect(chainFor('backlog')).toContain(`lte(next_due_at,${at(365)})`);
  });

  it("'ahead' is bounded at the work-ahead horizon", () => {
    expect(chainFor('ahead')).toContain(`lte(next_due_at,${at(WORK_AHEAD_HORIZON_DAYS)})`);
    expect(applyStageFilters(recordingBuilder(), 'ahead', 'active', NOW, 7).calls).toContain(
      `lte(next_due_at,${at(7)})`,
    );
  });

  it('both work-ahead stages skip error-parked tuples', () => {
    expect(chainFor('backlog')).toContain(`lt(attempts,${ERROR_PARK_ATTEMPTS})`);
    expect(chainFor('ahead')).toContain(`lt(attempts,${ERROR_PARK_ATTEMPTS})`);
  });

  it('every stage filters to one tier and to unlocked rows', () => {
    for (const stage of ['due', 'backlog', 'ahead'] as const) {
      expect(chainFor(stage, 'tail')).toContain('eq(tier,tail)');
      expect(chainFor(stage, 'tail')).toContain('is(locked_by,null)');
    }
  });

  it('claims the columns the driver destructures', () => {
    for (const col of ['item_type', 'item_no', 'colour_id', 'tier', 'next_due_at', 'attempts', 'last_error']) {
      expect(PG_QUEUE_CLAIM_COLS.split(',')).toContain(col);
    }
  });
});

describe('isClaimableAtStage — the same rule as a predicate', () => {
  const scraped = (nextDue: string, extra: Partial<ClaimableRow> = {}): ClaimableRow => ({
    next_due_at: nextDue,
    last_refreshed_at: '2026-06-01T00:00:00.000Z',
    attempts: 0,
    ...extra,
  });
  const firstTouch = (nextDue: string, extra: Partial<ClaimableRow> = {}): ClaimableRow => ({
    next_due_at: nextDue,
    last_refreshed_at: null,
    attempts: 0,
    ...extra,
  });

  it('a locked row is claimable by nothing', () => {
    for (const stage of ['due', 'backlog', 'ahead'] as const) {
      expect(isClaimableAtStage(stage, scraped(at(-1), { locked_by: 'someone' }), NOW)).toBe(false);
    }
  });

  it('an overdue row is due-claimable regardless of whether it was ever scraped', () => {
    expect(isClaimableAtStage('due', scraped(at(-1)), NOW)).toBe(true);
    expect(isClaimableAtStage('due', firstTouch(at(-1)), NOW)).toBe(true);
    expect(isClaimableAtStage('due', firstTouch(at(1)), NOW)).toBe(false);
  });

  // The regression PR #667's review caught: toSoldUnavailableQueueUpdate requeues at
  // exactly +1d and leaves attempts AND last_refreshed_at untouched, so without a lead
  // floor the row re-enters 'backlog' the moment its lock clears. A second hit inside the
  // same run then fires isRepeatSoldUnavailable with no day boundary having passed —
  // writing an all-zero L1 row and demoting active -> tail on what may be a live outage.
  it('a sold-unavailable +1d cool-off row is NOT pulled forward by either work-ahead stage', () => {
    const cooling = firstTouch(at(1), { last_error: 'sold_unavailable (both sold quadrants unavailable)' } as Partial<ClaimableRow>);
    expect(isClaimableAtStage('backlog', cooling, NOW)).toBe(false);
    expect(isClaimableAtStage('ahead', cooling, NOW)).toBe(false);
    // ...and it comes back through 'due' a day later, exactly as the ladder intends
    expect(isClaimableAtStage('due', cooling, NOW + DAY + 1)).toBe(true);
  });

  it('a genuine first-touch backlog row beyond the cool-off is backlog-claimable', () => {
    expect(isClaimableAtStage('backlog', firstTouch(at(3)), NOW)).toBe(true);
    expect(isClaimableAtStage('backlog', firstTouch(at(300)), NOW)).toBe(true);
  });

  it('the +100y park sentinel is claimable by no work-ahead stage', () => {
    const sentinel = firstTouch(at(365 * 100));
    expect(isClaimableAtStage('backlog', sentinel, NOW)).toBe(false);
    expect(isClaimableAtStage('ahead', sentinel, NOW)).toBe(false);
  });

  it('an error-parked row is never pulled forward, but is still claimed when genuinely due', () => {
    const parked = { next_due_at: at(2), last_refreshed_at: null, attempts: ERROR_PARK_ATTEMPTS };
    expect(isClaimableAtStage('backlog', parked, NOW)).toBe(false);
    expect(isClaimableAtStage('due', { ...parked, next_due_at: at(-1) }, NOW)).toBe(true);
  });

  it('the stages are disjoint — no row is claimable by both backlog and ahead', () => {
    const rows = [firstTouch(at(2)), scraped(at(2)), firstTouch(at(0.5)), scraped(at(10))];
    for (const row of rows) {
      const hits = (['backlog', 'ahead'] as const).filter((s) => isClaimableAtStage(s, row, NOW));
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });

  it('an already-scraped row inside the horizon is ahead-claimable, outside it is not', () => {
    expect(isClaimableAtStage('ahead', scraped(at(2)), NOW)).toBe(true);
    expect(isClaimableAtStage('ahead', scraped(at(WORK_AHEAD_HORIZON_DAYS + 1)), NOW)).toBe(false);
  });

  it('a malformed next_due_at is claimable by nothing rather than throwing', () => {
    for (const stage of ['due', 'backlog', 'ahead'] as const) {
      expect(isClaimableAtStage(stage, { next_due_at: 'not-a-date' }, NOW)).toBe(false);
    }
  });
});

describe('pgStageSpec', () => {
  it('gives the two work-ahead stages opposite first-touch polarity', () => {
    expect(pgStageSpec('backlog').neverScraped).toBe(true);
    expect(pgStageSpec('ahead').neverScraped).toBe(false);
    expect(pgStageSpec('due').neverScraped).toBeNull();
  });

  it('only the work-ahead stages carry lead bounds and the park exclusion', () => {
    expect(pgStageSpec('due').minLeadDays).toBeNull();
    expect(pgStageSpec('due').excludeParked).toBe(false);
    for (const stage of ['backlog', 'ahead'] as const) {
      expect(pgStageSpec(stage).minLeadDays).toBe(WORK_AHEAD_MIN_LEAD_DAYS);
      expect(pgStageSpec(stage).excludeParked).toBe(true);
    }
  });
});
