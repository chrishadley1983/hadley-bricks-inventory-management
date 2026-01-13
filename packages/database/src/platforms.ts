/**
 * Centralized platform definitions for the Hadley Bricks application.
 *
 * Platform tiers:
 * - ALL_PLATFORMS: All integrated platforms (for credentials, orders, sync)
 * - SELLING_PLATFORMS: Platforms where inventory is listed for sale
 * - TARGET_PLATFORMS: Platforms supported by purchase evaluator price lookups
 */

// Tier 1: All platforms (integration sources)
export const ALL_PLATFORMS = ['amazon', 'ebay', 'bricklink', 'brickowl', 'bricqer'] as const;
export type AllPlatform = (typeof ALL_PLATFORMS)[number];

// Tier 2: Selling platforms (where user lists inventory)
export const SELLING_PLATFORMS = ['amazon', 'ebay', 'bricklink'] as const;
export type SellingPlatform = (typeof SELLING_PLATFORMS)[number];

// Tier 3: Target platforms (purchase evaluator - Amazon/eBay only)
export const TARGET_PLATFORMS = ['amazon', 'ebay'] as const;
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

/**
 * Display labels for platforms (user-facing)
 */
export const PLATFORM_LABELS: Record<AllPlatform, string> = {
  amazon: 'Amazon',
  ebay: 'eBay',
  bricklink: 'BrickLink',
  brickowl: 'Brick Owl',
  bricqer: 'Bricqer',
};

/**
 * Get display label for a platform
 */
export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as AllPlatform] || platform;
}

/**
 * Check if a value is a valid selling platform
 */
export function isSellingPlatform(value: string): value is SellingPlatform {
  return SELLING_PLATFORMS.includes(value as SellingPlatform);
}

/**
 * Check if a value is a valid target platform
 */
export function isTargetPlatform(value: string): value is TargetPlatform {
  return TARGET_PLATFORMS.includes(value as TargetPlatform);
}

/**
 * Check if a value is any valid platform
 */
export function isValidPlatform(value: string): value is AllPlatform {
  return ALL_PLATFORMS.includes(value as AllPlatform);
}

// Backward compatibility - Platform type alias
export type Platform = AllPlatform;
