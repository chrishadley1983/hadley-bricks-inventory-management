/**
 * Rate Limiting Utility
 *
 * Implements token bucket rate limiting for API routes.
 * Uses in-memory storage (suitable for single-server deployments).
 * For production with multiple servers, consider Redis-based implementation.
 */

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
}

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

// In-memory store for rate limit entries
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  const expiryTime = now - windowMs * 2;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.lastRefill < expiryTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check if a request is rate limited
 * Returns the number of remaining requests, or -1 if rate limited
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetIn: number } {
  const { limit, windowMs } = config;
  const now = Date.now();

  cleanup(windowMs);

  const entry = rateLimitStore.get(identifier);

  if (!entry) {
    // First request from this identifier
    rateLimitStore.set(identifier, {
      tokens: limit - 1,
      lastRefill: now,
    });
    return { allowed: true, remaining: limit - 1, resetIn: windowMs };
  }

  // Calculate tokens to refill based on elapsed time
  const elapsed = now - entry.lastRefill;
  const tokensToAdd = Math.floor((elapsed / windowMs) * limit);

  if (tokensToAdd > 0) {
    entry.tokens = Math.min(limit, entry.tokens + tokensToAdd);
    entry.lastRefill = now;
  }

  if (entry.tokens > 0) {
    entry.tokens--;
    return {
      allowed: true,
      remaining: entry.tokens,
      resetIn: Math.ceil(windowMs - elapsed),
    };
  }

  // Rate limited
  const resetIn = Math.ceil(windowMs - elapsed);
  return { allowed: false, remaining: 0, resetIn };
}

/**
 * Standard rate limit configurations
 */
export const RateLimits = {
  /** Standard API endpoint: 100 requests per minute */
  standard: { limit: 100, windowMs: 60 * 1000 },

  /** Strict rate limit for sensitive operations: 10 requests per minute */
  strict: { limit: 10, windowMs: 60 * 1000 },

  /** Auth endpoints: 5 attempts per 15 minutes */
  auth: { limit: 5, windowMs: 15 * 60 * 1000 },

  /** Sync operations: 10 per hour */
  sync: { limit: 10, windowMs: 60 * 60 * 1000 },

  /** Report generation: 30 per minute */
  reports: { limit: 30, windowMs: 60 * 1000 },
} as const;

/**
 * Get rate limit identifier from request
 * Uses IP address or user ID if available
 */
export function getRateLimitIdentifier(request: Request, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }

  // Try to get IP from headers (common in production behind proxies)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return `ip:${forwarded.split(',')[0].trim()}`;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return `ip:${realIp}`;
  }

  // Fallback to a generic identifier
  return 'ip:unknown';
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(
  remaining: number,
  limit: number,
  resetIn: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': limit.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + resetIn / 1000).toString(),
  };
}
