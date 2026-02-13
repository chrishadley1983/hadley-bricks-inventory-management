/**
 * Vercel Usage Monitoring Service
 *
 * Fetches Vercel platform usage metrics and calculates RAG status
 * for monitoring Hobby plan limits. Supports both API-based and
 * manual data input for when the API is unavailable on Hobby plans.
 *
 * Environment variables:
 * - VERCEL_API_TOKEN: Personal access token from https://vercel.com/account/tokens
 */

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

/** Manual data keys matching Hobby plan metric names */
export interface ManualUsageData {
  fluidActiveCpuSeconds?: number;
  functionInvocations?: number;
  functionDurationGbSeconds?: number;
  edgeRequests?: number;
  edgeMiddlewareInvocations?: number;
  sourceImages?: number;
  dataTransferGb?: number;
  webAnalyticsEvents?: number;
  buildMinutes?: number;
  concurrentBuilds?: number;
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

const HOBBY_LIMITS: HobbyLimit[] = [
  { name: 'Fluid Active CPU', key: 'fluidActiveCpuSeconds', limit: 14400, unit: 'seconds' },
  { name: 'Function Invocations', key: 'functionInvocations', limit: 1_000_000, unit: 'invocations' },
  { name: 'Function Duration', key: 'functionDurationGbSeconds', limit: 1000, unit: 'GB-hours' },
  { name: 'Edge Requests', key: 'edgeRequests', limit: 10_000_000, unit: 'requests' },
  { name: 'Edge Middleware Invocations', key: 'edgeMiddlewareInvocations', limit: 1_000_000, unit: 'invocations' },
  { name: 'Source Images', key: 'sourceImages', limit: 1000, unit: 'images' },
  { name: 'Data Transfer', key: 'dataTransferGb', limit: 100, unit: 'GB' },
  { name: 'Web Analytics Events', key: 'webAnalyticsEvents', limit: 25_000, unit: 'events' },
  { name: 'Build Minutes', key: 'buildMinutes', limit: 6000, unit: 'minutes' },
  { name: 'Concurrent Builds', key: 'concurrentBuilds', limit: 1, unit: 'builds' },
  { name: 'Deployments', key: 'deployments', limit: 100, unit: 'per day' },
];

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
   * Fetch usage from the Vercel v2 API.
   * Uses /v2/usage with type=requests and type=builds, which work on Hobby plans
   * (unlike /v1/usage which requires Pro/Enterprise).
   * Returns null if the API is unavailable so the caller can decide whether
   * to require manual data instead.
   */
  async fetchUsage(): Promise<VercelUsageReport | null> {
    const period = this.getCurrentBillingPeriod();

    if (!this.token) {
      console.warn('[VercelUsageService] No VERCEL_API_TOKEN configured');
      return null;
    }

    try {
      const params = new URLSearchParams({
        from: period.start.toISOString(),
        to: period.end.toISOString(),
      });

      const headers = { Authorization: `Bearer ${this.token}` };

      // Fetch requests and builds data in parallel
      const [requestsRes, buildsRes] = await Promise.all([
        fetch(`https://api.vercel.com/v2/usage?type=requests&${params.toString()}`, { headers }),
        fetch(`https://api.vercel.com/v2/usage?type=builds&${params.toString()}`, { headers }),
      ]);

      if (!requestsRes.ok || !buildsRes.ok) {
        const reqBody = !requestsRes.ok ? await requestsRes.text().catch(() => '') : '';
        const buildBody = !buildsRes.ok ? await buildsRes.text().catch(() => '') : '';
        console.warn(
          `[VercelUsageService] v2 API error - requests: ${requestsRes.status} ${reqBody}, builds: ${buildsRes.status} ${buildBody}`
        );
        return null;
      }

      const requestsData = await requestsRes.json();
      const buildsData = await buildsRes.json();

      return this.buildReportFromV2Data(requestsData, buildsData, period);
    } catch (error) {
      console.error('[VercelUsageService] API fetch failed:', error);
      return null;
    }
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
      case 'GB-seconds':
      case 'GB-hours':
        return `${value.toFixed(1)} ${unit}`;
      default:
        return `${value.toLocaleString('en-GB')} ${unit}`;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

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
    // v2 API returns GB-hours, Hobby limit is 1000 GB-hours — no conversion needed
    manualData.functionDurationGbSeconds = totalFnGbHours;
    manualData.dataTransferGb = totalBandwidthBytes / (1024 * 1024 * 1024);

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
