/**
 * PG refresh-queue claim staging — the shared definition of "what may this run claim?".
 *
 * Lives in src/lib rather than beside the driver in scripts/ for one reason: scripts/ is
 * excluded from tsconfig.json AND from vitest's include globs, so claim logic written
 * there is invisible to the test suite. That is not theoretical — during review of
 * PR #667 an inverted `.is('last_refreshed_at', null)` -> `.not(...)` took the backlog
 * pool from 5,322 rows to 149,699 and the whole suite still passed green.
 *
 * Both representations below are built from the SAME `pgStageSpec`, so the PostgREST
 * chain and the pure predicate cannot drift apart on the bounds:
 *   - applyStageFilters()  — what the driver actually sends to PostgREST
 *   - isClaimableAtStage() — the same rule as a pure function, for tests and for any
 *                            caller reasoning about a row it already holds
 *
 * Cadence constants come from pg-cycle-policy.ts and are never redeclared here.
 */

import {
  ERROR_PARK_ATTEMPTS,
  WORK_AHEAD_BACKLOG_MAX_DAYS,
  WORK_AHEAD_HORIZON_DAYS,
  WORK_AHEAD_MIN_LEAD_DAYS,
  type PgClaimStage,
} from './pg-cycle-policy';

/** Columns the driver needs off a claimed queue row. */
export const PG_QUEUE_CLAIM_COLS =
  'item_type,item_no,colour_id,tier,grace_until,next_due_at,attempts,last_error';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PgStageSpec {
  /** 'due' only: next_due_at has passed. Mutually exclusive with the lead-time bounds. */
  dueNow: boolean;
  /** true = last_refreshed_at IS NULL, false = IS NOT NULL, null = don't care. */
  neverScraped: boolean | null;
  /** Exclusive lower bound on next_due_at, in days from now. */
  minLeadDays: number | null;
  /** Inclusive upper bound on next_due_at, in days from now. */
  maxLeadDays: number | null;
  /** Skip tuples parked for operator attention (attempts >= ERROR_PARK_ATTEMPTS). */
  excludeParked: boolean;
}

/**
 * The claim rule for one stage. See PgClaimStage in pg-cycle-policy.ts for the ladder.
 *
 * 'due' is deliberately left exactly as it was pre-work-ahead: no park exclusion, no lead
 * bounds. A parked tuple whose date genuinely arrives is still claimed and still retried —
 * work-ahead only declines to pull that forward.
 */
export function pgStageSpec(
  stage: PgClaimStage,
  horizonDays: number = WORK_AHEAD_HORIZON_DAYS,
): PgStageSpec {
  switch (stage) {
    case 'due':
      return {
        dueNow: true,
        neverScraped: null,
        minLeadDays: null,
        maxLeadDays: null,
        excludeParked: false,
      };
    case 'backlog':
      return {
        dueNow: false,
        neverScraped: true,
        minLeadDays: WORK_AHEAD_MIN_LEAD_DAYS,
        // Bounded so the +100y "Not in BL catalog" park sentinels stay out.
        maxLeadDays: WORK_AHEAD_BACKLOG_MAX_DAYS,
        excludeParked: true,
      };
    case 'ahead':
      return {
        dueNow: false,
        neverScraped: false,
        minLeadDays: WORK_AHEAD_MIN_LEAD_DAYS,
        maxLeadDays: horizonDays,
        excludeParked: true,
      };
  }
}

/** The subset of the PostgREST builder this module uses. Non-recursive on purpose: a
 *  self-referential `Q extends StageFilterable<Q>` constraint blows TypeScript's
 *  instantiation budget (TS2589) once the head:true/count:'exact' builder is passed in. */
export interface StageFilterable {
  is(column: string, value: null): StageFilterable;
  not(column: string, operator: 'is', value: null): StageFilterable;
  eq(column: string, value: string): StageFilterable;
  gt(column: string, value: string): StageFilterable;
  lt(column: string, value: string | number): StageFilterable;
  lte(column: string, value: string): StageFilterable;
}

function leadIso(nowMs: number, days: number): string {
  return new Date(nowMs + days * MS_PER_DAY).toISOString();
}

/**
 * Apply one stage x one tier as PostgREST filters. The generic passes the caller's real
 * builder type straight through, so `.order()`/`.limit()` and the `{ count, error }`
 * destructure keep working at the call site.
 */
export function applyStageFilters<Q>(
  query: Q,
  stage: PgClaimStage,
  tier: 'active' | 'tail',
  nowMs: number,
  horizonDays: number = WORK_AHEAD_HORIZON_DAYS,
): Q {
  const spec = pgStageSpec(stage, horizonDays);
  let q = (query as StageFilterable).is('locked_by', null).eq('tier', tier);

  if (spec.dueNow) return q.lte('next_due_at', new Date(nowMs).toISOString()) as unknown as Q;

  if (spec.minLeadDays !== null) q = q.gt('next_due_at', leadIso(nowMs, spec.minLeadDays));
  if (spec.maxLeadDays !== null) q = q.lte('next_due_at', leadIso(nowMs, spec.maxLeadDays));
  if (spec.excludeParked) q = q.lt('attempts', ERROR_PARK_ATTEMPTS);
  if (spec.neverScraped === true) q = q.is('last_refreshed_at', null);
  else if (spec.neverScraped === false) q = q.not('last_refreshed_at', 'is', null);

  return q as unknown as Q;
}

export interface ClaimableRow {
  next_due_at: string;
  last_refreshed_at?: string | null;
  attempts?: number | null;
  locked_by?: string | null;
}

/** The same rule as applyStageFilters, as a pure predicate. */
export function isClaimableAtStage(
  stage: PgClaimStage,
  row: ClaimableRow,
  nowMs: number,
  horizonDays: number = WORK_AHEAD_HORIZON_DAYS,
): boolean {
  if (row.locked_by != null) return false;

  const dueMs = Date.parse(row.next_due_at);
  if (Number.isNaN(dueMs)) return false;

  const spec = pgStageSpec(stage, horizonDays);
  if (spec.dueNow) return dueMs <= nowMs;

  if (spec.minLeadDays !== null && dueMs <= nowMs + spec.minLeadDays * MS_PER_DAY) return false;
  if (spec.maxLeadDays !== null && dueMs > nowMs + spec.maxLeadDays * MS_PER_DAY) return false;
  if (spec.excludeParked && (row.attempts ?? 0) >= ERROR_PARK_ATTEMPTS) return false;

  const scraped = row.last_refreshed_at != null;
  if (spec.neverScraped === true && scraped) return false;
  if (spec.neverScraped === false && !scraped) return false;

  return true;
}
