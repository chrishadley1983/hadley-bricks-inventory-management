/**
 * Shared visual metadata for order statuses and platforms.
 *
 * One source of truth for the status lifecycle palette (cards, distribution
 * bars, chips, table badges) and platform brand accents, so every element on
 * the orders page speaks the same colour language.
 */

import type { LucideIcon } from 'lucide-react';
import { Clock, CreditCard, Package, Truck, CheckCircle2, XCircle } from 'lucide-react';

export type UiOrderStatus = 'Pending' | 'Paid' | 'Packed' | 'Shipped' | 'Completed' | 'Cancelled';

export const UI_ORDER_STATUSES: UiOrderStatus[] = [
  'Pending',
  'Paid',
  'Packed',
  'Shipped',
  'Completed',
  'Cancelled',
];

interface StatusMeta {
  label: string;
  /** Shorter/longer override for the summary cards; falls back to label */
  cardLabel?: string;
  icon: LucideIcon;
  /** Text colour for inline chips/links */
  text: string;
  /** Solid segment for distribution bars / dots */
  bar: string;
  /** Tinted icon chip */
  chip: string;
  /** Table badge classes */
  badge: string;
  /** True for statuses that need the seller to act */
  actionable: boolean;
  /** Card surface when actionable work is present */
  activeSurface?: string;
}

// Urgency lives in amber: Paid (awaiting pick) owns the warning colour that the
// dispatch action strip also uses, while inert Pending sits in neutral slate.
export const STATUS_META: Record<UiOrderStatus, StatusMeta> = {
  Pending: {
    label: 'Pending',
    icon: Clock,
    text: 'text-slate-500 dark:text-slate-400',
    bar: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    badge:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    actionable: false,
  },
  Paid: {
    label: 'Paid',
    icon: CreditCard,
    text: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
    badge:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900',
    actionable: true,
    activeSurface: 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30',
  },
  Packed: {
    label: 'Packed',
    icon: Package,
    text: 'text-sky-600 dark:text-sky-400',
    bar: 'bg-sky-500',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
    badge:
      'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900',
    actionable: true,
    activeSurface: 'border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30',
  },
  Shipped: {
    label: 'Shipped',
    icon: Truck,
    text: 'text-blue-600 dark:text-blue-400',
    bar: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
    badge:
      'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900',
    actionable: false,
  },
  Completed: {
    label: 'Completed',
    icon: CheckCircle2,
    text: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    badge:
      'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900',
    actionable: false,
  },
  Cancelled: {
    label: 'Cancelled',
    cardLabel: 'Cancelled / Refunded',
    icon: XCircle,
    text: 'text-rose-600 dark:text-rose-400',
    bar: 'bg-rose-400',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
    badge:
      'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900',
    actionable: false,
  },
};

/** Normalize a raw/effective status string to the UI status it renders as. */
export function toUiStatus(status: string | null): UiOrderStatus {
  const lower = (status || '').toLowerCase();
  if (lower.includes('paid') || lower.includes('payment')) return 'Paid';
  if (lower.includes('completed') || lower.includes('received') || lower.includes('purged')) {
    return 'Completed';
  }
  if (lower.includes('shipped') || lower.includes('dispatched')) return 'Shipped';
  if (lower.includes('packed') || lower.includes('ready') || lower.includes('progress')) {
    return 'Packed';
  }
  if (lower.includes('cancel') || lower.includes('refund') || lower.includes('npb')) {
    return 'Cancelled';
  }
  return 'Pending';
}

export interface PlatformMeta {
  name: string;
  /** Brand accent (hex) used for dots, top rails and count text */
  color: string;
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  bricklink: { name: 'BrickLink', color: '#1E5AA8' },
  brickowl: { name: 'BrickOwl', color: '#E4572E' },
  amazon: { name: 'Amazon', color: '#E88A00' },
  ebay: { name: 'eBay', color: '#E53238' },
  shopify: { name: 'Shopify', color: '#5E8E3E' },
};
