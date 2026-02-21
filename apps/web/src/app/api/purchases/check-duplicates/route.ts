/**
 * Check Duplicates API Route
 *
 * POST /api/purchases/check-duplicates
 *
 * Checks for duplicate purchases based on source, cost, and date.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Request validation schema
const PurchaseToCheckSchema = z.object({
  index: z.number(),
  price: z.number().positive(),
  title: z.string(),
  purchaseDate: z.string().nullable(),
});

const RequestSchema = z.object({
  purchases: z.array(PurchaseToCheckSchema).min(1).max(50),
});

// Response types
export interface DuplicateCheckResult {
  index: number;
  isDuplicate: boolean;
  duplicateType: 'exact' | 'likely' | 'possible' | 'none';
  existingPurchaseId?: string;
  existingPurchaseDescription?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate request body
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { purchases } = parsed.data;

    console.log(
      `[POST /api/purchases/check-duplicates] Checking ${purchases.length} purchases for user ${user.id}`
    );

    // 3. Get existing Vinted purchases for comparison
    const { data: existingPurchases, error: queryError } = await supabase
      .from('purchases')
      .select('id, cost, purchase_date, short_description')
      .eq('user_id', user.id)
      .eq('source', 'Vinted')
      .order('purchase_date', { ascending: false })
      .limit(500);

    if (queryError) {
      console.error('[POST /api/purchases/check-duplicates] Query error:', queryError);
      return NextResponse.json({ error: 'Failed to check for duplicates' }, { status: 500 });
    }

    // 4. Check each purchase for duplicates
    const results: DuplicateCheckResult[] = purchases.map((purchase) => {
      // Look for exact match: same cost + same date
      const exactMatch = existingPurchases?.find((existing) => {
        const costMatch = Math.abs(Number(existing.cost) - purchase.price) < 0.01;
        const dateMatch = purchase.purchaseDate && existing.purchase_date === purchase.purchaseDate;
        return costMatch && dateMatch;
      });

      if (exactMatch) {
        return {
          index: purchase.index,
          isDuplicate: true,
          duplicateType: 'exact' as const,
          existingPurchaseId: exactMatch.id,
          existingPurchaseDescription: exactMatch.short_description,
          reason: `Exact match: same cost (£${purchase.price}) and date (${purchase.purchaseDate})`,
        };
      }

      // Look for likely match: same cost + date within 3 days
      if (purchase.purchaseDate) {
        const purchaseDate = new Date(purchase.purchaseDate);
        const likelyMatch = existingPurchases?.find((existing) => {
          const costMatch = Math.abs(Number(existing.cost) - purchase.price) < 0.01;
          if (!costMatch || !existing.purchase_date) return false;

          const existingDate = new Date(existing.purchase_date);
          const daysDiff = Math.abs(
            (purchaseDate.getTime() - existingDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          return daysDiff <= 3 && daysDiff > 0;
        });

        if (likelyMatch) {
          return {
            index: purchase.index,
            isDuplicate: true,
            duplicateType: 'likely' as const,
            existingPurchaseId: likelyMatch.id,
            existingPurchaseDescription: likelyMatch.short_description,
            reason: `Likely duplicate: same cost (£${purchase.price}), date within 3 days`,
          };
        }
      }

      // Look for possible match: same cost only (no date match)
      const possibleMatch = existingPurchases?.find((existing) => {
        const costMatch = Math.abs(Number(existing.cost) - purchase.price) < 0.01;
        // Only flag if within last 30 days to avoid too many false positives
        if (!costMatch || !existing.purchase_date) return false;

        const existingDate = new Date(existing.purchase_date);
        const daysDiff = Math.abs((Date.now() - existingDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff <= 30;
      });

      if (possibleMatch) {
        return {
          index: purchase.index,
          isDuplicate: false, // Not blocking, just a warning
          duplicateType: 'possible' as const,
          existingPurchaseId: possibleMatch.id,
          existingPurchaseDescription: possibleMatch.short_description,
          reason: `Possible duplicate: same cost (£${purchase.price}) found in recent purchases`,
        };
      }

      // No duplicate found
      return {
        index: purchase.index,
        isDuplicate: false,
        duplicateType: 'none' as const,
      };
    });

    // Count duplicates
    const exactDuplicates = results.filter((r) => r.duplicateType === 'exact').length;
    const likelyDuplicates = results.filter((r) => r.duplicateType === 'likely').length;
    const possibleDuplicates = results.filter((r) => r.duplicateType === 'possible').length;

    console.log(
      `[POST /api/purchases/check-duplicates] Found: ${exactDuplicates} exact, ${likelyDuplicates} likely, ${possibleDuplicates} possible duplicates`
    );

    // 5. Return duplicate check results
    return NextResponse.json(
      {
        data: {
          results,
          summary: {
            total: purchases.length,
            exactDuplicates,
            likelyDuplicates,
            possibleDuplicates,
            clean: purchases.length - exactDuplicates - likelyDuplicates - possibleDuplicates,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[POST /api/purchases/check-duplicates] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check for duplicates. Please try again.' },
      { status: 500 }
    );
  }
}
