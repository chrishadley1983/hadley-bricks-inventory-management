/**
 * Match Monzo Transactions API Route
 *
 * POST /api/purchases/match-monzo
 *
 * Matches Vinted purchase prices to Monzo transactions to determine purchase dates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Request validation schema
const PurchaseToMatchSchema = z.object({
  index: z.number(),
  price: z.number().positive(),
  title: z.string(),
});

const RequestSchema = z.object({
  purchases: z.array(PurchaseToMatchSchema).min(1).max(50),
});

// Response types
export interface MonzoMatchResult {
  index: number;
  purchaseDate: string | null;
  monzoTransactionId: string | null;
  matchConfidence: 'exact' | 'likely' | 'none';
  transactionDescription?: string;
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
      `[POST /api/purchases/match-monzo] Matching ${purchases.length} purchases for user ${user.id}`
    );

    // 3. Query Monzo transactions for Vinted payments within last 90 days
    // Vinted transactions appear with merchant_name or description containing "Vinted"
    const { data: monzoTransactions, error: queryError } = await supabase
      .from('monzo_transactions')
      .select('id, created, amount, description, merchant_name')
      .eq('user_id', user.id)
      .or('merchant_name.ilike.%vinted%,description.ilike.%vinted%')
      .gte('created', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('created', { ascending: false });

    if (queryError) {
      console.error('[POST /api/purchases/match-monzo] Query error:', queryError);
      return NextResponse.json({ error: 'Failed to query transactions' }, { status: 500 });
    }

    console.log(
      `[POST /api/purchases/match-monzo] Found ${monzoTransactions?.length || 0} Vinted transactions in Monzo`
    );

    // 4. Match each purchase to a Monzo transaction
    const results: MonzoMatchResult[] = purchases.map((purchase) => {
      const priceInPence = Math.round(purchase.price * 100);

      // Find matching transaction (amount is negative for expenses in Monzo)
      // Vinted prices match the expense amount (negative)
      const matchingTransaction = monzoTransactions?.find((tx) => {
        const txAmount = Math.abs(tx.amount);
        return txAmount === priceInPence;
      });

      if (matchingTransaction) {
        // Extract date from the transaction
        const transactionDate = new Date(matchingTransaction.created);
        const purchaseDate = transactionDate.toISOString().split('T')[0];

        return {
          index: purchase.index,
          purchaseDate,
          monzoTransactionId: matchingTransaction.id,
          matchConfidence: 'exact' as const,
          transactionDescription:
            matchingTransaction.merchant_name || matchingTransaction.description || undefined,
        };
      }

      // No match found
      return {
        index: purchase.index,
        purchaseDate: null,
        monzoTransactionId: null,
        matchConfidence: 'none' as const,
      };
    });

    // Count matches
    const exactMatches = results.filter((r) => r.matchConfidence === 'exact').length;
    console.log(
      `[POST /api/purchases/match-monzo] Matched ${exactMatches}/${purchases.length} purchases`
    );

    // 5. Return match results
    return NextResponse.json(
      {
        data: {
          matches: results,
          summary: {
            total: purchases.length,
            matched: exactMatches,
            unmatched: purchases.length - exactMatches,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[POST /api/purchases/match-monzo] Error:', error);
    return NextResponse.json(
      { error: 'Failed to match transactions. Please try again.' },
      { status: 500 }
    );
  }
}
