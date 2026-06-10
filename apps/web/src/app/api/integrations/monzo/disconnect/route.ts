/**
 * Monzo Disconnect Route
 *
 * Disconnects the user's Monzo account.
 * POST /api/integrations/monzo/disconnect
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { monzoAuthService } from '@/lib/monzo';

export async function POST() {
  try {
    // 1. Auth check
    const { user, unauthorized } = await requireUser();
    if (unauthorized) return unauthorized;

    // 2. Disconnect
    await monzoAuthService.disconnect(user.id);

    // 3. Return success
    return NextResponse.json({
      data: { success: true },
    });
  } catch (error) {
    console.error('[POST /api/integrations/monzo/disconnect] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
