/**
 * Import Vinted Purchases API Route
 *
 * POST /api/purchases/import-vinted
 *
 * Creates purchases and inventory items from validated Vinted import data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { deriveInventoryStatusFromVinted } from '@/lib/utils';

// Request validation schema
const InventoryItemSchema = z.object({
  setNumber: z.string().min(1),
  itemName: z.string().min(1),
  condition: z.enum(['New', 'Used']),
  status: z.string().min(1),
  storageLocation: z.string().optional(),
  listingValue: z.number().positive().nullable().optional(),
  amazonAsin: z.string().optional(),
  skipCreation: z.boolean().default(false),
});

const PurchaseToImportSchema = z.object({
  title: z.string().min(1),
  price: z.number().positive(),
  purchaseDate: z.string().nullable(),
  vintedStatus: z.string(),
  inventoryItem: InventoryItemSchema,
});

const RequestSchema = z.object({
  purchases: z.array(PurchaseToImportSchema).min(1).max(50),
});

// Response types
export interface ImportResult {
  purchaseId: string;
  inventoryItemId: string | null;
  title: string;
  success: boolean;
  error?: string;
}

export interface ImportSummary {
  totalPurchases: number;
  successfulPurchases: number;
  failedPurchases: number;
  totalInventoryItems: number;
  skippedInventoryItems: number;
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
      `[POST /api/purchases/import-vinted] Importing ${purchases.length} purchases for user ${user.id}`
    );

    const today = new Date().toISOString().split('T')[0];

    // 3. Batch insert all purchases in a single query
    const purchaseInserts = purchases.map((p) => ({
      user_id: user.id,
      short_description: p.title,
      cost: p.price,
      source: 'Vinted',
      payment_method: 'Monzo Card',
      purchase_date: p.purchaseDate || today,
    }));

    const { data: createdPurchases, error: purchaseError } = await supabase
      .from('purchases')
      .insert(purchaseInserts)
      .select('id');

    if (purchaseError || !createdPurchases) {
      console.error('[POST /api/purchases/import-vinted] Batch purchase insert failed:', purchaseError);
      return NextResponse.json(
        { error: `Failed to create purchases: ${purchaseError?.message}` },
        { status: 500 }
      );
    }

    // 4. Enrich item names from brickset_sets for items missing proper names
    const setNumbersToEnrich = [
      ...new Set(
        purchases
          .filter((p) => !p.inventoryItem.skipCreation)
          .map((p) => p.inventoryItem.setNumber)
          .filter(Boolean)
      ),
    ];

    const bricksetNameMap = new Map<string, string>();
    if (setNumbersToEnrich.length > 0) {
      try {
        const serviceClient = createServiceRoleClient();
        const normalizedNumbers = setNumbersToEnrich.map((n) =>
          n.includes('-') ? n : `${n}-1`
        );

        const { data: bricksetSets } = await serviceClient
          .from('brickset_sets')
          .select('set_number, set_name')
          .in('set_number', normalizedNumbers);

        if (bricksetSets) {
          for (const bs of bricksetSets) {
            // Map both "12345-1" and "12345" to the name
            bricksetNameMap.set(bs.set_number, bs.set_name);
            const baseNumber = bs.set_number.replace(/-\d+$/, '');
            bricksetNameMap.set(baseNumber, bs.set_name);
          }
        }
      } catch (err) {
        console.error('[POST /api/purchases/import-vinted] Brickset enrichment failed (non-fatal):', err);
      }
    }

    // 5. Build inventory items for non-skipped purchases
    const inventoryInserts: Array<{
      purchaseIndex: number;
      data: {
        user_id: string;
        set_number: string;
        item_name: string;
        condition: string;
        status: string;
        storage_location: string | null;
        listing_value: number | null;
        amazon_asin: string | null;
        source: string;
        purchase_date: string;
        cost: number;
        purchase_id: string;
      };
    }> = [];

    purchases.forEach((purchaseData, index) => {
      if (!purchaseData.inventoryItem.skipCreation) {
        const inventoryStatus = deriveInventoryStatusFromVinted(purchaseData.vintedStatus);
        const setNum = purchaseData.inventoryItem.setNumber;
        let itemName = purchaseData.inventoryItem.itemName;

        // If itemName is missing or is just the set number, enrich from brickset
        const looksLikeSetNumber = /^\d+(-\d+)?$/.test(itemName.trim());
        if (!itemName.trim() || looksLikeSetNumber) {
          const bricksetName = bricksetNameMap.get(setNum);
          if (bricksetName) {
            itemName = bricksetName;
          }
        }

        inventoryInserts.push({
          purchaseIndex: index,
          data: {
            user_id: user.id,
            set_number: setNum,
            item_name: itemName,
            condition: purchaseData.inventoryItem.condition,
            status: purchaseData.inventoryItem.status || inventoryStatus,
            storage_location: purchaseData.inventoryItem.storageLocation || null,
            listing_value: purchaseData.inventoryItem.listingValue || null,
            amazon_asin: purchaseData.inventoryItem.amazonAsin || null,
            source: 'Vinted',
            purchase_date: purchaseData.purchaseDate || today,
            cost: purchaseData.price,
            purchase_id: createdPurchases[index].id,
          },
        });
      }
    });

    // 6. Batch insert inventory items if any
    let createdInventoryItems: Array<{ id: string }> = [];
    if (inventoryInserts.length > 0) {
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory_items')
        .insert(inventoryInserts.map((i) => i.data))
        .select('id');

      if (inventoryError) {
        console.error('[POST /api/purchases/import-vinted] Batch inventory insert failed:', inventoryError);
        // Purchases were created, but inventory items failed - continue with partial success
      } else {
        createdInventoryItems = inventoryData || [];
      }
    }

    // 7. Build results mapping
    const results: ImportResult[] = purchases.map((purchaseData, index) => {
      const purchaseId = createdPurchases[index]?.id || '';
      const isSkipped = purchaseData.inventoryItem.skipCreation;

      // Find matching inventory item by purchase index
      const inventoryIndex = inventoryInserts.findIndex((i) => i.purchaseIndex === index);
      const inventoryItemId = inventoryIndex >= 0 && createdInventoryItems[inventoryIndex]
        ? createdInventoryItems[inventoryIndex].id
        : null;

      return {
        purchaseId,
        inventoryItemId: isSkipped ? null : inventoryItemId,
        title: purchaseData.title,
        success: true,
        error: !isSkipped && !inventoryItemId && inventoryInserts.length > 0
          ? 'Inventory item creation failed'
          : undefined,
      };
    });

    // 8. Calculate summary
    const summary: ImportSummary = {
      totalPurchases: purchases.length,
      successfulPurchases: results.filter((r) => r.success).length,
      failedPurchases: results.filter((r) => !r.success).length,
      totalInventoryItems: results.filter((r) => r.inventoryItemId !== null).length,
      skippedInventoryItems: purchases.filter((p) => p.inventoryItem.skipCreation).length,
    };

    console.log(
      `[POST /api/purchases/import-vinted] Import complete: ${summary.successfulPurchases}/${summary.totalPurchases} purchases, ${summary.totalInventoryItems} inventory items`
    );

    // 9. Return results
    return NextResponse.json(
      {
        data: {
          results,
          summary,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[POST /api/purchases/import-vinted] Error:', error);
    return NextResponse.json(
      { error: 'Import failed. Please try again.' },
      { status: 500 }
    );
  }
}
