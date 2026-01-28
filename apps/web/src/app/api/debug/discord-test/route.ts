import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { discordService, DiscordColors } from '@/lib/notifications';
import type { DiscordChannel } from '@/lib/notifications';

/**
 * GET /api/debug/discord-test
 * Send test notifications to all configured Discord channels
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

    if (!discordService.isEnabled()) {
      return NextResponse.json({
        error: 'Discord not configured',
        details: 'No Discord webhook URLs configured. Set DISCORD_WEBHOOK_* environment variables.',
      }, { status: 400 });
    }

    const results: Record<DiscordChannel, { sent: boolean; error?: string }> = {
      alerts: { sent: false },
      opportunities: { sent: false },
      'sync-status': { sent: false },
      'daily-summary': { sent: false },
    };

    // Test #alerts channel
    if (discordService.isChannelEnabled('alerts')) {
      const result = await discordService.send('alerts', {
        title: '🧪 Test Alert',
        description: 'This is a test alert from Hadley Bricks.\n\nIf you see this, the #alerts channel is working!',
        color: DiscordColors.RED,
        fields: [
          { name: 'Test Field', value: 'Test Value', inline: true },
          { name: 'Priority', value: 'Test', inline: true },
        ],
      });
      results.alerts = { sent: result.success, error: result.error };
    }

    // Test #opportunities channel
    if (discordService.isChannelEnabled('opportunities')) {
      const result = await discordService.send('opportunities', {
        title: '🎯 Test Opportunity: 75192 Millennium Falcon',
        description: 'This is a test opportunity notification.',
        color: DiscordColors.GREEN,
        fields: [
          { name: 'Vinted Price', value: '£450.00', inline: true },
          { name: 'Amazon Price', value: '£699.99', inline: true },
          { name: 'COG%', value: '25%', inline: true },
          { name: 'Profit', value: '£180.00', inline: true },
        ],
      });
      results.opportunities = { sent: result.success, error: result.error };
    }

    // Test #sync-status channel
    if (discordService.isChannelEnabled('sync-status')) {
      const result = await discordService.send('sync-status', {
        title: '🔄 Test Sync Status',
        description: 'This is a test sync status notification.\n\nSync operations will appear here.',
        color: DiscordColors.BLUE,
      });
      results['sync-status'] = { sent: result.success, error: result.error };
    }

    // Test #daily-summary channel
    if (discordService.isChannelEnabled('daily-summary')) {
      const result = await discordService.send('daily-summary', {
        title: '📊 Test Daily Summary',
        color: DiscordColors.BLUE,
        fields: [
          { name: 'Broad Sweeps', value: '5', inline: true },
          { name: 'Watchlist Scans', value: '12', inline: true },
          { name: 'Opportunities', value: '3', inline: true },
          { name: 'Near Misses', value: '7', inline: true },
        ],
      });
      results['daily-summary'] = { sent: result.success, error: result.error };
    }

    const successCount = Object.values(results).filter((r) => r.sent).length;
    const configuredCount = Object.values(results).filter(
      (_, i) => discordService.isChannelEnabled(Object.keys(results)[i] as DiscordChannel)
    ).length;

    return NextResponse.json({
      success: successCount > 0,
      message: `Sent ${successCount}/${configuredCount} test notifications`,
      results,
      configuredChannels: (Object.keys(results) as DiscordChannel[]).filter((c) =>
        discordService.isChannelEnabled(c)
      ),
    });
  } catch (error) {
    console.error('[GET /api/debug/discord-test] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
