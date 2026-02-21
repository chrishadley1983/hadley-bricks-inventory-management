import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BricqerClient, type BricqerCredentials } from '@/lib/bricqer';
import { CredentialsRepository } from '@/lib/repositories';

interface BricqerStatsCache {
  id: string;
  user_id: string;
  lot_count: number;
  piece_count: number;
  inventory_value: number;
  storage_locations: number;
  last_updated: string;
}

interface RawInventoryResponse {
  page: {
    count: number;
  };
  results: Array<{
    id: number;
    remainingQuantity: number;
    comments?: string;
    definition?: {
      legoId?: string;
      condition?: string;
      price?: number;
      color?: {
        id: number;
        name: string;
      };
    };
  }>;
}

const DELAY_MS = 600; // Rate limit: 600ms between requests

/**
 * GET /api/integrations/bricqer/inventory/stats-cached
 * Get cached Bricqer inventory statistics
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

    // Get cached stats
    const { data: cached } = await supabase
      .from('bricqer_stats_cache')
      .select('*')
      .eq('user_id', user.id)
      .single<BricqerStatsCache>();

    if (cached) {
      return NextResponse.json({
        data: {
          lotCount: cached.lot_count,
          pieceCount: cached.piece_count,
          inventoryValue: cached.inventory_value,
          storageLocations: cached.storage_locations,
          lastUpdated: cached.last_updated,
        },
      });
    }

    // No cache - return zeros with null lastUpdated to indicate needs refresh
    return NextResponse.json({
      data: {
        lotCount: 0,
        pieceCount: 0,
        inventoryValue: 0,
        storageLocations: 0,
        lastUpdated: null,
      },
    });
  } catch (error) {
    console.error('[GET /api/integrations/bricqer/inventory/stats-cached] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/integrations/bricqer/inventory/stats-cached
 * Refresh Bricqer inventory statistics (full scan) with SSE progress updates
 * This is a long-running operation (~3 minutes)
 */
export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const supabase = await createClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          send('error', { error: 'Unauthorized' });
          controller.close();
          return;
        }

        // Get credentials
        const credentialsRepo = new CredentialsRepository(supabase);
        const credentials = await credentialsRepo.getCredentials<BricqerCredentials>(
          user.id,
          'bricqer'
        );

        if (!credentials) {
          send('error', { error: 'Bricqer credentials not configured' });
          controller.close();
          return;
        }

        const client = new BricqerClient(credentials);

        send('progress', { phase: 'init', message: 'Connecting to Bricqer...' });

        // Get total count and storage locations
        const [apiStats, storageLocations] = await Promise.all([
          client.getInventoryStats(),
          client.getStorageLocations(),
        ]);

        const totalInApi = apiStats.totalItems;
        const totalPages = Math.ceil(totalInApi / 100);

        send('progress', {
          phase: 'scanning',
          message: `Scanning ${totalInApi.toLocaleString()} items...`,
          current: 0,
          total: totalPages,
          percent: 0,
        });

        // Full scan to calculate accurate stats
        // Group by (legoId, colorId, condition, remarks) to match Bricqer UI lot counting
        const uniquePieces = new Map<string, { qty: number; value: number }>();
        let totalQty = 0;
        let totalValue = 0;
        let page = 1;

        while (page <= totalPages + 1) {
          try {
            const pageResponse = await fetch(
              `${credentials.tenantUrl}/api/v1/inventory/item/?limit=100&page=${page}`,
              {
                headers: {
                  Authorization: `Api-Key ${credentials.apiKey}`,
                  Accept: 'application/json',
                },
              }
            );

            if (pageResponse.status === 429) {
              // Rate limited - wait and retry
              send('progress', {
                phase: 'rate-limited',
                message: 'Rate limited, waiting 30s...',
                current: page - 1,
                total: totalPages,
                percent: Math.round(((page - 1) / totalPages) * 100),
              });
              await new Promise((r) => setTimeout(r, 30000));
              continue;
            }

            const pageData = (await pageResponse.json()) as RawInventoryResponse;
            const items = pageData.results || [];
            if (items.length === 0) break;

            for (const item of items) {
              const qty = item.remainingQuantity ?? 0;
              if (qty > 0) {
                const legoId = item.definition?.legoId || String(item.id);
                const colorId = item.definition?.color?.id ?? 0;
                const condition = item.definition?.condition || 'U';
                const comments = item.comments || '';
                const price = item.definition?.price ?? 0;
                // Dedupe by ID + Colour + Condition + Comments
                const key = `${legoId}|${colorId}|${condition}|${comments}`;

                if (!uniquePieces.has(key)) {
                  uniquePieces.set(key, { qty: 0, value: 0 });
                }
                const entry = uniquePieces.get(key)!;
                entry.qty += qty;
                entry.value += qty * price;

                totalQty += qty;
                totalValue += qty * price;
              }
            }

            // Send progress update every page
            const percent = Math.round((page / totalPages) * 100);
            send('progress', {
              phase: 'scanning',
              message: `Page ${page}/${totalPages}`,
              current: page,
              total: totalPages,
              percent,
              lotCount: uniquePieces.size,
              pieceCount: totalQty,
            });

            page++;
            await new Promise((r) => setTimeout(r, DELAY_MS));
          } catch (err) {
            console.error(`Error at page ${page}:`, err);
            send('progress', {
              phase: 'error',
              message: `Error at page ${page}, retrying...`,
              current: page - 1,
              total: totalPages,
              percent: Math.round(((page - 1) / totalPages) * 100),
            });
            await new Promise((r) => setTimeout(r, 10000));
          }
        }

        const lotCount = uniquePieces.size;

        send('progress', { phase: 'saving', message: 'Saving to cache...', percent: 100 });

        // Upsert cache
        const { error: upsertError } = await supabase.from('bricqer_stats_cache').upsert(
          {
            user_id: user.id,
            lot_count: lotCount,
            piece_count: totalQty,
            inventory_value: totalValue,
            storage_locations: storageLocations.length,
            last_updated: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

        if (upsertError) {
          console.error('Error upserting cache:', upsertError);
        }

        // Send final result
        send('complete', {
          lotCount,
          pieceCount: totalQty,
          inventoryValue: totalValue,
          storageLocations: storageLocations.length,
          lastUpdated: new Date().toISOString(),
        });

        controller.close();
      } catch (error) {
        console.error('[POST /api/integrations/bricqer/inventory/stats-cached] Error:', error);
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send('error', { error: 'Internal server error' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
