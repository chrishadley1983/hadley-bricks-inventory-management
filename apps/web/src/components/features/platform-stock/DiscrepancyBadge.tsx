'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DiscrepancyType } from '@/lib/platform-stock';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  AlertTriangle,
  MinusCircle,
  Link2Off,
} from 'lucide-react';

interface DiscrepancyBadgeProps {
  type: DiscrepancyType;
  showLabel?: boolean;
  className?: string;
}

const discrepancyConfig: Record<
  DiscrepancyType,
  {
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    iconClassName: string;
  }
> = {
  match: {
    label: 'Matched',
    shortLabel: 'OK',
    icon: CheckCircle2,
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
    iconClassName: 'text-green-600 dark:text-green-400',
  },
  platform_only: {
    label: 'Platform Only',
    shortLabel: 'Platform',
    icon: AlertCircle,
    className:
      'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800',
    iconClassName: 'text-orange-600 dark:text-orange-400',
  },
  inventory_only: {
    label: 'Inventory Only',
    shortLabel: 'Inventory',
    icon: XCircle,
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
    iconClassName: 'text-red-600 dark:text-red-400',
  },
  quantity_mismatch: {
    label: 'Quantity Mismatch',
    shortLabel: 'Qty',
    icon: AlertTriangle,
    className:
      'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800',
    iconClassName: 'text-yellow-600 dark:text-yellow-400',
  },
  price_mismatch: {
    label: 'Price Mismatch',
    shortLabel: 'Price',
    icon: MinusCircle,
    className:
      'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800',
    iconClassName: 'text-blue-600 dark:text-blue-400',
  },
  missing_asin: {
    label: 'Missing ASIN',
    shortLabel: 'No ASIN',
    icon: Link2Off,
    className:
      'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800',
    iconClassName: 'text-purple-600 dark:text-purple-400',
  },
};

export function DiscrepancyBadge({ type, showLabel = true, className }: DiscrepancyBadgeProps) {
  const config = discrepancyConfig[type];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, 'gap-1', className)}>
      <Icon className={cn('h-3 w-3', config.iconClassName)} />
      {showLabel && <span>{config.shortLabel}</span>}
    </Badge>
  );
}

export function DiscrepancyBadgeFull({
  type,
  className,
}: Omit<DiscrepancyBadgeProps, 'showLabel'>) {
  const config = discrepancyConfig[type];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(config.className, 'gap-1.5', className)}>
      <Icon className={cn('h-3.5 w-3.5', config.iconClassName)} />
      <span>{config.label}</span>
    </Badge>
  );
}

export function getDiscrepancyLabel(type: DiscrepancyType): string {
  return discrepancyConfig[type].label;
}

export function getDiscrepancyColor(type: DiscrepancyType): string {
  return discrepancyConfig[type].className;
}
