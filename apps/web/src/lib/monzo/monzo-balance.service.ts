/**
 * Monzo Balance Service
 *
 * Records a daily balance snapshot after the Monzo transaction sync and
 * raises a Discord alert when the balance crosses below the low-balance
 * threshold.
 *
 * Balance sources, in preference order:
 * 1. 'api'      — live Monzo /balance + /pots (only when an OAuth connection
 *                 exists in monzo_credentials; includes pot balances)
 * 2. 'computed' — signed sum of the synced transaction ledger. This is a true
 *                 main-account balance because our history is complete from
 *                 account opening (Apr 2024), but money held in pots is
 *                 invisible to it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { createClient } from '@/lib/supabase/server';
import { discordService } from '@/lib/notifications/discord.service';
import { monzoAuthService } from './monzo-auth.service';

const MONZO_API_URL = 'https://api.monzo.com';

/** Threshold in pence below which a low-balance alert fires (default £1,000) */
export const LOW_BALANCE_THRESHOLD_PENCE =
  Math.round(Number(process.env.MONZO_LOW_BALANCE_THRESHOLD_GBP || '1000') * 100);

export interface BalanceSnapshotResult {
  balancePence: number;
  source: 'computed' | 'api';
  potTotalPence: number | null;
  latestTransactionAt: string | null;
  alerted: boolean;
}

interface MonzoPot {
  id: string;
  name: string;
  balance: number;
  deleted: boolean;
}

/**
 * Alert only when the balance crosses below the threshold (or on the first
 * ever snapshot if already below) — not on every daily run while it stays low.
 */
export function shouldSendLowBalanceAlert(
  balancePence: number,
  previousBalancePence: number | null,
  thresholdPence: number = LOW_BALANCE_THRESHOLD_PENCE
): boolean {
  if (balancePence >= thresholdPence) return false;
  if (previousBalancePence === null) return true;
  return previousBalancePence >= thresholdPence;
}

export class MonzoBalanceService {
  /**
   * @param supabaseOverride Cron routes should pass a service-role client so
   * RLS-gated reads/writes succeed without a Supabase user session.
   */
  constructor(private readonly supabaseOverride?: SupabaseClient<Database>) {}

  private async getSupabase(): Promise<SupabaseClient<Database>> {
    return this.supabaseOverride ?? (await createClient());
  }

  /**
   * Record today's balance snapshot and send a low-balance alert if the
   * balance has crossed below the threshold.
   */
  async recordDailySnapshot(userId: string): Promise<BalanceSnapshotResult> {
    const supabase = await this.getSupabase();

    const live = await this.tryFetchApiBalance(userId);
    let balancePence: number;
    let source: 'computed' | 'api';
    let potTotalPence: number | null = null;
    let pots: MonzoPot[] | null = null;
    let transactionCount: number | null = null;
    let latestTransactionAt: string | null = null;

    if (live) {
      balancePence = live.balancePence;
      potTotalPence = live.potTotalPence;
      pots = live.pots;
      source = 'api';
    } else {
      const { data, error } = await supabase.rpc('monzo_computed_balance', {
        p_user_id: userId,
      });
      if (error) {
        throw new Error(`Failed to compute Monzo balance: ${error.message}`);
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error('monzo_computed_balance returned no rows');
      }
      balancePence = Number(row.balance_pence);
      transactionCount = Number(row.transaction_count);
      latestTransactionAt = row.latest_transaction_at;
      source = 'computed';
    }

    // Previous snapshot (before today) decides whether this is a new crossing
    const today = new Date().toISOString().split('T')[0];
    const { data: previous } = await supabase
      .from('monzo_balance_snapshots')
      .select('balance_pence')
      .eq('user_id', userId)
      .lt('snapshot_date', today)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const previousBalance = previous ? Number(previous.balance_pence) : null;
    const alerted = shouldSendLowBalanceAlert(balancePence, previousBalance);

    const { error: upsertError } = await supabase.from('monzo_balance_snapshots').upsert(
      {
        user_id: userId,
        snapshot_date: today,
        balance_pence: balancePence,
        source,
        pot_total_pence: potTotalPence,
        pots: pots ? JSON.parse(JSON.stringify(pots)) : null,
        transaction_count: transactionCount,
        latest_transaction_at: latestTransactionAt,
        low_balance_alerted: alerted,
      },
      { onConflict: 'user_id,snapshot_date' }
    );
    if (upsertError) {
      throw new Error(`Failed to save balance snapshot: ${upsertError.message}`);
    }

    if (alerted) {
      const balanceGbp = (balancePence / 100).toFixed(2);
      const thresholdGbp = (LOW_BALANCE_THRESHOLD_PENCE / 100).toFixed(0);
      const sourceNote =
        source === 'computed'
          ? '\nSource: computed from transaction ledger (main account only — excludes pots)'
          : '';
      await discordService.sendAlert({
        title: '⚠️ Monzo balance below £' + thresholdGbp,
        message: `Business account balance is **£${balanceGbp}**.${sourceNote}\nWill re-alert only after the balance recovers above £${thresholdGbp} and dips again.`,
        priority: 'high',
      });
    }

    return { balancePence, source, potTotalPence, latestTransactionAt, alerted };
  }

  /**
   * Live balance + pots from the Monzo API. Returns null when no valid OAuth
   * connection exists (monzo_credentials empty or token expired) so callers
   * fall back to the computed ledger balance.
   */
  private async tryFetchApiBalance(
    userId: string
  ): Promise<{ balancePence: number; potTotalPence: number; pots: MonzoPot[] } | null> {
    try {
      const accessToken = await monzoAuthService.getAccessToken(userId);
      const accountId = await monzoAuthService.getAccountId(userId);
      if (!accessToken || !accountId) return null;

      const headers = { Authorization: `Bearer ${accessToken}` };
      const [balanceRes, potsRes] = await Promise.all([
        fetch(`${MONZO_API_URL}/balance?account_id=${accountId}`, { headers }),
        fetch(`${MONZO_API_URL}/pots?current_account_id=${accountId}`, { headers }),
      ]);
      if (!balanceRes.ok) {
        console.warn(`[MonzoBalanceService] /balance failed: ${balanceRes.status}`);
        return null;
      }

      const balance = await balanceRes.json();
      let pots: MonzoPot[] = [];
      if (potsRes.ok) {
        const potsData = await potsRes.json();
        pots = ((potsData.pots || []) as MonzoPot[]).filter((p) => !p.deleted);
      }

      return {
        balancePence: balance.balance,
        potTotalPence: pots.reduce((sum, p) => sum + p.balance, 0),
        pots,
      };
    } catch (error) {
      console.warn('[MonzoBalanceService] Live balance fetch failed:', error);
      return null;
    }
  }
}
