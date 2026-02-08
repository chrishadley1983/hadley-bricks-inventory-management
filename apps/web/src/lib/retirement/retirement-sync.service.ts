/**
 * Retirement Sync Service
 *
 * Aggregates retirement data from multiple sources into the retirement_sources table,
 * then rolls up the best estimate into brickset_sets retirement columns.
 *
 * Sources:
 * 1. Brickset API - availability status and dateLastAvailable from cached data
 * 2. Brick Tap Google Sheet - community-maintained retirement date predictions
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RetirementConfidence,
  RetirementRollupResult,
  RetirementSourceRecord,
  RetirementStatus,
  RetirementSyncResult,
} from './types';

export class RetirementSyncService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Sync retirement data from all available sources.
   * Each source is processed independently — one failure doesn't block others.
   */
  async syncAllSources(): Promise<{
    sources: Record<string, RetirementSyncResult>;
    rollup: RetirementRollupResult;
  }> {
    const results: Record<string, RetirementSyncResult> = {};

    // Source 1: Brickset (from existing cached data in brickset_sets)
    results.brickset = await this.syncFromBrickset();

    // Source 2: Brick Tap Google Sheet
    results.bricktap = await this.syncFromBrickTap();

    // After all sources synced, calculate rollup
    const rollup = await this.calculateRollup();

    return { sources: results, rollup };
  }

  /**
   * Extract retirement data from existing brickset_sets cached data.
   * Uses the availability field and exit_date from Brickset API.
   */
  private async syncFromBrickset(): Promise<RetirementSyncResult> {
    const startTime = Date.now();
    let processed = 0;
    let upserted = 0;
    let errors = 0;

    try {
      console.log('[RetirementSync] Syncing from Brickset cache...');

      // Fetch sets with retirement-relevant data
      const pageSize = 1000;
      let page = 0;
      let hasMore = true;
      const records: RetirementSourceRecord[] = [];

      while (hasMore) {
        const { data, error } = await this.supabase
          .from('brickset_sets')
          .select('set_number, availability, exit_date, us_date_removed, year_from')
          .not('availability', 'is', null)
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error('[RetirementSync] Brickset query error:', error.message);
          break;
        }

        for (const row of data ?? []) {
          const record = this.mapBricksetToRetirement(row);
          if (record) {
            records.push(record);
            processed++;
          }
        }

        hasMore = (data?.length ?? 0) === pageSize;
        page++;
      }

      // Upsert in batches
      for (let i = 0; i < records.length; i += 500) {
        const batch = records.slice(i, i + 500);
        const { error } = await this.supabase
          .from('retirement_sources')
          .upsert(batch, { onConflict: 'set_num,source' });

        if (error) {
          console.error('[RetirementSync] Brickset upsert error:', error.message);
          errors += batch.length;
        } else {
          upserted += batch.length;
        }
      }

      console.log(
        `[RetirementSync] Brickset: ${processed} processed, ${upserted} upserted, ${errors} errors`
      );

      return {
        source: 'brickset',
        success: errors === 0,
        records_processed: processed,
        records_upserted: upserted,
        errors,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[RetirementSync] Brickset sync failed:', errorMsg);
      return {
        source: 'brickset',
        success: false,
        records_processed: processed,
        records_upserted: upserted,
        errors: errors + 1,
        error_message: errorMsg,
        duration_ms: Date.now() - startTime,
      };
    }
  }

  /** Map Brickset availability data to a retirement source record */
  private mapBricksetToRetirement(row: {
    set_number: string;
    availability: string | null;
    exit_date: string | null;
    us_date_removed: string | null;
    year_from: number | null;
  }): RetirementSourceRecord | null {
    if (!row.availability) return null;

    const avail = row.availability.toLowerCase();
    const retirementDate = row.exit_date ?? row.us_date_removed ?? null;
    const currentYear = new Date().getFullYear();
    // Sets typically stay on shelves ~2 years. A set from 2+ years ago
    // without current "Retail" availability is almost certainly retired.
    const isCertainlyOld = row.year_from != null && row.year_from < currentYear - 2;

    let status: RetirementStatus;
    let confidence: RetirementConfidence;

    if (avail === 'retired' || avail === 'no longer available') {
      status = 'retired';
      confidence = 'confirmed';
    } else if (avail === '{not specified}') {
      // Brickset uses {Not specified} for sets no longer tracked - always retired
      status = 'retired';
      confidence = retirementDate ? 'confirmed' : 'likely';
    } else if (avail === 'retiring soon') {
      status = 'retiring_soon';
      confidence = 'likely';
    } else if (
      avail === 'retail' ||
      avail === 'retail - limited' ||
      avail === 'lego exclusive' ||
      avail === 'available'
    ) {
      if (retirementDate) {
        // Has an exit date - check if it's in the past
        const exitTime = new Date(retirementDate).getTime();
        status = exitTime < Date.now() ? 'retired' : 'available';
        confidence = 'confirmed';
      } else if (isCertainlyOld) {
        // Old set still listed as "Retail" but year_from is 2+ years ago
        status = 'retired';
        confidence = 'likely';
      } else {
        status = 'available';
        confidence = 'speculative';
      }
    } else if (
      avail === 'promotional' ||
      avail === 'promotional (airline)' ||
      avail === 'not sold' ||
      avail === 'educational' ||
      avail === 'legoland exclusive'
    ) {
      // Special distribution - treat old ones as retired
      status = isCertainlyOld ? 'retired' : 'available';
      confidence = retirementDate ? 'confirmed' : (isCertainlyOld ? 'likely' : 'speculative');
    } else {
      // Unknown availability value
      status = isCertainlyOld ? 'retired' : 'available';
      confidence = 'speculative';
    }

    return {
      set_num: row.set_number,
      source: 'brickset',
      expected_retirement_date: retirementDate,
      status,
      confidence,
      raw_data: {
        availability: row.availability,
        exit_date: row.exit_date,
        us_date_removed: row.us_date_removed,
        year_from: row.year_from,
      },
    };
  }

  /**
   * Sync retirement data from Brick Tap Google Sheet.
   * Brick Tap maintains a publicly accessible Google Sheet with retirement predictions.
   */
  private async syncFromBrickTap(): Promise<RetirementSyncResult> {
    const startTime = Date.now();
    let processed = 0;
    let upserted = 0;
    let errors = 0;

    try {
      console.log('[RetirementSync] Syncing from Brick Tap...');

      // Brick Tap publishes their data as a Google Sheet CSV export
      const sheetUrl = process.env.BRICKTAP_SHEET_URL;

      if (!sheetUrl) {
        console.warn(
          '[RetirementSync] BRICKTAP_SHEET_URL not set - skipping Brick Tap sync'
        );
        return {
          source: 'bricktap',
          success: false,
          records_processed: 0,
          records_upserted: 0,
          errors: 0,
          error_message: 'BRICKTAP_SHEET_URL environment variable not set',
          duration_ms: Date.now() - startTime,
        };
      }

      const response = await fetch(sheetUrl, {
        headers: { Accept: 'text/csv' },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Brick Tap sheet: ${response.status} ${response.statusText}`
        );
      }

      const csvText = await response.text();
      const records = this.parseBrickTapCSV(csvText);
      processed = records.length;

      // Upsert in batches
      for (let i = 0; i < records.length; i += 500) {
        const batch = records.slice(i, i + 500);
        const { error } = await this.supabase
          .from('retirement_sources')
          .upsert(batch, { onConflict: 'set_num,source' });

        if (error) {
          console.error('[RetirementSync] BrickTap upsert error:', error.message);
          errors += batch.length;
        } else {
          upserted += batch.length;
        }
      }

      console.log(
        `[RetirementSync] BrickTap: ${processed} processed, ${upserted} upserted, ${errors} errors`
      );

      return {
        source: 'bricktap',
        success: errors === 0,
        records_processed: processed,
        records_upserted: upserted,
        errors,
        duration_ms: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[RetirementSync] BrickTap sync failed:', errorMsg);
      return {
        source: 'bricktap',
        success: false,
        records_processed: processed,
        records_upserted: upserted,
        errors: errors + 1,
        error_message: errorMsg,
        duration_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * Parse Brick Tap CSV data into retirement source records.
   * Expected columns: Set Number, Name, Retirement Date, Source/Notes
   */
  private parseBrickTapCSV(csvText: string): RetirementSourceRecord[] {
    const allLines = csvText.trim().split('\n');
    // Skip blank/empty-comma lines to find the actual header row
    const headerIdx = allLines.findIndex(
      (line) => line.replace(/,/g, '').trim().length > 0
    );
    if (headerIdx === -1 || headerIdx >= allLines.length - 1) return [];

    const lines = allLines.slice(headerIdx);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

    // Find column indices (flexible to handle column order changes)
    const setNumIdx = headers.findIndex(
      (h) =>
        h.includes('set') && (h.includes('num') || h.includes('#') || h.includes('number'))
    );
    const dateIdx = headers.findIndex(
      (h) => h.includes('retire') || h.includes('date') || h.includes('eol')
    );
    const sourceIdx = headers.findIndex(
      (h) => h.includes('source') || h.includes('notes') || h.includes('confidence')
    );

    if (setNumIdx === -1) {
      console.warn(
        '[RetirementSync] BrickTap CSV: Could not find set number column'
      );
      return [];
    }

    const records: RetirementSourceRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCSVLine(lines[i]);
      const setNum = cols[setNumIdx]?.trim();

      if (!setNum) continue;

      // Normalize set number to include variant (e.g., "75192" -> "75192-1")
      const normalizedSetNum = setNum.includes('-')
        ? setNum
        : `${setNum}-1`;

      // Parse retirement date
      let retirementDate: string | null = null;
      if (dateIdx !== -1 && cols[dateIdx]) {
        retirementDate = this.parseDate(cols[dateIdx].trim());
      }

      // Determine confidence from source notes
      const sourceNotes = sourceIdx !== -1 ? cols[sourceIdx]?.trim() ?? '' : '';
      const confidence = this.inferConfidence(sourceNotes);

      // Determine status from date
      let status: RetirementStatus = 'available';
      if (retirementDate) {
        const retDate = new Date(retirementDate);
        const now = new Date();
        const sixMonthsFromNow = new Date();
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

        if (retDate < now) {
          status = 'retired';
        } else if (retDate <= sixMonthsFromNow) {
          status = 'retiring_soon';
        }
      }

      records.push({
        set_num: normalizedSetNum,
        source: 'bricktap',
        expected_retirement_date: retirementDate,
        status,
        confidence,
        raw_data: {
          original_line: lines[i],
          source_notes: sourceNotes,
        },
      });
    }

    return records;
  }

  /** Parse a CSV line handling quoted fields */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  /** Try to parse various date formats into ISO date string */
  private parseDate(dateStr: string): string | null {
    if (!dateStr) return null;

    // Try ISO format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }

    // Try DD/MM/YYYY
    const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Month abbreviation/full name lookup
    const monthLookup: Record<string, string> = {
      jan: '01', january: '01', feb: '02', february: '02',
      mar: '03', march: '03', apr: '04', april: '04',
      may: '05', jun: '06', june: '06', jul: '07', july: '07',
      aug: '08', august: '08', sep: '09', september: '09',
      oct: '10', october: '10', nov: '11', november: '11',
      dec: '12', december: '12',
    };

    // Try "Mon DD, YYYY" (e.g., "Apr 30, 2026")
    const monDayYear = dateStr.match(
      /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/
    );
    if (monDayYear) {
      const month = monthLookup[monDayYear[1].toLowerCase()];
      if (month) {
        return `${monDayYear[3]}-${month}-${monDayYear[2].padStart(2, '0')}`;
      }
    }

    // Try Month YYYY (e.g., "December 2026")
    const monthYear = dateStr.match(
      /^([A-Za-z]+)\s+(\d{4})$/
    );
    if (monthYear) {
      const month = monthLookup[monthYear[1].toLowerCase()];
      if (month) {
        return `${monthYear[2]}-${month}-01`;
      }
    }

    // Try just year (e.g., "2026")
    if (/^\d{4}$/.test(dateStr)) {
      return `${dateStr}-12-31`;
    }

    return null;
  }

  /** Infer confidence level from source notes */
  private inferConfidence(notes: string): RetirementConfidence {
    const lower = notes.toLowerCase();
    if (
      lower.includes('official') ||
      lower.includes('confirmed') ||
      lower.includes('lego.com')
    ) {
      return 'confirmed';
    }
    if (
      lower.includes('likely') ||
      lower.includes('multiple') ||
      lower.includes('rumour') ||
      lower.includes('rumor')
    ) {
      return 'likely';
    }
    return 'speculative';
  }

  /**
   * Calculate retirement status rollup for brickset_sets from retirement_sources.
   *
   * Rules:
   * - retirement_status: derived from best source (available/retiring_soon/retired)
   * - expected_retirement_date: from highest-confidence source
   * - retirement_confidence: confirmed > likely > speculative
   *   - confirmed: official LEGO source OR Brickset with exit_date
   *   - likely: 2+ sources agree on approximate date
   *   - speculative: single non-official source
   */
  async calculateRollup(): Promise<RetirementRollupResult> {
    const startTime = Date.now();
    let setsUpdated = 0;
    let confirmed = 0;
    let likely = 0;
    let speculative = 0;

    console.log('[RetirementSync] Calculating rollup...');

    // Fetch all retirement sources grouped by set_num
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;
    const sourcesBySet = new Map<string, RetirementSourceRecord[]>();

    while (hasMore) {
      const { data, error } = await this.supabase
        .from('retirement_sources')
        .select('*')
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('[RetirementSync] Rollup query error:', error.message);
        break;
      }

      for (const row of data ?? []) {
        const existing = sourcesBySet.get(row.set_num) ?? [];
        existing.push(row as RetirementSourceRecord);
        sourcesBySet.set(row.set_num, existing);
      }

      hasMore = (data?.length ?? 0) === pageSize;
      page++;
    }

    console.log(
      `[RetirementSync] Rollup: ${sourcesBySet.size} sets with retirement data`
    );

    // Calculate rollup for each set and group by update values for batching
    const confidencePriority: Record<RetirementConfidence, number> = {
      confirmed: 3,
      likely: 2,
      speculative: 1,
    };

    // Group sets by their rollup values so we can batch updates
    const updateGroups = new Map<string, {
      status: RetirementStatus;
      date: string | null;
      confidence: RetirementConfidence;
      setNumbers: string[];
    }>();

    for (const [setNum, sources] of sourcesBySet) {
      // Sort sources by confidence (highest first)
      sources.sort(
        (a, b) =>
          confidencePriority[b.confidence] - confidencePriority[a.confidence]
      );

      const bestSource = sources[0];

      // Check if 2+ sources agree (makes it "likely" minimum)
      let rollupConfidence = bestSource.confidence;
      if (sources.length >= 2 && rollupConfidence === 'speculative') {
        rollupConfidence = 'likely';
      }

      const rollupStatus = bestSource.status ?? 'available';
      const rollupDate = bestSource.expected_retirement_date;

      // Group key: status|date|confidence
      const key = `${rollupStatus}|${rollupDate ?? 'null'}|${rollupConfidence}`;
      const group = updateGroups.get(key);
      if (group) {
        group.setNumbers.push(setNum);
      } else {
        updateGroups.set(key, {
          status: rollupStatus,
          date: rollupDate,
          confidence: rollupConfidence,
          setNumbers: [setNum],
        });
      }
    }

    console.log(
      `[RetirementSync] Rollup: ${updateGroups.size} distinct update groups`
    );

    // Batch update each group (chunk .in() to max 500 set numbers per call)
    const BATCH_SIZE = 500;
    for (const group of updateGroups.values()) {
      for (let i = 0; i < group.setNumbers.length; i += BATCH_SIZE) {
        const chunk = group.setNumbers.slice(i, i + BATCH_SIZE);
        const { error, count } = await this.supabase
          .from('brickset_sets')
          .update({
            retirement_status: group.status,
            expected_retirement_date: group.date,
            retirement_confidence: group.confidence,
          })
          .in('set_number', chunk);

        if (error) {
          console.error('[RetirementSync] Rollup batch update error:', error.message);
        } else {
          const updated = count ?? chunk.length;
          setsUpdated += updated;
        }
      }

      // Track confidence counts
      const setCount = group.setNumbers.length;
      if (group.confidence === 'confirmed') confirmed += setCount;
      else if (group.confidence === 'likely') likely += setCount;
      else speculative += setCount;
    }

    const duration = Date.now() - startTime;
    console.log(
      `[RetirementSync] Rollup complete: ${setsUpdated} sets updated (${confirmed} confirmed, ${likely} likely, ${speculative} speculative) in ${duration}ms`
    );

    return {
      sets_updated: setsUpdated,
      confirmed,
      likely,
      speculative,
      duration_ms: duration,
    };
  }
}
