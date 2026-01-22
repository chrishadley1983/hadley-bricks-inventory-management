/**
 * Vinted Automation Types
 *
 * Shared types for the Vinted automation system.
 * Used by both the server API and Windows tray application.
 */

import { z } from 'zod';

// ============================================================================
// CLI5-CLI6: ScanResult Schema
// ============================================================================

/**
 * Individual listing found during a scan
 */
export const ListingSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string().default('GBP'),
  url: z.string().url(),
  vintedListingId: z.string(),
  listedAt: z.string().nullish(), // ISO timestamp if available, C# sends null
  imageUrl: z.string().nullish(), // C# sends null, not undefined
});

export type Listing = z.infer<typeof ListingSchema>;

/**
 * Result of a Claude CLI scan execution
 * This is what the Windows app sends to POST /automation/process
 */
export const ScanResultSchema = z.object({
  success: z.boolean(),
  captchaDetected: z.boolean().default(false),
  listings: z.array(ListingSchema).default([]),
  pagesScanned: z.number().default(0),
  error: z.string().nullish(), // C# sends null, not undefined
  timingDelayMs: z.number().nullish(), // C# sends null, not undefined
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

// ============================================================================
// PROC1-PROC4: Process API Request Schema
// ============================================================================

/**
 * Request body for POST /automation/process
 */
export const ProcessRequestSchema = z.object({
  scanId: z.string(), // Matches schedule scan ID
  scanType: z.enum(['broad_sweep', 'watchlist']),
  setNumber: z.string().nullish(), // Required for watchlist scans, null for broad_sweep
  result: ScanResultSchema,
});

export type ProcessRequest = z.infer<typeof ProcessRequestSchema>;

/**
 * Response from POST /automation/process
 */
export interface ProcessResponse {
  success: boolean;
  opportunitiesFound: number;
  alertsSent: number;
  scanLogId: string;
}

// ============================================================================
// Config API Types
// ============================================================================

/**
 * Response from GET /automation/config
 */
export interface ConfigResponse {
  enabled: boolean;
  paused: boolean;
  pauseReason?: string;
  broadSweepCogThreshold: number;
  watchlistCogThreshold: number;
  nearMissThreshold: number;
  operatingHoursStart: string;
  operatingHoursEnd: string;
  configVersion: number;
  scheduleVersion: number;
  // Recovery mode info (DataDome hardening)
  recoveryMode: boolean;
  recoveryRatePercent: number;
  captchaDetectedAt?: string;
  captchaCount30d: number;
  // Today's counts (for scanner to restore state on restart)
  scansToday?: number;
  opportunitiesToday?: number;
}

// ============================================================================
// Heartbeat API Types
// ============================================================================

/**
 * Request body for POST /automation/heartbeat
 */
export const HeartbeatRequestSchema = z.object({
  machineId: z.string(),
  machineName: z.string().nullish(),
  status: z.enum(['running', 'paused', 'error', 'outside_hours']),
  lastScanAt: z.string().nullish(), // ISO timestamp
  scansToday: z.number().default(0),
  opportunitiesToday: z.number().default(0),
  errorMessage: z.string().nullish(),
});

export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

/**
 * Response from POST /automation/heartbeat
 */
export interface HeartbeatResponse {
  configVersion: number;
  scheduleVersion: number;
  serverTime: string; // ISO timestamp for clock sync
}

// ============================================================================
// Schedule API Types (re-exported from service)
// ============================================================================

export { type ScheduleResponse, type ScheduledScan } from '@/lib/services/vinted-schedule.service';

// ============================================================================
// Connection Status Types (for Dashboard)
// ============================================================================

/**
 * Connection status for dashboard display
 */
export interface ConnectionStatus {
  connected: boolean;
  lastSeenAt?: Date;
  machineId?: string;
  machineName?: string;
  status?: 'running' | 'paused' | 'error' | 'outside_hours' | 'disconnected';
  scansToday?: number;
  opportunitiesToday?: number;
  lastScanAt?: Date;
}
