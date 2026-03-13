/**
 * Auction Scheduler Service
 *
 * Staggers auction end dates to target ~1 auction ending per day.
 * Checks existing scheduled auctions and fills gaps.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';

/**
 * Get a map of dates → count of auctions ending on that date.
 * Looks at approved auction proposals within the next 14 days.
 */
async function getExistingAuctionSchedule(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<Map<string, number>> {
  const today = new Date();
  const twoWeeksOut = new Date(today);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase deep type inference workaround
  const { data } = await (supabase as any)
    .from('markdown_proposals')
    .select('auction_end_date')
    .eq('user_id', userId)
    .eq('proposed_action', 'AUCTION')
    .in('status', ['APPROVED', 'AUTO_APPLIED', 'PENDING'])
    .gte('auction_end_date', today.toISOString().split('T')[0])
    .lte('auction_end_date', twoWeeksOut.toISOString().split('T')[0]);

  const schedule = new Map<string, number>();
  for (const row of data || []) {
    if (row.auction_end_date) {
      const date = row.auction_end_date;
      schedule.set(date, (schedule.get(date) || 0) + 1);
    }
  }
  return schedule;
}

/**
 * Find the best auction end date — the earliest date with the fewest auctions.
 * Respects maxPerDay limit.
 */
function findBestEndDate(
  schedule: Map<string, number>,
  durationDays: number,
  maxPerDay: number
): string {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + durationDays);

  // Try dates from the natural end date outward (up to 7 extra days)
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(startDate);
    candidate.setDate(candidate.getDate() + offset);
    const dateStr = candidate.toISOString().split('T')[0];
    const count = schedule.get(dateStr) || 0;

    if (count < maxPerDay) {
      return dateStr;
    }
  }

  // All days at max — just use the natural end date
  return startDate.toISOString().split('T')[0];
}

/**
 * Assign auction end dates to a batch of auction proposals.
 * Mutates the proposals in-place, setting auction_end_date.
 */
export async function scheduleAuctions(
  supabase: SupabaseClient<Database>,
  userId: string,
  proposals: Array<{ auction_end_date: string | null; auction_duration_days: number | null }>,
  maxPerDay: number
): Promise<void> {
  const schedule = await getExistingAuctionSchedule(supabase, userId);

  for (const proposal of proposals) {
    const duration = proposal.auction_duration_days || 7;
    const endDate = findBestEndDate(schedule, duration, maxPerDay);
    proposal.auction_end_date = endDate;

    // Update schedule for subsequent proposals in this batch
    schedule.set(endDate, (schedule.get(endDate) || 0) + 1);
  }
}

/**
 * Get the number of auctions scheduled for a specific date.
 */
export async function getAuctionCountForDate(
  supabase: SupabaseClient<Database>,
  userId: string,
  date: string
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from('markdown_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('proposed_action', 'AUCTION')
    .in('status', ['APPROVED', 'AUTO_APPLIED', 'PENDING'])
    .eq('auction_end_date', date);

  return count || 0;
}
