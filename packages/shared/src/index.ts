/**
 * Shared utilities and types for Hadley Bricks
 */

/**
 * Format currency value to GBP
 */
export function formatCurrency(amount: number, currency: string = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Format date to UK locale
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Generate a unique SKU for inventory items
 */
export function generateSKU(condition: 'New' | 'Used', setNumber: string, index: number): string {
  const prefix = condition === 'New' ? 'HB-NEW' : 'HB-USED';
  const paddedIndex = String(index).padStart(3, '0');
  return `${prefix}-${setNumber}-${paddedIndex}`;
}
