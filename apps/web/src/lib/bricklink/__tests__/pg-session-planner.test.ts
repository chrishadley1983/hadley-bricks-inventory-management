import { describe, it, expect } from 'vitest';
import { planNight, nextAction, type PlannerState } from '../pg-session-planner';

// Baseline "everything is fine" state — each test mutates only the field(s) under test.
function baseState(overrides: Partial<PlannerState> = {}): PlannerState {
  return {
    requestsThisSession: 0,
    consecutiveFails: 0,
    consecutiveSoldUnavailable: 0,
    soldUnavailableBrake: 5,
    sessionsCompleted: 0,
    blockedSessions: 0,
    sessionSize: 350,
    maxSessions: 6,
    elapsedMinutes: 0,
    windowMinutes: 420,
    ...overrides,
  };
}

describe('planNight', () => {
  it('computes a simple same-day window (00:00-07:00 -> 420 minutes)', () => {
    const plan = planNight({ sessionSize: 350, breatherMins: 20, maxSessions: 6 });
    expect(plan.windowMinutes).toBe(420);
    expect(plan.sessions).toHaveLength(6);
    expect(plan.sessions[0]).toEqual({ index: 1, estStartMinute: 0 });
    expect(plan.sessions[5]).toEqual({ index: 6, estStartMinute: 100 });
    expect(plan.estTotalPages).toBe(2100);
  });

  it('wraps a window that crosses midnight (23:00-07:00 -> 480 minutes)', () => {
    const plan = planNight({
      windowStartHour: 23,
      windowEndHour: 7,
      sessionSize: 100,
      breatherMins: 10,
      maxSessions: 3,
    });
    expect(plan.windowMinutes).toBe(480);
  });

  it('flags when breather time alone cannot fit the window', () => {
    const tight = planNight({
      windowStartHour: 0,
      windowEndHour: 1, // 60 minutes total
      sessionSize: 350,
      breatherMins: 20,
      maxSessions: 6, // 5 breathers * 20min = 100min > 60min window
    });
    expect(tight.estFitsWindow).toBe(false);

    const roomy = planNight({
      windowStartHour: 0,
      windowEndHour: 7,
      sessionSize: 350,
      breatherMins: 20,
      maxSessions: 6, // 5 breathers * 20min = 100min <= 420min window
    });
    expect(roomy.estFitsWindow).toBe(true);
  });

  it('defaults to a 0-7h window when hours are omitted', () => {
    const plan = planNight({ sessionSize: 350, breatherMins: 20, maxSessions: 6 });
    expect(plan.windowStartMinute).toBe(0);
    expect(plan.windowMinutes).toBe(7 * 60);
  });
});

describe('nextAction', () => {
  it('fetches when nothing noteworthy has happened', () => {
    expect(nextAction(baseState())).toBe('fetch');
  });

  it('session boundary: hits sessionSize with no block -> breather (not stop, not backoff)', () => {
    const state = baseState({ requestsThisSession: 350 });
    expect(nextAction(state)).toBe('breather');
  });

  it('does not breather just short of the boundary', () => {
    const state = baseState({ requestsThisSession: 349 });
    expect(nextAction(state)).toBe('fetch');
  });

  it('block signal -> backoff, even mid-session (overrides the fetch/breather choice)', () => {
    const state = baseState({ requestsThisSession: 12, consecutiveFails: 1 });
    expect(nextAction(state)).toBe('backoff');
  });

  it('block signal takes precedence over an exact session-boundary hit', () => {
    const state = baseState({ requestsThisSession: 350, consecutiveFails: 1 });
    expect(nextAction(state)).toBe('backoff');
  });

  // 2026-07-25 regression: PgSoldUnavailableError used to feed `consecutiveFails`, so a
  // single item whose sold quadrants both read "(Unavailable)" ended the whole session —
  // and two such sessions killed the run (three runs lost: 1,098 / 2,352 / 16 tuples,
  // against ZERO 403s in 12,376 requests). One is indistinguishable from an item that
  // simply never sold in either condition; only a BROAD run of them is an outage.
  it('a single sold-unavailable does NOT end the session', () => {
    const state = baseState({ requestsThisSession: 12, consecutiveSoldUnavailable: 1 });
    expect(nextAction(state)).toBe('fetch');
  });

  it('sold-unavailable just short of the brake keeps fetching', () => {
    const state = baseState({ consecutiveSoldUnavailable: 4, soldUnavailableBrake: 5 });
    expect(nextAction(state)).toBe('fetch');
  });

  it('a BROAD sold-data outage (brake reached) -> backoff', () => {
    const state = baseState({ consecutiveSoldUnavailable: 5, soldUnavailableBrake: 5 });
    expect(nextAction(state)).toBe('backoff');
  });

  it('sold-unavailable brake is independent of the block brake', () => {
    // 4 sold-unavailable is fine on its own, but ONE real block still backs off.
    expect(nextAction(baseState({ consecutiveSoldUnavailable: 4 }))).toBe('fetch');
    expect(nextAction(baseState({ consecutiveFails: 1 }))).toBe('backoff');
  });

  it('sold-unavailable at the brake still yields to a hard stop condition', () => {
    const state = baseState({ consecutiveSoldUnavailable: 9, blockedSessions: 2 });
    expect(nextAction(state)).toBe('stop');
  });

  it('two consecutive blocked sessions -> stop', () => {
    const state = baseState({ blockedSessions: 2 });
    expect(nextAction(state)).toBe('stop');
  });

  it('one blocked session alone does not stop the run', () => {
    const state = baseState({ blockedSessions: 1 });
    expect(nextAction(state)).toBe('fetch');
  });

  it('maxSessions reached -> stop', () => {
    const state = baseState({ sessionsCompleted: 6, maxSessions: 6 });
    expect(nextAction(state)).toBe('stop');
  });

  it('maxSessions stop takes precedence over an otherwise-fetchable state', () => {
    const state = baseState({ sessionsCompleted: 6, maxSessions: 6, requestsThisSession: 0, consecutiveFails: 0 });
    expect(nextAction(state)).toBe('stop');
  });

  it('window end -> stop', () => {
    const state = baseState({ elapsedMinutes: 420, windowMinutes: 420 });
    expect(nextAction(state)).toBe('stop');
  });

  it('window end stop fires even mid-session with no blocks', () => {
    const state = baseState({ elapsedMinutes: 500, windowMinutes: 420, requestsThisSession: 5 });
    expect(nextAction(state)).toBe('stop');
  });

  it('stop conditions outrank backoff/breather regardless of order combined', () => {
    // Window elapsed AND blocked AND at sessionSize AND has a block signal - still just 'stop'.
    const state = baseState({
      elapsedMinutes: 421,
      windowMinutes: 420,
      blockedSessions: 2,
      sessionsCompleted: 6,
      maxSessions: 6,
      requestsThisSession: 350,
      consecutiveFails: 1,
    });
    expect(nextAction(state)).toBe('stop');
  });
});
