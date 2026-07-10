/**
 * Shared AI-usage audit logging.
 *
 * Logs every raw Anthropic-API-key call to the shared `public.ai_api_usage`
 * table in Supabase project modjoikyuhqzouxvieua (which is Hadley Bricks' own
 * Supabase DB, so we reuse the existing service-role client).
 *
 * STRICTLY fire-and-forget: a logging failure must NEVER block or break the
 * user's request. All callers invoke this without awaiting, and every error is
 * swallowed here.
 */

/**
 * One row in `public.ai_api_usage`.
 *
 * `project` and `billing_source` are filled in by `logAiUsage` if omitted, so
 * callers only need to supply the call-specific fields. Null/undefined fields
 * are stripped before insert (the table treats absent columns as null).
 */
export interface AiUsageRow {
  /** Defaults to "hadley-bricks". */
  project?: string;
  /** Feature label, e.g. "ebay_listing_generation". */
  feature?: string;
  /** Model id from the API response (response.model). */
  model?: string;
  /** Defaults to "api_key". */
  billing_source?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  /** Optional — omit unless known. */
  cost_usd?: number;
  /** Wall-clock duration of the call in milliseconds. */
  request_ms?: number;
  status?: 'success' | 'error';
  /** Error message when status is "error". */
  error?: string;
  /** Anthropic response.id. */
  anthropic_message_id?: string;
  /** Optional arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget insert into `public.ai_api_usage`.
 *
 * Do NOT await this in a way that can surface an error to the request path —
 * callers should invoke it without `await` (or wrap in a try/catch). This
 * function itself swallows every error, imports the Supabase client lazily so
 * the audit path adds no startup cost, and omits null/undefined fields.
 */
export function logAiUsage(row: AiUsageRow): void {
  // Run the actual work in a detached async IIFE so a synchronous throw can't
  // bubble up to the caller. The outer try/catch is belt-and-suspenders.
  try {
    void (async () => {
      try {
        // Lazy import of @supabase/supabase-js directly — NOT '@/lib/supabase/server',
        // whose next/headers import breaks any client-bundle consumer of this module
        // (webpack follows dynamic imports into the graph, so even a lazy import of
        // that module poisons the build).
        const { createClient } = await import('@supabase/supabase-js');

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!serviceRoleKey || !supabaseUrl) return; // no env (e.g. client bundle) — silently skip

        const fullRow: Record<string, unknown> = {
          project: 'hadley-bricks',
          billing_source: 'api_key',
          status: 'success',
          ...row,
        };

        // Strip null/undefined fields so the table stores them as absent.
        for (const key of Object.keys(fullRow)) {
          if (fullRow[key] === null || fullRow[key] === undefined) {
            delete fullRow[key];
          }
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        // The shared audit table isn't in the generated Database types, so cast
        // through unknown to reach `.from('ai_api_usage')`.
        await (supabase as unknown as {
          from: (t: string) => { insert: (r: unknown) => Promise<unknown> };
        })
          .from('ai_api_usage')
          .insert(fullRow);
      } catch {
        // Swallow — audit logging must never affect the user request.
      }
    })();
  } catch {
    // Swallow — audit logging must never affect the user request.
  }
}
