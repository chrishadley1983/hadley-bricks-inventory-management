/**
 * Unified Order Sync Service
 *
 * Coordinates order syncing across multiple platforms (BrickLink, Brick Owl, etc.).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Platform } from '@hadley-bricks/database';
import { BrickLinkSyncService } from './bricklink-sync.service';
import { BrickOwlSyncService } from './brickowl-sync.service';
import { BricqerSyncService } from './bricqer-sync.service';
import { AmazonSyncService } from './amazon-sync.service';
import { CredentialsRepository } from '../repositories';
import type {
  SyncResult,
  UnifiedSyncOptions,
  UnifiedSyncResult,
  PlatformSyncStatus,
} from '../adapters/platform-adapter.interface';

/**
 * Service for syncing orders across all platforms
 */
export class OrderSyncService {
  private brickLinkSync: BrickLinkSyncService;
  private brickOwlSync: BrickOwlSyncService;
  private bricqerSync: BricqerSyncService;
  private amazonSync: AmazonSyncService;
  private credentialsRepo: CredentialsRepository;

  constructor(private supabase: SupabaseClient<Database>) {
    this.brickLinkSync = new BrickLinkSyncService(supabase);
    this.brickOwlSync = new BrickOwlSyncService(supabase);
    this.bricqerSync = new BricqerSyncService(supabase);
    this.amazonSync = new AmazonSyncService(supabase);
    this.credentialsRepo = new CredentialsRepository(supabase);
  }

  /**
   * Get all configured platforms for a user
   */
  async getConfiguredPlatforms(userId: string): Promise<Platform[]> {
    return this.credentialsRepo.getConfiguredPlatforms(userId);
  }

