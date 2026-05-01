import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}

export function HEAD() {
  return new NextResponse(null, { status: 200 });
}
