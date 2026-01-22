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

    // 4. Build inventory items for non-skipped purchases
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
        inventoryInserts.push({
          purchaseIndex: index,
          data: {
            user_id: user.id,
            set_number: purchaseData.inventoryItem.setNumber,
            item_name: purchaseData.inventoryItem.itemName,
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

    // 5. Batch insert inventory items if any
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

    // 6. Build results mapping
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

    // 4. Calculate summary
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

    // 5. Return results
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
