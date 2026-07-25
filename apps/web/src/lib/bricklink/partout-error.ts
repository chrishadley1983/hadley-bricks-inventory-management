/**
 * Partout route error mapping.
 *
 * Both partout routes previously did:
 *
 *   const errorMessage = 'Internal server error';
 *   if (errorMessage.includes('404')) { ... }
 *
 * — a hardcoded literal tested against itself, so the 404 and 429 branches were
 * unreachable and every failure surfaced as an opaque 500. A bad set number, an
 * expired credential and a genuine outage were indistinguishable on screen.
 *
 * This maps the real error to a status and a message that says what went wrong,
 * without leaking stack traces or internals to the client.
 */

import { BrickLinkApiError, RateLimitError } from './client';

export interface PartoutErrorResponse {
  status: number;
  message: string;
}

export function mapPartoutError(error: unknown): PartoutErrorResponse {
  if (error instanceof RateLimitError) {
    return {
      status: 429,
      message: 'BrickLink API rate limit exceeded. Please try again later.',
    };
  }

  if (error instanceof BrickLinkApiError) {
    // BL answers a bad/unknown catalogue item with 400 PARAMETER_MISSING_OR_INVALID
    // ("Invalid item sequence number") or 404 RESOURCE_NOT_FOUND. Both mean the same
    // thing to the user: that set number isn't in BrickLink's catalogue.
    if (error.code === 404 || error.code === 400) {
      return {
        status: 404,
        message: `Set not found on BrickLink${
          error.description ? ` — ${error.description}` : ''
        }. Please check the set number.`,
      };
    }
    if (error.code === 401 || error.code === 403) {
      return {
        status: 502,
        message: 'BrickLink rejected our credentials. Check the BrickLink integration in Settings.',
      };
    }
    return {
      status: 502,
      message: `BrickLink API error (${error.code}): ${error.message}`,
    };
  }

  return { status: 500, message: 'Internal server error' };
}
