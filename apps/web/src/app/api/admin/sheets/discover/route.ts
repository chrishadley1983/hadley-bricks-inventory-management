import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSheetsClient } from '@/lib/google';

/**
 * GET /api/admin/sheets/discover
 * Discovers the structure of all sheets in the connected Google Spreadsheet
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check - only authenticated users can access
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Optional query param to limit sample rows
    const searchParams = request.nextUrl.searchParams;
    const sampleRows = parseInt(searchParams.get('sampleRows') || '5', 10);

    // Test connection first
    const sheetsClient = getSheetsClient();
    const connectionTest = await sheetsClient.testConnection();

    if (!connectionTest.success) {
      return NextResponse.json(
        {
          error: 'Failed to connect to Google Sheets',
          details: connectionTest.message,
        },
        { status: 500 }
      );
    }

    // Discover full structure
    const structure = await sheetsClient.discoverSpreadsheetStructure(sampleRows);

    return NextResponse.json({
      data: structure,
      message: `Discovered ${structure.sheets.length} sheets in "${structure.title}"`,
    });
  } catch (error) {
    console.error('[GET /api/admin/sheets/discover] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to discover sheet structure', details: message },
      { status: 500 }
    );
  }
}
