import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify the CRON_SECRET bearer token on a cron request.
 *
 * Consolidates the previously copy-pasted check across every `app/api/cron/**`
 * route. Returns a 401 `NextResponse` when the request is unauthorized (so the
 * caller can `return` it directly), or `null` when authorized.
 *
 * @param request - the incoming cron request
 * @param label - optional route label; when provided, an unauthorized request
 *   is logged as `[Cron <label>] Unauthorized request` (matches the routes that
 *   previously logged this warning).
 */
export function verifyCronAuth(request: NextRequest, label?: string): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    if (label) {
      console.warn(`[Cron ${label}] Unauthorized request`);
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
