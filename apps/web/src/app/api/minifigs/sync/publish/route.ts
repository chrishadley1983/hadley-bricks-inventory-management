import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ListingActionsService } from '@/lib/minifig-sync/listing-actions.service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  itemId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
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
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const service = new ListingActionsService(supabase, user.id);
    const result = await service.publish(parsed.data.itemId);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/minifigs/sync/publish] Error:', error);

    // Surface eBay-specific errors so the user sees what actually failed
    let details = error instanceof Error ? error.message : String(error);
    let statusCode = 500;

    // EbayApiError has structured error info
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const ebayError = error as { statusCode: number; errors?: Array<{ message?: string; parameters?: Array<{ name: string; value: string }> }> };
      statusCode = ebayError.statusCode >= 400 && ebayError.statusCode < 600 ? ebayError.statusCode : 500;
      if (ebayError.errors?.length) {
        details = ebayError.errors
          .map((e) => {
            let msg = e.message || '';
            if (e.parameters?.length) {
              msg += ' [' + e.parameters.map((p) => `${p.name}=${p.value}`).join(', ') + ']';
            }
            return msg;
          })
          .join('; ');
      }
    }

    return NextResponse.json(
      {
        error: 'Failed to publish listing',
        details,
      },
      { status: statusCode }
    );
  }
}
