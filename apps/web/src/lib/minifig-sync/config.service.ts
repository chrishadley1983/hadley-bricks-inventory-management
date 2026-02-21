import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import type { MinifigSyncConfig } from './types';

const CONFIG_KEYS: (keyof MinifigSyncConfig)[] = [
  'min_bricqer_listing_price',
  'min_sold_count',
  'min_sell_through_rate',
  'min_avg_sold_price',
  'min_estimated_profit',
  'packaging_cost',
  'ebay_fvf_rate',
  'price_cache_months',
  'reprice_after_days',
  'poll_interval_minutes',
];

export class MinifigConfigService {
  constructor(private supabase: SupabaseClient<Database>) {}

  async getConfig(): Promise<MinifigSyncConfig> {
    const { data, error } = await this.supabase.from('minifig_sync_config').select('key, value');

    if (error) {
      throw new Error(`Failed to load minifig sync config: ${error.message}`);
    }

    const config = {} as Record<string, number>;
    for (const row of data ?? []) {
      const val = row.value;
      config[row.key] = typeof val === 'number' ? val : Number(val);
    }

    // Validate all keys present
    for (const key of CONFIG_KEYS) {
      if (config[key] === undefined || isNaN(config[key])) {
        throw new Error(`Missing or invalid config key: ${key}`);
      }
    }

    return config as unknown as MinifigSyncConfig;
  }

  async updateConfig(key: keyof MinifigSyncConfig, value: number): Promise<void> {
    const { error } = await this.supabase
      .from('minifig_sync_config')
      .update({
        value:
          value as unknown as Database['public']['Tables']['minifig_sync_config']['Update']['value'],
        updated_at: new Date().toISOString(),
      })
      .eq('key', key);

    if (error) {
      throw new Error(`Failed to update config key ${key}: ${error.message}`);
    }
  }
}
