import { describe, it, expect } from 'vitest';
import { mapPartoutError } from '../partout-error';
import { BrickLinkApiError, RateLimitError } from '../client';
import { normaliseSetNumber } from '../partout.service';

describe('normaliseSetNumber', () => {
  it('appends the -1 sequence suffix to a bare set number', () => {
    // BL rejects "75192" with "Invalid item sequence number: null".
    expect(normaliseSetNumber('75192')).toBe('75192-1');
  });

  it('leaves an already-suffixed set number alone', () => {
    expect(normaliseSetNumber('75192-1')).toBe('75192-1');
    expect(normaliseSetNumber('10179-2')).toBe('10179-2');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseSetNumber('  75192  ')).toBe('75192-1');
    expect(normaliseSetNumber(' 75192-1 ')).toBe('75192-1');
  });

  it('passes non-numeric identifiers through untouched', () => {
    // Gear/book style catalogue numbers must not gain a suffix they never had.
    expect(normaliseSetNumber('BOOK123')).toBe('BOOK123');
    expect(normaliseSetNumber('mf-set')).toBe('mf-set');
  });
});

describe('mapPartoutError', () => {
  it('maps a rate-limit error to 429', () => {
    const err = new RateLimitError('slow down', {
      limit: 5000,
      remaining: 0,
      resetTime: new Date(),
    } as never);
    expect(mapPartoutError(err)).toEqual({
      status: 429,
      message: 'BrickLink API rate limit exceeded. Please try again later.',
    });
  });

  it('maps BL 400 PARAMETER_MISSING_OR_INVALID to a 404 that names the cause', () => {
    // This is the exact shape BL returns for a bare set number, and the case that
    // used to surface as an opaque 500.
    const err = new BrickLinkApiError(
      'PARAMETER_MISSING_OR_INVALID',
      400,
      'Invalid item sequence number: null'
    );
    const res = mapPartoutError(err);
    expect(res.status).toBe(404);
    expect(res.message).toContain('Invalid item sequence number');
  });

  it('maps BL 404 to 404', () => {
    expect(mapPartoutError(new BrickLinkApiError('RESOURCE_NOT_FOUND', 404)).status).toBe(404);
  });

  it('maps auth failures to 502 pointing at Settings', () => {
    const res = mapPartoutError(new BrickLinkApiError('BAD_OAUTH_REQUEST', 401));
    expect(res.status).toBe(502);
    expect(res.message).toContain('Settings');
  });

  it('maps any other BL error to 502 carrying the code', () => {
    const res = mapPartoutError(new BrickLinkApiError('SERVER_ERROR', 500));
    expect(res.status).toBe(502);
    expect(res.message).toContain('500');
  });

  it('falls back to a generic 500 for non-BrickLink errors', () => {
    expect(mapPartoutError(new Error('kaboom'))).toEqual({
      status: 500,
      message: 'Internal server error',
    });
    expect(mapPartoutError('not even an error').status).toBe(500);
  });
});
