'use client';

import { MapPin, Clock, Banknote, MoreHorizontal, CheckCircle, XCircle, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StockPickup } from '@/hooks/use-pickups';
import {
  formatPickupDate,
  formatPickupTime,
  getStatusColor,
  getOutcomeColor,
  isToday,
  isPast,
} from '@/hooks/use-pickups';
import { cn } from '@/lib/utils';

interface PickupCardProps {
  pickup: StockPickup;
  onComplete?: (pickup: StockPickup) => void;
  onCancel?: (pickup: StockPickup) => void;
  onEdit?: (pickup: StockPickup) => void;
  onDelete?: (pickup: StockPickup) => void;
  compact?: boolean;
}

export function PickupCard({
  pickup,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
  compact = false,
}: PickupCardProps) {
  const isPickupToday = isToday(pickup.scheduled_date);
  const isPickupPast = isPast(pickup.scheduled_date);
  const isScheduled = pickup.status === 'scheduled';
  const isCompleted = pickup.status === 'completed';

  const formatCurrency = (value: number | null): string => {
    if (value === null || value === undefined) return '-';
    return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
  };

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center justify-between py-2 px-3 rounded-md border',
          isPickupToday && isScheduled && 'border-primary bg-primary/5',
          isPickupPast && isScheduled && 'border-amber-500 bg-amber-500/5'
        )}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{pickup.title}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatPickupTime(pickup.scheduled_time)}</span>
            <span>·</span>
            <span className="truncate">{pickup.city}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <Badge variant={getStatusColor(pickup.status)}>
            {pickup.status || 'scheduled'}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isScheduled && (
                <DropdownMenuItem onClick={() => onComplete?.(pickup)}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onEdit?.(pickup)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              {isScheduled && (
                <DropdownMenuItem
                  onClick={() => onCancel?.(pickup)}
                  className="text-amber-600"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onDelete?.(pickup)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        'transition-colors',
        isPickupToday && isScheduled && 'border-primary',
        isPickupPast && isScheduled && 'border-amber-500'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium truncate">{pickup.title}</h4>
              <Badge variant={getStatusColor(pickup.status)}>
                {pickup.status || 'scheduled'}
              </Badge>
              {isCompleted && pickup.outcome && (
                <Badge variant={getOutcomeColor(pickup.outcome)}>
                  {pickup.outcome}
                </Badge>
              )}
            </div>

            {pickup.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                {pickup.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {formatPickupDate(pickup.scheduled_date)}{' '}
                  {formatPickupTime(pickup.scheduled_time)}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                <span className="truncate max-w-[200px]">
                  {pickup.city}, {pickup.postcode}
                </span>
              </div>

              {(pickup.estimated_value || pickup.agreed_price || pickup.final_amount_paid) && (
                <div className="flex items-center gap-1">
                  <Banknote className="h-3.5 w-3.5" />
                  <span>
                    {isCompleted
                      ? formatCurrency(pickup.final_amount_paid)
                      : pickup.agreed_price
                        ? formatCurrency(pickup.agreed_price)
                        : `Est. ${formatCurrency(pickup.estimated_value)}`}
                  </span>
                </div>
              )}
            </div>

            {pickup.notes && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                {pickup.notes}
              </p>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isScheduled && (
                <DropdownMenuItem onClick={() => onComplete?.(pickup)}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete Pickup
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onEdit?.(pickup)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Details
              </DropdownMenuItem>
              {isScheduled && (
                <DropdownMenuItem
                  onClick={() => onCancel?.(pickup)}
                  className="text-amber-600"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel Pickup
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onDelete?.(pickup)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
