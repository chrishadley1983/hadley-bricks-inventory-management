import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MileageService } from '@/lib/services';

const UpdateHomeAddressSchema = z.object({
  homeAddress: z.string().min(1, 'Home address is required'),
});

/**
 * GET /api/settings/home-address
 * Get the user's home address for mileage calculation
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mileageService = new MileageService(supabase);
    const homeAddress = await mileageService.getHomeAddress(user.id);

    return NextResponse.json({ data: { homeAddress } });
  } catch (error) {
    console.error('[GET /api/settings/home-address] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/home-address
 * Update the user's home address for mileage calculation
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UpdateHomeAddressSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const mileageService = new MileageService(supabase);
    await mileageService.updateHomeAddress(user.id, parsed.data.homeAddress);

    return NextResponse.json({ data: { homeAddress: parsed.data.homeAddress } });
  } catch (error) {
    console.error('[PUT /api/settings/home-address] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
