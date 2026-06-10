/**
 * Shared cookie-auth gate for API route handlers (audit §1.2).
 *
 * Replaces the block inlined across ~320 routes:
 *
 *   const supabase = await createClient();
 *   const { data: { user }, error: authError } = await supabase.auth.getUser();
 *   if (authError || !user) {
 *     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   }
 *
 * Usage:
 *
 *   const { user, supabase, unauthorized } = await requireUser();
 *   if (unauthorized) return unauthorized;
 *   // user is non-null here; supabase is the same cookie-auth client
 *
 * Deliberately cookie-only: routes that also accept `x-api-key` use
 * `validateAuth` (lib/api/validate-auth.ts); cron routes use `verifyCronAuth`
 * (lib/api/cron-auth.ts). Adding API-key auth here would silently widen the
 * security surface of every adopting route.
 */

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { createClient } from '@/lib/supabase/server';

export type RequireUserResult =
  | { user: User; supabase: SupabaseClient<Database>; unauthorized: null }
  | { user: null; supabase: SupabaseClient<Database>; unauthorized: NextResponse };

/**
 * Resolve the cookie-auth Supabase client and the current user.
 * `unauthorized` is a ready-made standard 401 response when there is no user.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase,
      unauthorized: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { user, supabase, unauthorized: null };
}
