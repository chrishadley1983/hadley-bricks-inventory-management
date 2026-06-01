import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NegotiationScoringService,
  MIN_DISCOUNT_PERCENTAGE,
  MAX_DISCOUNT_PERCENTAGE,
} from '../negotiation-scoring.service';

/**
 * Build a minimal Supabase stub whose
 *   .from('negotiation_discount_rules').select(...).eq('user_id', ...)
 * resolves to the given rules (or error).
 */
function stubSupabase(result: {
  data?: Array<{ discount_percentage: number }> | null;
  error?: unknown;
}): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => Promise.resolve(result),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe('NegotiationScoringService.getMaxConfiguredDiscount', () => {
  const service = new NegotiationScoringService();
  const userId = 'user-1';

  it('returns the highest discount across configured rules', async () => {
    const supabase = stubSupabase({
      data: [
        { discount_percentage: 10 },
        { discount_percentage: 25 },
        { discount_percentage: 15 },
        { discount_percentage: 20 },
      ],
    });
    expect(await service.getMaxConfiguredDiscount(userId, supabase)).toBe(25);
  });

  it('falls back to the default mapping max (25) when no rules are configured', async () => {
    const supabase = stubSupabase({ data: [] });
    expect(await service.getMaxConfiguredDiscount(userId, supabase)).toBe(25);
  });

  it('falls back to the default mapping max on a query error', async () => {
    const supabase = stubSupabase({ data: null, error: new Error('boom') });
    expect(await service.getMaxConfiguredDiscount(userId, supabase)).toBe(25);
  });

  it('never exceeds the absolute system ceiling', async () => {
    const supabase = stubSupabase({ data: [{ discount_percentage: 90 }] });
    expect(await service.getMaxConfiguredDiscount(userId, supabase)).toBe(
      MAX_DISCOUNT_PERCENTAGE
    );
  });

  it('never drops below the floor', async () => {
    const supabase = stubSupabase({ data: [{ discount_percentage: 2 }] });
    expect(await service.getMaxConfiguredDiscount(userId, supabase)).toBe(
      MIN_DISCOUNT_PERCENTAGE
    );
  });
});
