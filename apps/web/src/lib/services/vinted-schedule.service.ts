/**
 * Vinted Schedule Service
 *
 * Generates daily scan schedules for the Windows tray application.
 * Uses seeded random for reproducibility - same date + same watchlist = same schedule.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@hadley-bricks/database';
import { createSeededRandom, createDailySeed } from '@/lib/utils/seeded-random';

/**
 * Schedule response returned by the API
 */
export interface ScheduleResponse {
  date: string;
  generatedAt: string;
  scheduleVersion: number;
  operatingHours: {
    start: string;
    end: string;
  };
  scans: ScheduledScan[];
}

/**
 * Individual scheduled scan
 */
export interface ScheduledScan {
  id: string;
  scheduledTime: string;
  type: 'broad_sweep' | 'watchlist';
  setNumber?: string;
  setName?: string;
}

/**
 * Watchlist item from database
 */
interface WatchlistItem {
  set_number: string;
  asin: string | null;
  source: 'best_seller' | 'popular_retired';
}

/**
 * Scanner config from database
 */
interface ScannerConfig {
  operating_hours_start: string;
  operating_hours_end: string;
  schedule_version: number;
  regenerated_seed: string | null;
  regenerated_at: string | null;
  // DataDome hardening fields
  daily_nonce: string | null;
  daily_nonce_date: string | null;
  start_variance_mins: number;
  end_variance_mins: number;
  recovery_mode: boolean;
  recovery_rate_percent: number;
}

/**
 * Service for generating Vinted scan schedules
 */
export class VintedScheduleService {
  private readonly SALT = 'hadley-vinted-schedule-v2';
  private readonly BROAD_SWEEP_COUNT = 16; // One per hour, 06:00-22:00
  private readonly MIN_WATCHLIST_GAP_MINS = 2;
  private readonly MAX_WATCHLIST_GAP_MINS = 8;
  private readonly MIN_BROAD_WATCHLIST_GAP_MINS = 5;

  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Generate schedule for a specific date
   *
   * @param userId - User ID to generate schedule for
   * @param date - Date to generate schedule for (defaults to today)
   * @returns Complete schedule response
   */
  async generateSchedule(userId: string, date?: Date): Promise<ScheduleResponse> {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];
    const isToday = dateStr === new Date().toISOString().split('T')[0];

    // Fetch config and watchlist
    const [config, watchlist] = await Promise.all([
      this.getConfig(userId),
      this.getWatchlist(userId),
    ]);

    if (!config) {
      throw new Error('Scanner config not found. Please configure the scanner first.');
    }

    // Check if there's a valid regenerated seed for today
    // If so, use the regenerated schedule instead of the default
    if (isToday && this.isRegeneratedSeedValidForToday(config)) {
      console.log('[VintedScheduleService] Using regenerated schedule for today');
      return this.generateFromStoredSeed(userId, config, watchlist, dateStr);
    }

    // Get or create daily nonce for anti-fingerprinting
    const nonce = await this.getOrCreateDailyNonce(userId, config, dateStr);

    // Create seeded random generator with nonce for unpredictability
    const seed = createDailySeed(targetDate, this.SALT + userId + nonce);
    const rng = createSeededRandom(seed);

    // Parse operating hours and apply daily variance
    const baseStartHour = this.parseTimeToHour(config.operating_hours_start);
    const baseEndHour = this.parseTimeToHour(config.operating_hours_end);

    // Add random variance to start/end times (anti-pattern detection)
    const startVarianceMins = rng.nextInt(0, config.start_variance_mins);
    const endVarianceMins = rng.nextInt(0, config.end_variance_mins);

    const actualStartMins = baseStartHour * 60 + startVarianceMins;
    const actualEndMins = baseEndHour * 60 - endVarianceMins;

    const startHour = Math.floor(actualStartMins / 60);
    const endHour = Math.floor(actualEndMins / 60);
    const operatingHoursCount = endHour - startHour;

    // Generate broad sweep slots
    const broadSweepScans = this.generateBroadSweepScans(
      startHour,
      operatingHoursCount,
      rng,
      dateStr
    );

    // Generate watchlist scans
    const watchlistScans = this.generateWatchlistScans(
      watchlist,
      broadSweepScans,
      startHour,
      endHour,
      rng,
      dateStr
    );

