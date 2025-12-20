/**
 * API Utilities
 *
 * Common utilities for API route handlers.
 */

import { NextResponse } from 'next/server';
import {
  checkRateLimit,
  getRateLimitIdentifier,
  createRateLimitHeaders,
  RateLimits,
} from './rate-limit';

type RateLimitType = keyof typeof RateLimits;

interface RateLimitOptions {
  /** Rate limit configuration name */
  type?: RateLimitType;
  /** Custom rate limit config */
  config?: { limit: number; windowMs: number };
  /** User ID for user-specific rate limiting */
  userId?: string;
}

/**
 * Check rate limit and return error response if exceeded
 * Returns null if request is allowed, or NextResponse if rate limited
 */
export function withRateLimit(
  request: Request,
  options: RateLimitOptions = {}
): NextResponse | null {
  const { type = 'standard', config, userId } = options;
  const rateLimitConfig = config || RateLimits[type];
  const identifier = getRateLimitIdentifier(request, userId);

  const { allowed, remaining, resetIn } = checkRateLimit(
    identifier,
    rateLimitConfig
  );

  if (!allowed) {
    return NextResponse.json(
      {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(resetIn / 1000),
      },
      {
        status: 429,
        headers: createRateLimitHeaders(remaining, rateLimitConfig.limit, resetIn),
      }
    );
  }

  return null;
}

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  request: Request,
  options: RateLimitOptions = {}
): NextResponse {
  const { type = 'standard', config, userId } = options;
  const rateLimitConfig = config || RateLimits[type];
  const identifier = getRateLimitIdentifier(request, userId);

  const { remaining, resetIn } = checkRateLimit(identifier, rateLimitConfig);

  const headers = createRateLimitHeaders(
    remaining,
    rateLimitConfig.limit,
    resetIn
  );

  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

/**
 * Standard error response format
 */
export function errorResponse(
  message: string,
  status: number = 500,
  details?: Record<string, unknown>
): NextResponse {
  const body: { error: string; details?: Record<string, unknown> } = {
    error: message,
  };
  if (details) {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

/**
 * Standard success response format
 */
export function successResponse<T>(
  data: T,
  status: number = 200
): NextResponse {
  return NextResponse.json({ data }, { status });
}
