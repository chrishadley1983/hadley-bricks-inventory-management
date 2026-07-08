import { describe, it, expect } from 'vitest';
import { parseResidualFillConfig, SESSION_MAX_CEILING, SESSION_MAX_DEFAULT } from '../pg-residual-fill-config';

describe('parseResidualFillConfig', () => {
  it('defaults match the documented starting point (session-max 40, 8 sessions, 15-min breather)', () => {
    const c = parseResidualFillConfig({});
    expect(c.sessionMax).toBe(SESSION_MAX_DEFAULT);
    expect(c.maxSessions).toBe(8);
    expect(c.breatherMins).toBe(15);
    expect(c.apiRotate).toBe(true);
    expect(c.apiRotateMax).toBe(50);
    expect(c.dueMode).toBe(false);
  });

  it('clamps session-max to the 400 ceiling regardless of how high the flag asks', () => {
    expect(parseResidualFillConfig({ 'session-max': '1000' }).sessionMax).toBe(SESSION_MAX_CEILING);
    expect(parseResidualFillConfig({ 'session-max': String(SESSION_MAX_CEILING) }).sessionMax).toBe(SESSION_MAX_CEILING);
  });

  it('supports every rung of the documented ramp procedure (40 -> 80 -> 160 -> 320)', () => {
    for (const rung of [40, 80, 160, 320]) {
      expect(parseResidualFillConfig({ 'session-max': String(rung) }).sessionMax).toBe(rung);
    }
  });

  it('clamps session-max to a minimum of 1 on zero/negative input', () => {
    expect(parseResidualFillConfig({ 'session-max': '0' }).sessionMax).toBe(1);
    expect(parseResidualFillConfig({ 'session-max': '-5' }).sessionMax).toBe(1);
  });

  it('garbage session-max falls back to the default rather than propagating NaN', () => {
    // Math.max/min do NOT clamp NaN (NaN comparisons are always false) — unparseable
    // input must fall back to SESSION_MAX_DEFAULT, not silently become NaN.
    expect(parseResidualFillConfig({ 'session-max': 'nonsense' }).sessionMax).toBe(SESSION_MAX_DEFAULT);
    expect(Number.isFinite(parseResidualFillConfig({ 'session-max': 'nonsense' }).sessionMax)).toBe(true);
  });

  it('poolSize is never smaller than sessionMax, even if --pool-size asks for less', () => {
    const c = parseResidualFillConfig({ 'session-max': '80', 'pool-size': '10' });
    expect(c.poolSize).toBe(80);
  });

  it('breatherMins floors at 1 minute', () => {
    expect(parseResidualFillConfig({ 'breather-mins': '0' }).breatherMins).toBe(1);
    expect(parseResidualFillConfig({ 'breather-mins': '0.5' }).breatherMins).toBe(1);
  });

  it('--no-api-rotate=true disables lane-A rotation; anything else leaves it on', () => {
    expect(parseResidualFillConfig({ 'no-api-rotate': 'true' }).apiRotate).toBe(false);
    expect(parseResidualFillConfig({ 'no-api-rotate': 'false' }).apiRotate).toBe(true);
    expect(parseResidualFillConfig({}).apiRotate).toBe(true);
  });

  it('--due=true switches to due-tail mode', () => {
    expect(parseResidualFillConfig({ due: 'true' }).dueMode).toBe(true);
    expect(parseResidualFillConfig({}).dueMode).toBe(false);
  });

  it('apiRotateMax clamps to a minimum of 0 (never negative)', () => {
    expect(parseResidualFillConfig({ 'api-rotate-max': '-10' }).apiRotateMax).toBe(0);
  });
});
