/**
 * Shared script helper for building a BrickLinkClient with daily-counter tracking.
 *
 * Use this instead of `new BrickLinkClient(creds)` in any manual script so that
 * calls increment the `bricklink_api_calls_daily` table and pass through the
 * soft gate. Without this wiring, scripts go through the client but the counter
 * is dormant — meaning their spend is invisible.
 *
 *   import { createScriptBlContext } from './_bl-client';
 *   const { bl, supabase } = createScriptBlContext('my-script-name');
 *   const orders = await bl.getSalesOrders();
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BrickLinkClient } from '../src/lib/bricklink/client';

export interface ScriptBlContext {
  bl: BrickLinkClient;
  supabase: SupabaseClient;
}

/**
 * Build a script-scoped BrickLinkClient with quota tracking + a service-role
 * Supabase client (shared between the BL counter writes and any other queries
 * the script makes).
 *
 * @param caller — short identifier that appears in `bricklink_api_calls_daily.by_caller`.
 *                 Use a descriptive label like `scan-bl-store` or `find-piece-script`.
 */
export function createScriptBlContext(caller: string): ScriptBlContext {
  const creds = {
    consumerKey: process.env.BRICKLINK_CONSUMER_KEY ?? '',
    consumerSecret: process.env.BRICKLINK_CONSUMER_SECRET ?? '',
    tokenValue: process.env.BRICKLINK_TOKEN_VALUE ?? '',
    tokenSecret: process.env.BRICKLINK_TOKEN_SECRET ?? '',
  };
  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => `BRICKLINK_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`Missing BrickLink env vars: ${missing.join(', ')}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const bl = new BrickLinkClient(creds, { supabase, caller });

  return { bl, supabase };
}
