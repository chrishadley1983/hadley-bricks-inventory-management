/**
 * GET /api/ebay-auctions/status
 *
 * Get current status of the eBay Auction Sniper including
 * config, last scan info, and today's statistics.
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { EbayAuctionScannerService } from '@/lib/ebay-auctions';

const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    const scanner = new EbayAuctionScannerService(supabase);

    // Load config
    const config = await scanner.loadConfig(DEFAULT_USER_ID);
    if (!config) {
      return NextResponse.json({ error: 'No config found' }, { status: 404 });
    }

    // Get last scan
    const { data: lastScan } = await supabase
      .from('ebay_auction_scan_log')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Get today's stats
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: todayScans } = await supabase
      .from('ebay_auction_scan_log')
      .select('opportunities_found, alerts_sent, joblots_found')
      .eq('user_id', DEFAULT_USER_ID)
      .gte('created_at', todayStart.toISOString());

    const todayStats = {
      scansRun: todayScans?.length || 0,
      opportunitiesFound: todayScans?.reduce((sum, s) => sum + (s.opportunities_found || 0), 0) || 0,
      alertsSent: todayScans?.reduce((sum, s) => sum + (s.alerts_sent || 0), 0) || 0,
      joblotsFound: todayScans?.reduce((sum, s) => sum + (s.joblots_found || 0), 0) || 0,
    };

    // Get recent scan logs (last 20)
    const { data: recentScans } = await supabase
      .from('ebay_auction_scan_log')
      .select('*')
      .eq('user_id', DEFAULT_USER_ID)
      .order('created_at', { ascending: false })
      .limit(20);

    return NextResponse.json({
      config,
      lastScan: lastScan || null,
      todayStats,
      recentScans: recentScans || [],
      isInQuietHours: scanner.isInQuietHours(config),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
