/**
 * OAuth Token Manager
 *
 * Shared skeleton for the OAuth access-token control flow duplicated across
 * the platform auth services (PayPal, eBay, Google Calendar, Monzo):
 *
 *   check expiry (with per-service buffer)
 *     -> still valid: return the stored token
 *     -> expired/near expiry: delegate to the service's refresh strategy
 *
 * Everything platform-specific stays inside each service's `refresh` callback:
 * token endpoint URL, grant type, auth headers, scope handling, encryption
 * (lib/crypto), persistence (table/columns, error semantics) and logging.
 * The manager owns ONLY the genuinely shared control flow and preserves the
 * exact null-on-failure semantics of the original services.
 *
 * IMPORTANT — there are two subtly different expiry comparisons in the wild,
 * preserved here verbatim (see `validityCheck` below):
 *
 * - eBay / Google Calendar / Monzo refresh when the remaining lifetime is
 *   STRICTLY LESS THAN the buffer (`isTokenExpired`). A remaining lifetime
 *   exactly equal to the buffer — or an unparseable expiry (NaN) — keeps the
 *   stored token.
 * - PayPal keeps the stored token only when it is STRICTLY MORE THAN the
 *   buffer away from expiry AND both the token and expiry are present
 *   (`isTokenFresh`). A remaining lifetime exactly equal to the buffer — or
 *   an unparseable/missing expiry or missing token — triggers a refresh.
 *
 * These are intentionally NOT negations of each other; do not "simplify" one
 * into the other.
 */

// ============================================================================
// Expiry predicates
// ============================================================================

/**
 * Returns true when the token's remaining lifetime is strictly less than
 * `bufferMs` (i.e. it has expired or is about to expire).
 *
 * NaN semantics (unparseable date): returns false — the token is treated as
 * still valid. This matches the original inline checks in the eBay, Google
 * Calendar and Monzo services.
 */
export function isTokenExpired(expiresAt: string | Date, bufferMs = 0): boolean {
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}

/**
 * Returns true when the token's remaining lifetime is strictly more than
 * `bufferMs` (i.e. it is safely usable without a refresh).
 *
 * NaN semantics (unparseable date): returns false — the token is treated as
 * NOT fresh, triggering a refresh. This matches the original inline check in
 * the PayPal service.
 *
 * Note: `!isTokenFresh(x, b)` is not the same as `isTokenExpired(x, b)` when
 * the remaining lifetime equals the buffer exactly, or when the date is
 * unparseable.
 */
export function isTokenFresh(expiresAt: string | Date, bufferMs = 0): boolean {
  return new Date(expiresAt).getTime() - Date.now() > bufferMs;
}

// ============================================================================
// Shared getAccessToken control flow
// ============================================================================

export interface GetValidAccessTokenOptions {
  /** The currently stored access token (returned as-is while still valid). */
  accessToken: string | null | undefined;
  /** When the stored access token expires (ISO string or Date). */
  expiresAt: string | Date | null | undefined;
  /** Per-service refresh buffer in milliseconds (e.g. PayPal 5 min, eBay 10 min). */
  refreshBufferMs?: number;
  /**
   * Which validity comparison to use for the stored token:
   *
   * - 'expired-check' (default): keep the token unless
   *   `isTokenExpired(expiresAt, refreshBufferMs)` — eBay / Google Calendar
   *   semantics. No presence guard is applied to `accessToken`/`expiresAt`;
   *   they pass straight through to the Date comparison exactly as the
   *   original inline code did.
   * - 'fresh-check': keep the token only when `accessToken` and `expiresAt`
   *   are both truthy AND `isTokenFresh(expiresAt, refreshBufferMs)` — PayPal
   *   semantics.
   */
  validityCheck?: 'expired-check' | 'fresh-check';
  /**
   * Refresh strategy, called only when the stored token is not usable.
   * Must perform the platform-specific token-endpoint call, persistence
   * (including any encryption) and logging, and return the new access token —
   * or null on failure (the manager returns that null unchanged).
   */
  refresh: () => Promise<string | null>;
}

/**
 * Shared skeleton: return the stored access token while it is still valid,
 * otherwise delegate to the service's refresh strategy.
 */
export async function getValidAccessToken(
  options: GetValidAccessTokenOptions
): Promise<string | null> {
  const { accessToken, expiresAt, refresh, refreshBufferMs = 0 } = options;
  const validityCheck = options.validityCheck ?? 'expired-check';

  if (validityCheck === 'fresh-check') {
    // PayPal semantics: keep only when token + expiry are present and the
    // token is strictly more than the buffer away from expiry.
    if (accessToken && expiresAt && isTokenFresh(expiresAt, refreshBufferMs)) {
      return accessToken;
    }
    return refresh();
  }

  // eBay / Google Calendar semantics: refresh only when strictly inside the
  // buffer. `expiresAt` is passed through unchecked so null/undefined behave
  // exactly as the original inline `new Date(...)` comparisons did.
  if (isTokenExpired(expiresAt as string | Date, refreshBufferMs)) {
    return refresh();
  }

  return accessToken ?? null;
}
