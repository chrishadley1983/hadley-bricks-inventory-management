import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { startOfWeek, endOfWeek, subDays, format } from 'date-fns';

/**
 * GET /api/workflow/metrics
 * Get weekly metrics for the targets panel
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

    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

    // Get workflow config for targets
    const { data: config } = await supabase
      .from('workflow_config')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const targets = {
      ebayListings: config?.target_ebay_listings ?? 735,
      amazonListings: config?.target_amazon_listings ?? 1050,
      bricklinkWeeklyValue: config?.target_bricklink_weekly_value ?? 1000,
      dailyListedValue: config?.target_daily_listed_value ?? 300,
      dailySoldValue: config?.target_daily_sold_value ?? 250,
    };

    // Get weekly listing counts by platform (items listed this week)
    // Note: status values in DB are uppercase (LISTED, SOLD, BACKLOG)
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

    const [ebayResult, amazonResult, bricklinkResult, brickowlResult] = await Promise.all([
      // eBay: query listing VALUE (sum) instead of count
      supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('user_id', user.id)
        .eq('listing_platform', 'ebay')
        .gte('listing_date', weekStartStr)
        .lte('listing_date', weekEndStr),
      // Amazon: query listing VALUE (sum) instead of count
      supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('user_id', user.id)
        .eq('listing_platform', 'amazon')
        .gte('listing_date', weekStartStr)
        .lte('listing_date', weekEndStr),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'bricklink')
        .gte('listing_date', weekStartStr)
        .lte('listing_date', weekEndStr),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'brickowl')
        .gte('listing_date', weekStartStr)
        .lte('listing_date', weekEndStr),
    ]);

    const listingCounts = {
      ebay: ebayResult.data?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0,
      amazon: amazonResult.data?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0,
      bricklink: bricklinkResult.count ?? 0,
      brickowl: brickowlResult.count ?? 0,
    };

    // Get daily listing counts by platform (items listed today)
    const [ebayDailyResult, amazonDailyResult, bricklinkDailyResult, brickowlDailyResult] =
      await Promise.all([
        // eBay: query listing VALUE (sum) instead of count
        supabase
          .from('inventory_items')
          .select('listing_value')
          .eq('user_id', user.id)
          .eq('listing_platform', 'ebay')
          .eq('listing_date', todayStr),
        // Amazon: query listing VALUE (sum) instead of count
        supabase
          .from('inventory_items')
          .select('listing_value')
          .eq('user_id', user.id)
          .eq('listing_platform', 'amazon')
          .eq('listing_date', todayStr),
        supabase
          .from('inventory_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('listing_platform', 'bricklink')
          .eq('listing_date', todayStr),
        supabase
          .from('inventory_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('listing_platform', 'brickowl')
          .eq('listing_date', todayStr),
      ]);

    const dailyListingCounts = {
      ebay: ebayDailyResult.data?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0,
      amazon:
        amazonDailyResult.data?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0,
      bricklink: bricklinkDailyResult.count ?? 0,
      brickowl: brickowlDailyResult.count ?? 0,
    };

    // Get week totals from platform_orders + ebay_orders
    const { data: weekOrders } = await supabase
      .from('platform_orders')
      .select('total, platform')
      .eq('user_id', user.id)
      .gte('order_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('order_date', format(weekEnd, 'yyyy-MM-dd'));

    const { data: weekEbayOrders } = await supabase
      .from('ebay_orders')
      .select('total_fee_basis_amount')
      .eq('user_id', user.id)
      .gte('creation_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('creation_date', format(weekEnd, 'yyyy-MM-dd'));

    const weekSoldValue =
      (weekOrders?.reduce((sum, order) => sum + (order.total || 0), 0) ?? 0) +
      (weekEbayOrders?.reduce((sum, order) => sum + (order.total_fee_basis_amount || 0), 0) ?? 0);
    const weekSoldCount = (weekOrders?.length ?? 0) + (weekEbayOrders?.length ?? 0);

    // Get today's sold value (order_date is a timestamp, so use range query)
    const tomorrowStr = format(new Date(today.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    const { data: todayOrders } = await supabase
      .from('platform_orders')
      .select('total')
      .eq('user_id', user.id)
      .gte('order_date', todayStr)
      .lt('order_date', tomorrowStr);

    const { data: todayEbayOrders } = await supabase
      .from('ebay_orders')
      .select('total_fee_basis_amount')
      .eq('user_id', user.id)
      .gte('creation_date', todayStr)
      .lt('creation_date', tomorrowStr);

    const todaySoldValue =
      (todayOrders?.reduce((sum, order) => sum + (order.total || 0), 0) ?? 0) +
      (todayEbayOrders?.reduce((sum, order) => sum + (order.total_fee_basis_amount || 0), 0) ?? 0);

    // Get BrickLink weekly value (from inventory items listed this week on BrickLink)
    const { data: bricklinkWeekItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .eq('listing_platform', 'bricklink')
      .gte('listing_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('listing_date', format(weekEnd, 'yyyy-MM-dd'));

    // Also include BrickLink uploads (batch uploads tracked in bricklink_uploads table)
    const { data: bricklinkWeekUploads } = await supabase
      .from('bricklink_uploads')
      .select('selling_price')
      .eq('user_id', user.id)
      .gte('upload_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('upload_date', format(weekEnd, 'yyyy-MM-dd'));

    const bricklinkWeeklyValue =
      (bricklinkWeekItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0) +
      (bricklinkWeekUploads?.reduce((sum, u) => sum + (u.selling_price || 0), 0) ?? 0);

    // Get daily listed value (items listed today + BrickLink uploads today)
    const { data: todayListedItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .eq('listing_date', todayStr);

    const { data: todayBricklinkUploads } = await supabase
      .from('bricklink_uploads')
      .select('selling_price')
      .eq('user_id', user.id)
      .eq('upload_date', todayStr);

    const todayListedValue =
      (todayListedItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0) +
      (todayBricklinkUploads?.reduce((sum, u) => sum + (u.selling_price || 0), 0) ?? 0);

    // Get today's BrickLink value (inventory items listed today on BrickLink + uploads today)
    const { data: todayBricklinkItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .eq('listing_platform', 'bricklink')
      .eq('listing_date', todayStr);

    const todayBricklinkValue =
      (todayBricklinkItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0) +
      (todayBricklinkUploads?.reduce((sum, u) => sum + (u.selling_price || 0), 0) ?? 0);

    // Get week listed totals (inventory items + BrickLink uploads)
    const { data: weekListedItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .gte('listing_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('listing_date', format(weekEnd, 'yyyy-MM-dd'));

    const weekListedValue =
      (weekListedItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0) +
      (bricklinkWeekUploads?.reduce((sum, u) => sum + (u.selling_price || 0), 0) ?? 0);
    const weekListedCount = (weekListedItems?.length ?? 0) + (bricklinkWeekUploads?.length ?? 0);

    // Get 7-day history for sparklines
    const history = {
      dailyListedValue: [] as number[],
      dailySoldValue: [] as number[],
      bricklinkWeeklyValue: [] as number[],
    };

    for (let i = 6; i >= 0; i--) {
      const date = subDays(today, i);
      const dateStr = format(date, 'yyyy-MM-dd');

      // Listed value for the day (inventory items + BrickLink uploads)
      const { data: dayListedItems } = await supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('user_id', user.id)
        .eq('listing_date', dateStr);

      const { data: dayBricklinkUploads } = await supabase
        .from('bricklink_uploads')
        .select('selling_price')
        .eq('user_id', user.id)
        .eq('upload_date', dateStr);

      history.dailyListedValue.push(
        (dayListedItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0) +
          (dayBricklinkUploads?.reduce((sum, u) => sum + (u.selling_price || 0), 0) ?? 0)
      );

      // Sold value for the day (platform_orders + ebay_orders)
      const nextDateStr = format(new Date(date.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      const { data: dayOrders } = await supabase
        .from('platform_orders')
        .select('total')
        .eq('user_id', user.id)
        .gte('order_date', dateStr)
        .lt('order_date', nextDateStr);

      const { data: dayEbayOrders } = await supabase
        .from('ebay_orders')
        .select('total_fee_basis_amount')
        .eq('user_id', user.id)
        .gte('creation_date', dateStr)
        .lt('creation_date', nextDateStr);

      history.dailySoldValue.push(
        (dayOrders?.reduce((sum, order) => sum + (order.total || 0), 0) ?? 0) +
          (dayEbayOrders?.reduce((sum, order) => sum + (order.total_fee_basis_amount || 0), 0) ?? 0)
      );

      // BrickLink value for the day (inventory items + uploads)
      const { data: dayBricklinkItems } = await supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('user_id', user.id)
        .eq('listing_platform', 'bricklink')
        .eq('listing_date', dateStr);

      history.bricklinkWeeklyValue.push(
        (dayBricklinkItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0) +
          (dayBricklinkUploads?.reduce((sum, u) => sum + (u.selling_price || 0), 0) ?? 0)
      );
    }

    return NextResponse.json({
      listingCounts,
      dailyListingCounts,
      bricklinkWeeklyValue: {
        current: bricklinkWeeklyValue,
        daily: todayBricklinkValue,
        target: targets.bricklinkWeeklyValue,
        history: history.bricklinkWeeklyValue,
      },
      dailyListedValue: {
        current: todayListedValue,
        target: targets.dailyListedValue,
        history: history.dailyListedValue,
      },
      dailySoldValue: {
        current: todaySoldValue,
        target: targets.dailySoldValue,
        history: history.dailySoldValue,
      },
      weekTotals: {
        listedValue: weekListedValue,
        soldValue: weekSoldValue,
        listedCount: weekListedCount,
        soldCount: weekSoldCount,
      },
      targets,
    });
  } catch (error) {
    console.error('[GET /api/workflow/metrics] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
