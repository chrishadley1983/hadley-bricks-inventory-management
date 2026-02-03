/**
 * Service API: ASIN Lookup
 *
 * GET - Look up an Amazon ASIN for a LEGO set number
 * Uses system Amazon credentials for service calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withServiceAuth, getSystemUserId } from '@/lib/middleware/service-auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { AmazonCatalogClient } from '@/lib/amazon/amazon-catalog.client';
import { CredentialsRepository } from '@/lib/repositories/credentials.repository';
import type { AmazonCredentials } from '@/lib/amazon/types';

const QuerySchema = z.object({
  setNumber: z.string().min(1, 'Set number is required'),
  ean: z.string().optional(),
});

/**
 * GET /api/service/inventory/lookup-asin
 * Look up an Amazon ASIN for a set number using system credentials
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
  return withServiceAuth(request, ['read'], async (_keyInfo) => {
    try {
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
      const baseSetNumber = setNumber.split('-')[0];

      const supabase = createServiceRoleClient();

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

      // Strategy 2 & 3: Use Amazon API with system credentials
      const systemUserId = await getSystemUserId();
      const credentialsRepo = new CredentialsRepository(supabase);
      const amazonCredentials = await credentialsRepo.getCredentials<AmazonCredentials>(
        systemUserId,
        'amazon'
      );

      if (!amazonCredentials) {
        return NextResponse.json(
          { error: 'No ASIN found in inventory. Amazon API credentials not configured.' },
          { status: 404 }
        );
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
          console.warn('[service/lookup-asin] EAN search failed:', error);
        }
      }

      // Strategy 3: Search by keywords
      try {
        const keywordResult = await catalogClient.searchCatalogByKeywords(`LEGO ${baseSetNumber}`);

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
        console.warn('[service/lookup-asin] Keyword search failed:', error);
      }

      return NextResponse.json(
        { error: 'No ASIN found in inventory or Amazon catalog' },
        { status: 404 }
      );
    } catch (error) {
      console.error('[GET /api/service/inventory/lookup-asin] Error:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
