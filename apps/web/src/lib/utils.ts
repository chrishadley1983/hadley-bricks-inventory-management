import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Resolve after `ms` milliseconds. Shared replacement for the per-client
 * `private sleep()` helpers / inline `new Promise(r => setTimeout(r, ms))`.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a number as currency (GBP)
 */
export function formatCurrency(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount == null) return '—';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(num);
}

/**
 * Format a date string for display
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString));
}

/**
 * Format a relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

/**
 * Vinted delivery status strings that indicate package has arrived
 */
const VINTED_DELIVERED_STATUSES = ['package delivered', 'delivered'] as const;

/**
 * Derive inventory status from Vinted delivery status.
 * Returns 'BACKLOG' if delivered, 'NOT YET RECEIVED' otherwise.
 */
export function deriveInventoryStatusFromVinted(vintedStatus: string): string {
  const normalized = vintedStatus.toLowerCase();
  if (VINTED_DELIVERED_STATUSES.some((s) => normalized.includes(s))) {
    return 'BACKLOG';
  }
  return 'NOT YET RECEIVED';
}
