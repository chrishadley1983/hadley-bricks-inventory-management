/**
 * POST /api/ebay/listing-refresh/[id]/execute
 *
 * Execute a refresh job with SSE streaming for progress updates
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { EbayListingRefreshService } from '@/lib/ebay/ebay-listing-refresh.service';
import type { RefreshProgressEvent, RefreshResult } from '@/lib/ebay/listing-refresh.types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if job exists
    const service = new EbayListingRefreshService(supabase, user.id);
    const job = await service.getRefreshJob(id);

    if (!job) {
      return NextResponse.json({ error: 'Refresh job not found' }, { status: 404 });
    }

    // Stream response for progress updates
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, data: RefreshProgressEvent | RefreshResult | string) => {
          const event = JSON.stringify({ type, data });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        };

        const onProgress = (event: RefreshProgressEvent) => {
          sendEvent('progress', event);
        };

        try {
          const result = await service.executeRefresh(id, onProgress);
          sendEvent('complete', result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          sendEvent('error', message);
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[POST /api/ebay/listing-refresh/[id]/execute] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
