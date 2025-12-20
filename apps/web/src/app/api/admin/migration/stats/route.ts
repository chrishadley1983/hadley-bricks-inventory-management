import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google';

/**
 * GET /api/admin/migration/stats
 * Get statistics comparing Google Sheets and Supabase data
 */
export async function GET() {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Google Sheets stats
    const sheetsClient = getSheetsClient();
    const sheets = await sheetsClient.listSheets();

    const newKitSheet = sheets.find((s) => s.title === 'Lego New Kit Inventory');
    const usedKitSheet = sheets.find((s) => s.title === 'Lego Used Kit Inventory');
    const purchasesSheet = sheets.find((s) => s.title === 'Purchases');

    // Get Supabase stats
    const { count: inventoryNewCount } = await supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('condition', 'New');

    const { count: inventoryUsedCount } = await supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('condition', 'Used');

    const { count: purchasesCount } = await supabase
      .from('purchases')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return NextResponse.json({
      sheets: {
        newKitRows: (newKitSheet?.rowCount ?? 1) - 1, // Subtract header
        usedKitRows: (usedKitSheet?.rowCount ?? 1) - 1,
        purchasesRows: (purchasesSheet?.rowCount ?? 1) - 1,
      },
      supabase: {
        inventoryNew: inventoryNewCount ?? 0,
        inventoryUsed: inventoryUsedCount ?? 0,
        purchases: purchasesCount ?? 0,
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/migration/stats] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to get stats', details: message }, { status: 500 });
  }
}
