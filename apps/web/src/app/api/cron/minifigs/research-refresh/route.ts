import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// DISABLED: Terapeak research requires local Playwright + Chrome session.
// Re-enable once Chrome extension or alternative approach is in place.
export async function GET() {
  return NextResponse.json({ data: { message: 'Research refresh disabled', itemsRefreshed: 0 } });
}