  /**
   * Get sync status for a specific platform
   */
  async getPlatformSyncStatus(userId: string, platform: Platform): Promise<PlatformSyncStatus> {
    try {
      switch (platform) {
        case 'bricklink': {
          const status = await this.brickLinkSync.getSyncStatus(userId);
          return {
            platform,
            isConfigured: status.isConfigured,
            totalOrders: status.totalOrders,
            lastSyncedAt: status.lastSyncedAt,
            connectionStatus: status.isConfigured ? 'connected' : 'disconnected',
          };
        }
        case 'brickowl': {
          const status = await this.brickOwlSync.getSyncStatus(userId);
          return {
            platform,
            isConfigured: status.isConfigured,
            totalOrders: status.totalOrders,
            lastSyncedAt: status.lastSyncedAt,
            connectionStatus: status.isConfigured ? 'connected' : 'disconnected',
          };
        }
        case 'bricqer': {
          const status = await this.bricqerSync.getSyncStatus(userId);
          return {
            platform,
            isConfigured: status.isConfigured,
            totalOrders: status.totalOrders,
            lastSyncedAt: status.lastSyncedAt,
            connectionStatus: status.isConfigured ? 'connected' : 'disconnected',
          };
        }
        case 'amazon': {
          const status = await this.amazonSync.getSyncStatus(userId);
          return {
            platform,
            isConfigured: status.isConfigured,
            totalOrders: status.totalOrders,
            lastSyncedAt: status.lastSyncedAt,
            connectionStatus: status.isConfigured ? 'connected' : 'disconnected',
          };
        }
        default:
          return {
            platform,
            isConfigured: false,
            totalOrders: 0,
            lastSyncedAt: null,
            connectionStatus: 'disconnected',
          };
      }
    } catch (error) {
      return {
        platform,
        isConfigured: false,
        totalOrders: 0,
        lastSyncedAt: null,
        connectionStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get sync status for all platforms
   */
  async getAllPlatformStatuses(userId: string): Promise<Map<Platform, PlatformSyncStatus>> {
    const platforms: Platform[] = ['bricklink', 'brickowl', 'bricqer', 'ebay', 'amazon'];
    const statuses = new Map<Platform, PlatformSyncStatus>();

    await Promise.all(
      platforms.map(async (platform) => {
        const status = await this.getPlatformSyncStatus(userId, platform);
        statuses.set(platform, status);
      })
    );

    return statuses;
  }

  /**
   * Sync orders from a specific platform
   */
  async syncFromPlatform(
    userId: string,
    platform: Platform,
    options?: UnifiedSyncOptions
  ): Promise<SyncResult> {
    switch (platform) {
      case 'bricklink': {
        const result = await this.brickLinkSync.syncOrders(userId, {
          includeFiled: options?.includeArchived,
          fullSync: options?.fullSync,
          includeItems: options?.includeItems ?? true,
        });
        return { ...result, platform };
      }
      case 'brickowl': {
        const result = await this.brickOwlSync.syncOrders(userId, {
          fullSync: options?.fullSync,
          includeItems: options?.includeItems ?? true,
        });
        return { ...result, platform };
      }
      case 'bricqer': {
        const result = await this.bricqerSync.syncOrders(userId, {
          fullSync: options?.fullSync,
          includeItems: options?.includeItems ?? true,
        });
        return { ...result, platform };
      }
      case 'amazon': {
        // Default to NOT fetching items - too slow with 400+ orders and hits rate limits
        // Items can be fetched on-demand when confirming individual orders
        const result = await this.amazonSync.syncOrders(userId, {
          includeItems: options?.includeItems ?? false,
          fullSync: options?.fullSync,
        });
        return { ...result, platform };
      }
      default:
        return {
          success: false,
          platform,
          ordersProcessed: 0,
          ordersCreated: 0,
          ordersUpdated: 0,
          errors: [`Platform ${platform} sync not implemented`],
          lastSyncedAt: new Date(),
        };
    }
  }

  /**
   * Sync orders from all configured platforms
   */
  async syncAllPlatforms(userId: string, options?: UnifiedSyncOptions): Promise<UnifiedSyncResult> {
    const results = new Map<Platform, SyncResult>();
    const errors: string[] = [];
    let totalOrdersProcessed = 0;
    let totalOrdersCreated = 0;
    let totalOrdersUpdated = 0;

    // Get platforms to sync
    let platformsToSync: Platform[];
    if (options?.platforms && options.platforms.length > 0) {
      platformsToSync = options.platforms;
    } else {
      platformsToSync = await this.getConfiguredPlatforms(userId);
    }

    // Sync each platform (in parallel for speed, but collect errors gracefully)
    const syncPromises = platformsToSync.map(async (platform) => {
      try {
        const result = await this.syncFromPlatform(userId, platform, options);
        results.set(platform, result);

        totalOrdersProcessed += result.ordersProcessed;
        totalOrdersCreated += result.ordersCreated;
        totalOrdersUpdated += result.ordersUpdated;

        if (result.errors.length > 0) {
          errors.push(...result.errors.map((e) => `[${platform}] ${e}`));
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`[${platform}] Sync failed: ${errorMsg}`);
        results.set(platform, {
          success: false,
          platform,
          ordersProcessed: 0,
          ordersCreated: 0,
          ordersUpdated: 0,
          errors: [errorMsg],
          lastSyncedAt: new Date(),
        });
      }
    });

    await Promise.all(syncPromises);

    return {
      success: errors.length === 0,
      results,
      totalOrdersProcessed,
      totalOrdersCreated,
      totalOrdersUpdated,
      errors,
      syncedAt: new Date(),
    };
  }

  /**
   * Test connection for a specific platform
   */
  async testPlatformConnection(userId: string, platform: Platform): Promise<boolean> {
    switch (platform) {
      case 'bricklink':
        return this.brickLinkSync.testConnection(userId);
      case 'brickowl':
        return this.brickOwlSync.testConnection(userId);
      case 'bricqer':
        return this.bricqerSync.testConnection(userId);
      case 'amazon':
        return this.amazonSync.testConnection(userId);
      default:
        return false;
    }
  }
}
