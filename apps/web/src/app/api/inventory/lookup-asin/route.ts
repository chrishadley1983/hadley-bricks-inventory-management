import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { AmazonCatalogClient } from '@/lib/amazon/amazon-catalog.client';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '@/lib/amazon/types';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  ean: z.string().optional(),
});

/**
 * GET /api/inventory/lookup-asin
 * Look up an Amazon ASIN for a set number
 *
 * Strategy:
 * 1. Check existing inventory for ASIN by set number
 * 2. If not found and EAN provided, search Amazon catalog by EAN
 * 3. If still not found, search Amazon catalog by keywords (LEGO + set number)
 *
 * Query params:
 * - setNumber: The set number to look up (e.g., "75192")
 * - ean: Optional EAN barcode for more precise lookup
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const url = new URL(request.url);
    const params = {
      setNumber: url.searchParams.get('setNumber'),
      ean: url.searchParams.get('ean') || undefined,
    };

    const parsed = QuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { setNumber, ean } = parsed.data;

    // Normalize set number (remove variant suffix for search)
    const baseSetNumber = setNumber.split('-')[0];

    // Strategy 1: Check existing inventory for this set number with an ASIN
    const { data: existingItems } = await supabase
      .from('inventory_items')
      .select('amazon_asin, set_number, item_name')
      .eq('set_number', baseSetNumber)
      .not('amazon_asin', 'is', null)
      .limit(1);

    if (existingItems && existingItems.length > 0 && existingItems[0].amazon_asin) {
      return NextResponse.json({
        data: {
          asin: existingItems[0].amazon_asin,
          source: 'inventory',
          title: existingItems[0].item_name,
        },
      });
    }

    // Also check with variant suffix
    const { data: variantItems } = await supabase
      .from('inventory_items')
      .select('amazon_asin, set_number, item_name')
      .ilike('set_number', `${baseSetNumber}%`)
      .not('amazon_asin', 'is', null)
      .limit(1);

    if (variantItems && variantItems.length > 0 && variantItems[0].amazon_asin) {
      return NextResponse.json({
        data: {
          asin: variantItems[0].amazon_asin,
          source: 'inventory',
          title: variantItems[0].item_name,
        },
      });
    }

    // Strategy 2 & 3: Use Amazon API if credentials are available
    const credentialsRepo = new CredentialsRepository(supabase);
    const amazonCredentials = await credentialsRepo.getCredentials<AmazonCredentials>(user.id, 'amazon');

    if (!amazonCredentials) {
      return NextResponse.json({
        data: null,
        message: 'No ASIN found in inventory. Configure Amazon API credentials to search Amazon catalog.',
      });
    }

    const catalogClient = new AmazonCatalogClient(amazonCredentials);

    // Strategy 2: Search by EAN if provided
    if (ean) {
      try {
        const eanResult = await catalogClient.searchCatalogByIdentifier(ean, 'EAN');
        if (eanResult.items.length > 0) {
          return NextResponse.json({
            data: {
              asin: eanResult.items[0].asin,
              source: 'amazon_ean',
              title: eanResult.items[0].title,
            },
          });
        }
      } catch (error) {
        console.warn('[lookup-asin] EAN search failed:', error);
        // Continue to keyword search
      }
    }

    // Strategy 3: Search by keywords
    try {
      const keywordResult = await catalogClient.searchCatalogByKeywords(`LEGO ${baseSetNumber}`);

      // Filter results to find the best match (title contains set number)
      const matchingItems = keywordResult.items.filter(
        (item) =>
          item.title?.includes(baseSetNumber) ||
          item.title?.toLowerCase().includes('lego')
      );

      if (matchingItems.length > 0) {
        return NextResponse.json({
          data: {
            asin: matchingItems[0].asin,
            source: 'amazon_search',
            title: matchingItems[0].title,
          },
        });
      }

      // If no filtered match, return first result if available
      if (keywordResult.items.length > 0) {
        return NextResponse.json({
          data: {
            asin: keywordResult.items[0].asin,
            source: 'amazon_search',
            title: keywordResult.items[0].title,
            warning: 'Result may not be an exact match',
          },
        });
      }
    } catch (error) {
      console.warn('[lookup-asin] Keyword search failed:', error);
    }

    return NextResponse.json({
      data: null,
      message: 'No ASIN found in inventory or Amazon catalog',
    });
  } catch (error) {
    console.error('[GET /api/inventory/lookup-asin] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
