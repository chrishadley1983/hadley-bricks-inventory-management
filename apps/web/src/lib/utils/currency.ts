/**
 * Shared currency parsing helper.
 *
 * Consolidates the previously-duplicated `parseCurrencyValue` implementations
 * from the BrickLink / BrickOwl / Bricqer transaction types and adapters.
 *
 * Strips any non-numeric characters (currency symbols, thousands separators,
 * whitespace) from a value and returns a number, defaulting to 0 for
 * null/undefined/empty/non-numeric input. Numbers are returned unchanged.
 */
export function parseCurrencyValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