    // Combine and sort all scans
    let allScans = [...broadSweepScans, ...watchlistScans].sort((a, b) =>
      a.scheduledTime.localeCompare(b.scheduledTime)
    );

    // Apply recovery rate filtering if in recovery mode
    if (config.recovery_mode && config.recovery_rate_percent < 100) {
      const keepRatio = config.recovery_rate_percent / 100;
      // Always keep broad sweeps, filter watchlist scans based on rate
      allScans = allScans.filter((scan) => {
        if (scan.type === 'broad_sweep') return true;
        return rng.next() < keepRatio;
      });
      console.log(
        `[VintedScheduleService] Recovery mode at ${config.recovery_rate_percent}%: ${allScans.length} scans after filtering`
      );
    }

    // Format actual operating hours with variance applied
    const actualStartTime = `${startHour.toString().padStart(2, '0')}:${(actualStartMins % 60).toString().padStart(2, '0')}`;
    const actualEndTime = `${endHour.toString().padStart(2, '0')}:${(actualEndMins % 60).toString().padStart(2, '0')}`;

    return {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      scheduleVersion: config.schedule_version,
      operatingHours: {
        start: actualStartTime,
        end: actualEndTime,
      },
      scans: allScans,
    };
  }

  /**
   * Generate schedule using the stored regenerated seed
   * This produces the same schedule as when regenerateFromNow was called
   */
  private async generateFromStoredSeed(
    userId: string,
    config: ScannerConfig,
    watchlist: WatchlistItem[],
    dateStr: string
  ): Promise<ScheduleResponse> {
    const regeneratedAt = new Date(config.regenerated_at!);
    const rng = createSeededRandom(config.regenerated_seed!);

    // Calculate the start time from when it was regenerated (+ 2 mins offset)
    const startMins = regeneratedAt.getHours() * 60 + regeneratedAt.getMinutes() + 2;
    const endHour = this.parseTimeToHour(config.operating_hours_end);
    const endMins = endHour * 60 - 5;
    const startHour = Math.floor(startMins / 60);
    const remainingHours = endHour - startHour;

    // Generate broad sweep scans for remaining hours
    const broadSweepScans: ScheduledScan[] = [];
    for (let i = 0; i < remainingHours; i++) {
      const hour = startHour + i;
      const minute = i === 0 ? startMins % 60 : rng.nextInt(0, 55);

      broadSweepScans.push({
        id: `bs-${dateStr}-${hour.toString().padStart(2, '0')}-regen`,
        scheduledTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        type: 'broad_sweep',
      });
    }

    // Generate watchlist scans
    const shuffledWatchlist = rng.shuffle(watchlist);
    const broadSweepMinsList = broadSweepScans.map((s) => this.timeToMinutes(s.scheduledTime));

    const watchlistScans: ScheduledScan[] = [];
    let currentMins = startMins + 5;

    for (let i = 0; i < shuffledWatchlist.length; i++) {
      const item = shuffledWatchlist[i];
      currentMins = this.findNextValidSlot(currentMins, broadSweepMinsList, endMins);

      if (currentMins >= endMins) {
        break;
      }

      const hour = Math.floor(currentMins / 60);
      const minute = currentMins % 60;

      watchlistScans.push({
        id: `wl-${dateStr}-${i.toString().padStart(3, '0')}-regen`,
        scheduledTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        type: 'watchlist',
        setNumber: item.set_number,
      });

      const gap = rng.nextInt(this.MIN_WATCHLIST_GAP_MINS, this.MAX_WATCHLIST_GAP_MINS);
      currentMins += gap;
    }

    const allScans = [...broadSweepScans, ...watchlistScans].sort((a, b) =>
      a.scheduledTime.localeCompare(b.scheduledTime)
    );

    return {
      date: dateStr,
      generatedAt: config.regenerated_at!,
      scheduleVersion: config.schedule_version,
      operatingHours: {
        start: config.operating_hours_start,
        end: config.operating_hours_end,
      },
      scans: allScans,
    };
  }

  /**
   * Get scanner config for a user
   */
  private async getConfig(userId: string): Promise<ScannerConfig | null> {
    const { data, error } = await this.supabase
      .from('vinted_scanner_config')
      .select(`
        operating_hours_start, operating_hours_end, schedule_version,
        regenerated_seed, regenerated_at,
        daily_nonce, daily_nonce_date, start_variance_mins, end_variance_mins,
        recovery_mode, recovery_rate_percent
      `)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      operating_hours_start: data.operating_hours_start as string,
      operating_hours_end: data.operating_hours_end as string,
      schedule_version: data.schedule_version as number,
      regenerated_seed: data.regenerated_seed as string | null,
      regenerated_at: data.regenerated_at as string | null,
      daily_nonce: data.daily_nonce as string | null,
      daily_nonce_date: data.daily_nonce_date as string | null,
      start_variance_mins: (data.start_variance_mins as number) ?? 15,
      end_variance_mins: (data.end_variance_mins as number) ?? 15,
      recovery_mode: (data.recovery_mode as boolean) ?? false,
      recovery_rate_percent: (data.recovery_rate_percent as number) ?? 100,
    };
  }

  /**
   * Get watchlist items for a user
   */
  private async getWatchlist(userId: string): Promise<WatchlistItem[]> {
    const { data, error } = await this.supabase
      .from('vinted_watchlist')
      .select('set_number, asin, source')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error || !data) {
      return [];
    }

    return data as WatchlistItem[];
  }

  /**
   * Generate broad sweep scan slots
   * One per hour during operating hours, at random minute 0-55
   */
  private generateBroadSweepScans(
    startHour: number,
    hoursCount: number,
    rng: ReturnType<typeof createSeededRandom>,
    dateStr: string
  ): ScheduledScan[] {
    const scans: ScheduledScan[] = [];

    for (let i = 0; i < Math.min(hoursCount, this.BROAD_SWEEP_COUNT); i++) {
      const hour = startHour + i;
      const minute = rng.nextInt(0, 55);

      scans.push({
        id: `bs-${dateStr}-${hour.toString().padStart(2, '0')}`,
        scheduledTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        type: 'broad_sweep',
      });
    }

    return scans;
  }

  /**
   * Generate watchlist scan slots
   * Distributes all watchlist sets with 2-8 minute random gaps
   * Maintains 5+ minute separation from broad sweeps
   */
  private generateWatchlistScans(
    watchlist: WatchlistItem[],
    broadSweepScans: ScheduledScan[],
    startHour: number,
    endHour: number,
    rng: ReturnType<typeof createSeededRandom>,
    dateStr: string
  ): ScheduledScan[] {
    if (watchlist.length === 0) {
      return [];
    }

    // Shuffle watchlist order daily
    const shuffledWatchlist = rng.shuffle(watchlist);

    // Convert broad sweep times to minutes from midnight for easy comparison
    const broadSweepMins = broadSweepScans.map((s) => this.timeToMinutes(s.scheduledTime));

    const scans: ScheduledScan[] = [];
    const startMins = startHour * 60 + 10; // Start 10 minutes into first hour
    const endMins = endHour * 60 - 5; // End 5 minutes before end

    let currentMins = startMins;

    for (let i = 0; i < shuffledWatchlist.length; i++) {
      const item = shuffledWatchlist[i];

      // Find next valid time slot (avoiding broad sweep proximity)
      currentMins = this.findNextValidSlot(currentMins, broadSweepMins, endMins);

      if (currentMins >= endMins) {
        // Ran out of time slots for today
        console.warn(
          `[VintedScheduleService] Could not schedule all watchlist items. Scheduled ${i} of ${shuffledWatchlist.length}`
        );
        break;
      }

      const hour = Math.floor(currentMins / 60);
      const minute = currentMins % 60;

      scans.push({
        id: `wl-${dateStr}-${i.toString().padStart(3, '0')}`,
        scheduledTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        type: 'watchlist',
        setNumber: item.set_number,
      });

      // Add random gap for next item
      const gap = rng.nextInt(this.MIN_WATCHLIST_GAP_MINS, this.MAX_WATCHLIST_GAP_MINS);
      currentMins += gap;
    }

    return scans;
  }

  /**
   * Find next valid time slot that maintains separation from broad sweeps
   */
  private findNextValidSlot(
    proposedMins: number,
    broadSweepMins: number[],
    endMins: number
  ): number {
    let mins = proposedMins;

    while (mins < endMins) {
      // Check if too close to any broad sweep
      const tooClose = broadSweepMins.some(
        (bsMins) => Math.abs(mins - bsMins) < this.MIN_BROAD_WATCHLIST_GAP_MINS
      );

      if (!tooClose) {
        return mins;
      }

      // Move forward 1 minute and try again
      mins++;
    }

    return mins;
  }

  /**
   * Parse time string (HH:MM) to hour number
   */
  private parseTimeToHour(timeStr: string): number {
    const [hours] = timeStr.split(':').map(Number);
    return hours;
  }

  /**
   * Convert time string (HH:MM:SS or HH:MM) to minutes from midnight
   */
  private timeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  }

  /**
   * Get schedule for remaining hours today (for mid-day regeneration)
   * Returns only scans that haven't happened yet
   */
  async generateRemainingSchedule(userId: string): Promise<ScheduleResponse> {
    const fullSchedule = await this.generateSchedule(userId, new Date());
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:00`;

    // Filter to only future scans
    const remainingScans = fullSchedule.scans.filter(
      (scan) => scan.scheduledTime > currentTime
    );

    return {
      ...fullSchedule,
      scans: remainingScans,
    };
  }

  /**
   * Regenerate schedule starting from a specific time (for late starts)
   * Creates a NEW schedule starting from startTime until end of operating hours
   * Uses a different seed so it's not the same as the morning schedule
   *
   * @param userId - User ID to generate schedule for
   * @param startInMinutes - How many minutes from now to start first scan (default 2)
   */
  async regenerateFromNow(userId: string, startInMinutes: number = 2): Promise<ScheduleResponse> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Fetch config and watchlist
    const [config, watchlist] = await Promise.all([
      this.getConfig(userId),
      this.getWatchlist(userId),
    ]);

    if (!config) {
      throw new Error('Scanner config not found. Please configure the scanner first.');
    }

    // Calculate start time (now + startInMinutes)
    const startMins = now.getHours() * 60 + now.getMinutes() + startInMinutes;
    const endHour = this.parseTimeToHour(config.operating_hours_end);
    const endMins = endHour * 60 - 5;

    if (startMins >= endMins) {
      // Too late in the day to schedule anything
      return {
        date: dateStr,
        generatedAt: now.toISOString(),
        scheduleVersion: config.schedule_version,
        operatingHours: {
          start: config.operating_hours_start,
          end: config.operating_hours_end,
        },
        scans: [],
      };
    }

    // Create a NEW seed based on current timestamp (not just date)
    // This ensures we get a different schedule than the morning one
    const regenerateSeed = `${this.SALT}-regen-${userId}-${now.getTime()}`;
    const rng = createSeededRandom(regenerateSeed);

    // Store the seed so subsequent schedule fetches use the same seed
    await this.storeRegeneratedSeed(userId, regenerateSeed);

    // Calculate how many hours remain
    const startHour = Math.floor(startMins / 60);
    const remainingHours = endHour - startHour;

    // Generate broad sweep scans for remaining hours
    const broadSweepScans: ScheduledScan[] = [];
    for (let i = 0; i < remainingHours; i++) {
      const hour = startHour + i;
      // First hour starts at startMins, subsequent hours at random minute
      const minute = i === 0
        ? startMins % 60
        : rng.nextInt(0, 55);

      broadSweepScans.push({
        id: `bs-${dateStr}-${hour.toString().padStart(2, '0')}-regen`,
        scheduledTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        type: 'broad_sweep',
      });
    }

    // Generate watchlist scans with remaining time
    const shuffledWatchlist = rng.shuffle(watchlist);
    const broadSweepMinsList = broadSweepScans.map((s) => this.timeToMinutes(s.scheduledTime));

    const watchlistScans: ScheduledScan[] = [];
    let currentMins = startMins + 5; // Start 5 mins after first broad sweep

    for (let i = 0; i < shuffledWatchlist.length; i++) {
      const item = shuffledWatchlist[i];

      // Find next valid slot
      currentMins = this.findNextValidSlot(currentMins, broadSweepMinsList, endMins);

      if (currentMins >= endMins) {
        console.warn(
          `[VintedScheduleService.regenerateFromNow] Could only fit ${i} of ${shuffledWatchlist.length} watchlist items`
        );
        break;
      }

      const hour = Math.floor(currentMins / 60);
      const minute = currentMins % 60;

      watchlistScans.push({
        id: `wl-${dateStr}-${i.toString().padStart(3, '0')}-regen`,
        scheduledTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`,
        type: 'watchlist',
        setNumber: item.set_number,
      });

      const gap = rng.nextInt(this.MIN_WATCHLIST_GAP_MINS, this.MAX_WATCHLIST_GAP_MINS);
      currentMins += gap;
    }

    // Combine and sort
    const allScans = [...broadSweepScans, ...watchlistScans].sort((a, b) =>
      a.scheduledTime.localeCompare(b.scheduledTime)
    );

    // Bump schedule version to notify scanner
    const newVersion = await this.bumpScheduleVersion(userId);

    return {
      date: dateStr,
      generatedAt: now.toISOString(),
      scheduleVersion: newVersion,
      operatingHours: {
        start: config.operating_hours_start,
        end: config.operating_hours_end,
      },
      scans: allScans,
    };
  }

  /**
   * Bump the schedule version to trigger scanner refresh
   */
  private async bumpScheduleVersion(userId: string): Promise<number> {
    // First get current version
    const { data: current } = await this.supabase
      .from('vinted_scanner_config')
      .select('schedule_version')
      .eq('user_id', userId)
      .single();

    const newVersion = (current?.schedule_version ?? 0) + 1;

    await this.supabase
      .from('vinted_scanner_config')
      .update({
        schedule_version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    return newVersion;
  }

  /**
   * Store the regenerated seed so subsequent schedule fetches use it
   */
  private async storeRegeneratedSeed(userId: string, seed: string): Promise<void> {
    await this.supabase
      .from('vinted_scanner_config')
      .update({
        regenerated_seed: seed,
        regenerated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  /**
   * Check if there's a valid regenerated seed for today
   */
  private isRegeneratedSeedValidForToday(config: ScannerConfig): boolean {
    if (!config.regenerated_seed || !config.regenerated_at) {
      return false;
    }

    // Check if regenerated_at is today
    const regeneratedDate = new Date(config.regenerated_at).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    return regeneratedDate === today;
  }

  /**
   * Get or create daily nonce for schedule randomization
   * This prevents pattern fingerprinting by DataDome - each day gets a random nonce
   * that changes the entire schedule pattern
   */
  private async getOrCreateDailyNonce(
    userId: string,
    config: ScannerConfig,
    dateStr: string
  ): Promise<string> {
    // Check if we have a valid nonce for today
    if (config.daily_nonce && config.daily_nonce_date === dateStr) {
      return config.daily_nonce;
    }

    // Generate new nonce for today
    const nonce = crypto.randomUUID();

    // Store it in the database
    await this.supabase
      .from('vinted_scanner_config')
      .update({
        daily_nonce: nonce,
        daily_nonce_date: dateStr,
      })
      .eq('user_id', userId);

    console.log(`[VintedScheduleService] Generated new daily nonce for ${dateStr}`);
    return nonce;
  }

  /**
   * Update recovery rate based on time since CAPTCHA
   * Call this on heartbeat or schedule fetch to auto-ramp
   *
   * Recovery schedule:
   * - Day 0-1: 25%
   * - Day 2-3: 50%
   * - Day 4-5: 75%
   * - Day 6+: 100% (exit recovery mode)
   */
  async updateRecoveryRate(userId: string): Promise<void> {
    const config = await this.getConfig(userId);
    if (!config || !config.recovery_mode) return;

    // Get captcha_detected_at from database
    const { data } = await this.supabase
      .from('vinted_scanner_config')
      .select('captcha_detected_at')
      .eq('user_id', userId)
      .single();

    if (!data?.captcha_detected_at) return;

    const captchaAt = new Date(data.captcha_detected_at);
    const daysSince = (Date.now() - captchaAt.getTime()) / (1000 * 60 * 60 * 24);

    let newRate: number;
    let exitRecovery = false;

    if (daysSince >= 6) {
      newRate = 100;
      exitRecovery = true;
    } else if (daysSince >= 4) {
      newRate = 75;
    } else if (daysSince >= 2) {
      newRate = 50;
    } else {
      newRate = 25;
    }

    // Only update if rate changed
    if (newRate !== config.recovery_rate_percent || exitRecovery) {
      await this.supabase
        .from('vinted_scanner_config')
        .update({
          recovery_rate_percent: newRate,
          recovery_mode: !exitRecovery,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      console.log(
        `[VintedScheduleService] Recovery rate updated to ${newRate}%` +
          (exitRecovery ? ' - exiting recovery mode' : '')
      );
    }
  }
}
