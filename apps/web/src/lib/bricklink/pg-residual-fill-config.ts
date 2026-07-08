/**
 * Pure CLI-argument clamping for the lane C (anon curl) residual-fill service
 * (`scripts/pg/pg-residual-fill.ts`) — extracted so the session/ramp clamp logic has
 * unit coverage (spec done-criteria F6; gap found by the 2026-07-08 E2E validation:
 * lane D's equivalent, `pg-session-planner.ts`, was tested, lane C's wasn't).
 *
 * SESSION_MAX cap of 400 (raised from 40 on 2026-07-08): the ramp procedure raises
 * --session-max stepwise (40 -> 80 -> 160 -> 320) across nights while watching
 * bl_pg_lane_telemetry.first_block_at_request; 400 is headroom above the top rung,
 * not a validated steady-state value. Default stays 40 until the ramp completes.
 */

export interface ResidualFillArgv {
  'session-max'?: string;
  'breather-mins'?: string;
  'max-sessions'?: string;
  'pool-size'?: string;
  'api-rotate-max'?: string;
  'no-api-rotate'?: string;
  due?: string;
}

export interface ResidualFillConfig {
  sessionMax: number;
  breatherMins: number;
  maxSessions: number;
  poolSize: number;
  apiRotate: boolean;
  apiRotateMax: number;
  dueMode: boolean;
}

export const SESSION_MAX_CEILING = 400;
export const SESSION_MAX_DEFAULT = 40;

/** parseInt/parseFloat on garbage input yields NaN, which Math.max/min propagate
 * (NaN comparisons are always false) rather than clamp — falls back to `fallback`. */
function intOr(raw: string | undefined, fallback: number): number {
  const n = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function floatOr(raw: string | undefined, fallback: number): number {
  const n = raw != null ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function parseResidualFillConfig(argv: ResidualFillArgv): ResidualFillConfig {
  const sessionMax = Math.max(1, Math.min(SESSION_MAX_CEILING, intOr(argv['session-max'], SESSION_MAX_DEFAULT)));
  const breatherMins = Math.max(1, floatOr(argv['breather-mins'], 15));
  const maxSessions = Math.max(1, intOr(argv['max-sessions'], 8));
  const poolSize = Math.max(sessionMax, intOr(argv['pool-size'], 5000));
  const apiRotate = argv['no-api-rotate'] !== 'true';
  const apiRotateMax = Math.max(0, intOr(argv['api-rotate-max'], 50));
  const dueMode = argv.due === 'true';
  return { sessionMax, breatherMins, maxSessions, poolSize, apiRotate, apiRotateMax, dueMode };
}
