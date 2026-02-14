/**
 * Vercel Usage Monitoring Service
 *
 * Fetches Vercel platform usage metrics and calculates RAG status
 * for monitoring Hobby plan limits. Combines v2 API data (function
 * invocations, builds, bandwidth) with scraped dashboard data
 * (Fluid Active CPU, ISR, Edge metrics, etc.) from Supabase.
 *
 * Environment variables:
 * - VERCEL_API_TOKEN: Personal access token from https://vercel.com/account/tokens
 * - SUPABASE_SERVICE_ROLE_KEY: For reading scraped metrics from Supabase
 */

import { createServiceRoleClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RagStatus = 'GREEN' | 'AMBER' | 'RED';

export interface UsageMetric {
  name: string;
  current: number;
  limit: number;
  unit: string;
  usedPercent: number;
  status: RagStatus;
  currentFormatted: string;
  limitFormatted: string;
}

export interface BillingPeriod {
  start: Date;
  end: Date;
  formatted: string;
}

export interface VercelUsageReport {
  team: string;
  plan: string;
  period: BillingPeriod;
  metrics: UsageMetric[];
  overallStatus: RagStatus;
  fetchedAt: string;
  fromApi: boolean;
}

/** Keys matching Hobby plan metric names (dashboard + v2 API) */
export interface ManualUsageData {
  // Networking
  fastDataTransferGb?: number;
  fastOriginTransferGb?: number;
  edgeRequests?: number;
  edgeRequestCpuDurationSeconds?: number;
  microfrontendsRouting?: number;
  // ISR
  isrReads?: number;
  isrWrites?: number;
  // Vercel Functions
  functionInvocations?: number;
  functionDurationGbHours?: number;
  fluidProvisionedMemoryGbHours?: number;
  fluidActiveCpuSeconds?: number;
  edgeFnExecutionUnits?: number;
  edgeMiddlewareInvocations?: number;
  // Storage
  blobDataStorageGb?: number;
  blobSimpleOperations?: number;
  // Build (v2 API only)
  buildMinutes?: number;
  deployments?: number;
}

/** v2 API daily request data shape */
interface V2RequestsDay {
  function_invocation_successful_count?: number;
  function_invocation_error_count?: number;
  function_invocation_timeout_count?: number;
  function_execution_successful_gb_hours?: number;
  function_execution_error_gb_hours?: number;
  function_execution_timeout_gb_hours?: number;
  bandwidth_outgoing_bytes?: number;
}

/** v2 API daily builds data shape */
interface V2BuildsDay {
  build_build_seconds?: number;
  build_completed_count?: number;
  build_failed_count?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface HobbyLimit {
  name: string;
  key: keyof ManualUsageData;
  limit: number;
  unit: string;
}

/** All Hobby plan limits — matches Vercel dashboard usage table */
const HOBBY_LIMITS: HobbyLimit[] = [
  // Networking
  { name: 'Fast Data Transfer', key: 'fastDataTransferGb', limit: 100, unit: 'GB' },
  { name: 'Fast Origin Transfer', key: 'fastOriginTransferGb', limit: 10, unit: 'GB' },
  { name: 'Edge Requests', key: 'edgeRequests', limit: 1_000_000, unit: 'requests' },
  { name: 'Edge Request CPU Duration', key: 'edgeRequestCpuDurationSeconds', limit: 3600, unit: 'seconds' },
  { name: 'Microfrontends Routing', key: 'microfrontendsRouting', limit: 50_000, unit: 'requests' },
  // ISR
  { name: 'ISR Reads', key: 'isrReads', limit: 1_000_000, unit: 'reads' },
  { name: 'ISR Writes', key: 'isrWrites', limit: 200_000, unit: 'writes' },
  // Vercel Functions
  { name: 'Function Invocations', key: 'functionInvocations', limit: 1_000_000, unit: 'invocations' },
  { name: 'Function Duration', key: 'functionDurationGbHours', limit: 100, unit: 'GB-Hrs' },
  { name: 'Fluid Provisioned Memory', key: 'fluidProvisionedMemoryGbHours', limit: 360, unit: 'GB-Hrs' },
  { name: 'Fluid Active CPU', key: 'fluidActiveCpuSeconds', limit: 14_400, unit: 'seconds' },
  { name: 'Edge Function Execution Units', key: 'edgeFnExecutionUnits', limit: 500_000, unit: 'units' },
  { name: 'Edge Middleware Invocations', key: 'edgeMiddlewareInvocations', limit: 1_000_000, unit: 'invocations' },
  // Storage
  { name: 'Blob Data Storage', key: 'blobDataStorageGb', limit: 1, unit: 'GB' },
  { name: 'Blob Simple Operations', key: 'blobSimpleOperations', limit: 10_000, unit: 'operations' },
  // Build (v2 API — not on dashboard usage page)
  { name: 'Build Minutes', key: 'buildMinutes', limit: 6000, unit: 'minutes' },
  { name: 'Deployments', key: 'deployments', limit: 100, unit: 'per day' },
];

/** Maps scraped_metrics keys to HOBBY_LIMITS metric names */
const SCRAPED_KEY_TO_METRIC: Record<string, string> = {
  vercel_fast_data_transfer: 'Fast Data Transfer',
  vercel_fast_origin_transfer: 'Fast Origin Transfer',
  vercel_edge_requests: 'Edge Requests',
  vercel_edge_request_cpu_duration: 'Edge Request CPU Duration',
  vercel_microfrontends_routing: 'Microfrontends Routing',
  vercel_isr_reads: 'ISR Reads',
  vercel_isr_writes: 'ISR Writes',
  vercel_function_invocations: 'Function Invocations',
  vercel_function_duration: 'Function Duration',
  vercel_fluid_provisioned_memory: 'Fluid Provisioned Memory',
  vercel_fluid_active_cpu: 'Fluid Active CPU',
  vercel_edge_function_execution_units: 'Edge Function Execution Units',
  vercel_edge_middleware_invocations: 'Edge Middleware Invocations',
  vercel_blob_data_storage: 'Blob Data Storage',
  vercel_blob_simple_operations: 'Blob Simple Operations',
};

const RAG_THRESHOLDS = {
  GREEN_MAX: 50,
  AMBER_MAX: 75,
} as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Billing period starts on the 13th each month */
const BILLING_START_DAY = 13;

export class VercelUsageService {
  private readonly token: string | undefined;

  constructor() {
    this.token = process.env.VERCEL_API_TOKEN;

    if (!this.token) {
      console.log('[VercelUsageService] Disabled - missing VERCEL_API_TOKEN');
    }
  }

  /** Check if the Vercel API token is configured */
  isEnabled(): boolean {
    return !!this.token;
  }

  // -----------------------------------------------------------------------
  // Public methods
  // -----------------------------------------------------------------------

  /**
   * Fetch usage from the Vercel v2 API + scraped dashboard data.
   * The v2 API provides function invocations, function duration, bandwidth,
   * build minutes, and deployments. All other metrics come from scraped data.
   */
  async fetchUsage(): Promise<VercelUsageReport | null> {
    const period = this.getCurrentBillingPeriod();

    // Try v2 API first, then fall back to scraped-only
    let report: VercelUsageReport | null = null;

    if (this.token) {
      try {
        const params = new URLSearchParams({
          from: period.start.toISOString(),
          to: period.end.toISOString(),
        });

        const headers = { Authorization: `Bearer ${this.token}` };

        const [requestsRes, buildsRes] = await Promise.all([
          fetch(`https://api.vercel.com/v2/usage?type=requests&${params.toString()}`, { headers }),
          fetch(`https://api.vercel.com/v2/usage?type=builds&${params.toString()}`, { headers }),
        ]);

        if (requestsRes.ok && buildsRes.ok) {
          const requestsData = await requestsRes.json();
          const buildsData = await buildsRes.json();
          report = this.buildReportFromV2Data(requestsData, buildsData, period);
        } else {
          const reqBody = !requestsRes.ok ? await requestsRes.text().catch(() => '') : '';
          const buildBody = !buildsRes.ok ? await buildsRes.text().catch(() => '') : '';
          console.warn(
            `[VercelUsageService] v2 API error - requests: ${requestsRes.status} ${reqBody}, builds: ${buildsRes.status} ${buildBody}`
          );
        }
      } catch (error) {
        console.warn('[VercelUsageService] v2 API fetch failed, falling back to scraped data:', error);
      }
    } else {
      console.log('[VercelUsageService] No VERCEL_API_TOKEN — using scraped data only');
    }

    // If v2 API failed or unavailable, build a baseline report from empty data
    if (!report) {
      report = this.buildReportFromManualData({});
      report.fromApi = false;
    }

    // Always merge scraped dashboard metrics (overrides v2 API values where available)
    await this.mergeScrapedMetrics(report);
    return report;
  }

  /**
   * Build a report from manually-provided usage data.
   * Use when the Vercel API is unavailable on Hobby plans.
   */
  buildReportFromManualData(data: ManualUsageData): VercelUsageReport {
    const period = this.getCurrentBillingPeriod();
    const metrics = this.buildMetrics(data);
    const overallStatus = this.getWorstStatus(metrics);

    return {
      team: 'personal',
      plan: 'Hobby',
      period,
      metrics,
      overallStatus,
      fetchedAt: new Date().toISOString(),
      fromApi: false,
    };
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /** Calculate RAG status from a percentage */
  static calculateRag(percent: number): RagStatus {
    if (percent <= RAG_THRESHOLDS.GREEN_MAX) return 'GREEN';
    if (percent <= RAG_THRESHOLDS.AMBER_MAX) return 'AMBER';
    return 'RED';
  }

  /** Format a value with its unit for display */
  static formatValue(value: number, unit: string): string {
    switch (unit) {
      case 'seconds': {
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
      }
      case 'minutes': {
        const h = Math.floor(value / 60);
        const m = value % 60;
        if (h > 0) return `${h}h ${Math.round(m)}m`;
        return `${Math.round(value)}m`;
      }
      case 'GB':
      case 'GB-Hrs':
        return `${value.toFixed(1)} ${unit}`;
      default:
        return `${value.toLocaleString('en-GB')} ${unit}`;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Merge ALL scraped metrics from Supabase into the report.
   * Overrides v2 API values for overlapping metrics (scraped = dashboard truth).
   * Non-fatal: if the read fails or data is stale, metrics keep their v2 API values.
   */
  private async mergeScrapedMetrics(report: VercelUsageReport): Promise<void> {
    try {
      const supabase = createServiceRoleClient();

      const { data, error } = await supabase
        .from('scraped_metrics')
        .select('key, value, unit, scraped_at')
        .like('key', 'vercel_%');

      if (error || !data || data.length === 0) {
        console.log('[VercelUsageService] No scraped metrics found');
        return;
      }

      // Validate freshness of the most recent scrape
      const mostRecent = data.reduce((a, b) =>
        new Date(a.scraped_at) > new Date(b.scraped_at) ? a : b
      );
      const ageMs = Date.now() - new Date(mostRecent.scraped_at).getTime();
      const maxAgeMs = 36 * 60 * 60 * 1000; // 36 hours

      if (ageMs > maxAgeMs) {
        console.warn(
          `[VercelUsageService] Scraped data too old (${(ageMs / 3600000).toFixed(1)}h) — ignoring`
        );
        return;
      }

      let mergedCount = 0;
      for (const row of data) {
        const metricName = SCRAPED_KEY_TO_METRIC[row.key];
        if (!metricName) continue;

        const metric = report.metrics.find((m) => m.name === metricName);
        if (!metric) continue;

        const value = Number(row.value);
        metric.current = value;
        metric.usedPercent =
          metric.limit > 0 ? Math.round((value / metric.limit) * 1000) / 10 : 0;
        metric.status = VercelUsageService.calculateRag(metric.usedPercent);
        metric.currentFormatted = VercelUsageService.formatValue(value, metric.unit);
        mergedCount++;
      }

      // Recalculate overall status
      report.overallStatus = this.getWorstStatus(report.metrics);

      console.log(
        `[VercelUsageService] Merged ${mergedCount}/${data.length} scraped metrics ` +
        `(scraped ${(ageMs / 3600000).toFixed(1)}h ago)`
      );
    } catch (err) {
      // Non-fatal — metrics keep v2 API values (or 0)
      console.warn('[VercelUsageService] Failed to merge scraped metrics:', err);
    }
  }

  /** Get the current billing period based on the configured start day */
  private getCurrentBillingPeriod(): BillingPeriod {
    const now = new Date();
    let start: Date;
    let end: Date;

    if (now.getUTCDate() >= BILLING_START_DAY) {
      // We're in a period that started this month
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), BILLING_START_DAY));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, BILLING_START_DAY - 1));
    } else {
      // We're in a period that started last month
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, BILLING_START_DAY));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), BILLING_START_DAY - 1));
    }

    const fmt = (d: Date) =>
      d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

    return {
      start,
      end,
      formatted: `${fmt(start)} - ${fmt(end)}`,
    };
  }

  /** Build metrics array from manual data */
  private buildMetrics(data: ManualUsageData): UsageMetric[] {
    return HOBBY_LIMITS.map((def) => {
      const current = data[def.key] ?? 0;
      const usedPercent = def.limit > 0 ? (current / def.limit) * 100 : 0;
      const status = VercelUsageService.calculateRag(usedPercent);

      return {
        name: def.name,
        current,
        limit: def.limit,
        unit: def.unit,
        usedPercent: Math.round(usedPercent * 10) / 10,
        status,
        currentFormatted: VercelUsageService.formatValue(current, def.unit),
        limitFormatted: VercelUsageService.formatValue(def.limit, def.unit),
      };
    });
  }

  /** Build report from Vercel v2 API daily data (requests + builds) */
  private buildReportFromV2Data(
    requestsData: { data?: V2RequestsDay[] },
    buildsData: { data?: V2BuildsDay[] },
    period: BillingPeriod
  ): VercelUsageReport {
    const manualData: ManualUsageData = {};

    // Aggregate daily request metrics across the period
    const reqDays = requestsData.data ?? [];
    let totalFnInvocations = 0;
    let totalFnGbHours = 0;
    let totalBandwidthBytes = 0;

    for (const day of reqDays) {
      totalFnInvocations +=
        (day.function_invocation_successful_count ?? 0) +
        (day.function_invocation_error_count ?? 0) +
        (day.function_invocation_timeout_count ?? 0);
      totalFnGbHours +=
        (day.function_execution_successful_gb_hours ?? 0) +
        (day.function_execution_error_gb_hours ?? 0) +
        (day.function_execution_timeout_gb_hours ?? 0);
      totalBandwidthBytes += day.bandwidth_outgoing_bytes ?? 0;
    }

    manualData.functionInvocations = totalFnInvocations;
    manualData.functionDurationGbHours = totalFnGbHours;
    manualData.fastDataTransferGb = totalBandwidthBytes / (1024 * 1024 * 1024);

    // Aggregate daily build metrics across the period
    const buildDays = buildsData.data ?? [];
    let totalBuildSeconds = 0;
    let totalDeployments = 0;

    for (const day of buildDays) {
      totalBuildSeconds += day.build_build_seconds ?? 0;
      totalDeployments += (day.build_completed_count ?? 0) + (day.build_failed_count ?? 0);
    }

    manualData.buildMinutes = totalBuildSeconds / 60;
    manualData.deployments = totalDeployments;

    console.log(
      `[VercelUsageService] v2 API aggregated: ${reqDays.length} request days, ${buildDays.length} build days, ` +
      `${totalFnInvocations} invocations, ${manualData.buildMinutes.toFixed(0)} build mins`
    );

    const metrics = this.buildMetrics(manualData);
    const overallStatus = this.getWorstStatus(metrics);

    return {
      team: 'personal',
      plan: 'Hobby',
      period,
      metrics,
      overallStatus,
      fetchedAt: new Date().toISOString(),
      fromApi: true,
    };
  }

  /** Get the worst RAG status from a set of metrics */
  private getWorstStatus(metrics: UsageMetric[]): RagStatus {
    if (metrics.some((m) => m.status === 'RED')) return 'RED';
    if (metrics.some((m) => m.status === 'AMBER')) return 'AMBER';
    return 'GREEN';
  }
}

export const vercelUsageService = new VercelUsageService();
