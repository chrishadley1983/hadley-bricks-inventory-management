import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EnrichmentService } from '@/lib/inventory-explorer/enrichment.service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = new EnrichmentService(supabase, user.id);
    const result = await service.enrich();

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('[POST /api/inventory/explorer/enrich] Error:', error);
    return NextResponse.json(
      { error: 'Failed to enrich inventory', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
