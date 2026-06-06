import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/api/cron-auth';

export const runtime = 'nodejs';

// DISABLED: Terapeak research requires local Playwright + Chrome session.
// Re-enable once Chrome extension or alternative approach is in place.
export async function GET(request: NextRequest) {
  const unauthorized = verifyCronAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({ data: { message: 'Research refresh disabled', itemsRefreshed: 0 } });
}
