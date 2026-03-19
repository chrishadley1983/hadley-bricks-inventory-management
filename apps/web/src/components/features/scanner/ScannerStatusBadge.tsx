'use client';

import { Badge } from '@/components/ui/badge';

type ScannerStatus = 'completed' | 'scanning' | 'paused' | 'calibrating' | 'aborted';

// Badge variants supported: default (primary/green), secondary (muted), outline, destructive
const statusConfig: Record<
  ScannerStatus,
  { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }
> = {
  completed: { variant: 'default', label: 'Completed' },
  scanning: { variant: 'secondary', label: 'Scanning' },
  paused: { variant: 'secondary', label: 'Paused' },
  calibrating: { variant: 'outline', label: 'Calibrating' },
  aborted: { variant: 'destructive', label: 'Aborted' },
};

interface ScannerStatusBadgeProps {
  status: string;
}

export function ScannerStatusBadge({ status }: ScannerStatusBadgeProps) {
  const config = statusConfig[status as ScannerStatus] ?? {
    variant: 'outline' as const,
    label: status,
  };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
