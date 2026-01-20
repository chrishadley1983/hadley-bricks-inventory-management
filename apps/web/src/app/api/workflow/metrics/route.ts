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
      ebayListings: config?.target_ebay_listings ?? 500,
      amazonListings: config?.target_amazon_listings ?? 250,
      bricklinkWeeklyValue: config?.target_bricklink_weekly_value ?? 1000,
      dailyListedValue: config?.target_daily_listed_value ?? 300,
      dailySoldValue: config?.target_daily_sold_value ?? 250,
    };

    // Get active listing counts by platform using listing_platform field
    const [ebayResult, amazonResult, bricklinkResult, brickowlResult] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'ebay')
        .eq('status', 'Listed'),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'amazon')
        .eq('status', 'Listed'),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'bricklink')
        .eq('status', 'Listed'),
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('listing_platform', 'brickowl')
        .eq('status', 'Listed'),
    ]);

    const listingCounts = {
      ebay: ebayResult.count ?? 0,
      amazon: amazonResult.count ?? 0,
      bricklink: bricklinkResult.count ?? 0,
      brickowl: brickowlResult.count ?? 0,
    };

    // Get week totals from platform_orders
    const { data: weekOrders } = await supabase
      .from('platform_orders')
      .select('total, platform')
      .eq('user_id', user.id)
      .gte('order_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('order_date', format(weekEnd, 'yyyy-MM-dd'));

    const weekSoldValue = weekOrders?.reduce((sum, order) => sum + (order.total || 0), 0) ?? 0;
    const weekSoldCount = weekOrders?.length ?? 0;

    // Get today's sold value (order_date is a timestamp, so use range query)
    const tomorrowStr = format(new Date(today.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    const { data: todayOrders } = await supabase
      .from('platform_orders')
      .select('total')
      .eq('user_id', user.id)
      .gte('order_date', todayStr)
      .lt('order_date', tomorrowStr);

    const todaySoldValue = todayOrders?.reduce((sum, order) => sum + (order.total || 0), 0) ?? 0;

    // Get BrickLink weekly value (from inventory items listed this week on BrickLink)
    const { data: bricklinkWeekItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .eq('listing_platform', 'bricklink')
      .gte('listing_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('listing_date', format(weekEnd, 'yyyy-MM-dd'));

    const bricklinkWeeklyValue =
      bricklinkWeekItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0;

    // Get daily listed value (items listed today)
    const { data: todayListedItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .eq('listing_date', todayStr);

    const todayListedValue =
      todayListedItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0;

    // Get week listed totals
    const { data: weekListedItems } = await supabase
      .from('inventory_items')
      .select('listing_value')
      .eq('user_id', user.id)
      .gte('listing_date', format(weekStart, 'yyyy-MM-dd'))
      .lte('listing_date', format(weekEnd, 'yyyy-MM-dd'));

    const weekListedValue =
      weekListedItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0;
    const weekListedCount = weekListedItems?.length ?? 0;

    // Get 7-day history for sparklines
    const history = {
      dailyListedValue: [] as number[],
      dailySoldValue: [] as number[],
      bricklinkWeeklyValue: [] as number[],
    };

    for (let i = 6; i >= 0; i--) {
      const date = subDays(today, i);
      const dateStr = format(date, 'yyyy-MM-dd');

      // Listed value for the day
      const { data: dayListedItems } = await supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('user_id', user.id)
        .eq('listing_date', dateStr);

      history.dailyListedValue.push(
        dayListedItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0
      );

      // Sold value for the day (order_date is a timestamp, so use range query)
      const nextDateStr = format(new Date(date.getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      const { data: dayOrders } = await supabase
        .from('platform_orders')
        .select('total')
        .eq('user_id', user.id)
        .gte('order_date', dateStr)
        .lt('order_date', nextDateStr);

      history.dailySoldValue.push(dayOrders?.reduce((sum, order) => sum + (order.total || 0), 0) ?? 0);

      // BrickLink value for the day
      const { data: dayBricklinkItems } = await supabase
        .from('inventory_items')
        .select('listing_value')
        .eq('user_id', user.id)
        .eq('listing_platform', 'bricklink')
        .eq('listing_date', dateStr);

      history.bricklinkWeeklyValue.push(
        dayBricklinkItems?.reduce((sum, item) => sum + (item.listing_value || 0), 0) ?? 0
      );
    }

    return NextResponse.json({
      listingCounts,
      bricklinkWeeklyValue: {
        current: bricklinkWeeklyValue,
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
