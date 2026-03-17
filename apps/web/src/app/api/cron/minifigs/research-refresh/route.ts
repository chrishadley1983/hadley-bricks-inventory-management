import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// DISABLED: Terapeak research requires local Playwright + Chrome session.
// Re-enable once Chrome extension or alternative approach is in place.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ data: { message: 'Research refresh disabled', itemsRefreshed: 0 } });
}
