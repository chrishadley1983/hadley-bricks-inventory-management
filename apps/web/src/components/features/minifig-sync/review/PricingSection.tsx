'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Pencil } from 'lucide-react';
import { formatCurrency } from './utils';
import type { MinifigSyncItem } from '@/lib/minifig-sync/types';

interface PricingSectionProps {
  item: MinifigSyncItem;
  onUpdate: (data: {
    price?: number;
    bestOfferAutoAccept?: number;
    bestOfferAutoDecline?: number;
  }) => void;
  isUpdating?: boolean;
}

function EditablePrice({
  label,
  value,
  onSave,
  isUpdating,
  highlight,
  size = 'sm',
}: {
  label: string;
  value: number | string | null | undefined;
  onSave: (val: number) => void;
  isUpdating?: boolean;
  highlight?: boolean;
  size?: 'sm' | 'lg';
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleStart = () => {
    setEditValue(value != null ? String(value) : '');
    setIsEditing(true);
  };

  const handleSave = () => {
    const num = parseFloat(editValue);
    if (!isNaN(num) && num > 0) {
      onSave(num);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div>
        <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
        <div className="flex items-center gap-1">
          <span className="text-xs">£</span>
          <Input
            type="number"
            step="0.01"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className="h-7 w-20 text-xs"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleSave}
            disabled={isUpdating}
          >
            <Check className="h-3 w-3 text-green-600" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
      <div className="group flex items-center gap-1 cursor-pointer" onClick={handleStart}>
        <p
          className={`${size === 'lg' ? 'text-lg' : 'text-sm'} font-bold ${
            highlight ? 'text-green-600' : ''
          }`}
        >
          {formatCurrency(value)}
        </p>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 shrink-0" />
      </div>
    </div>
  );
}

export function PricingSection({ item, onUpdate, isUpdating }: PricingSectionProps) {
  return (
    <div className="space-y-4">
      <span className="text-sm font-medium text-muted-foreground">Pricing</span>

      {/* Primary prices */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Bricqer Price</p>
          <p className="text-lg font-bold">{formatCurrency(item.bricqer_price)}</p>
        </div>
        <EditablePrice
          label="Recommended Price"
          value={item.recommended_price}
          onSave={(price) => onUpdate({ price })}
          isUpdating={isUpdating}
          highlight
          size="lg"
        />
      </div>

      {/* Best offer thresholds */}
      <div className="grid grid-cols-2 gap-4">
        <EditablePrice
          label="Best Offer Accept"
          value={item.best_offer_auto_accept}
          onSave={(bestOfferAutoAccept) => onUpdate({ bestOfferAutoAccept })}
          isUpdating={isUpdating}
        />
        <EditablePrice
          label="Best Offer Decline"
          value={item.best_offer_auto_decline}
          onSave={(bestOfferAutoDecline) => onUpdate({ bestOfferAutoDecline })}
          isUpdating={isUpdating}
        />
      </div>

      {/* Market data */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Market Data</p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Avg Sold</p>
            <p className="font-medium">{formatCurrency(item.ebay_avg_sold_price)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sold Count</p>
            <p className="font-medium">{item.ebay_sold_count ?? '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Active</p>
            <p className="font-medium">{item.ebay_active_count ?? '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sell-through</p>
            <p className="font-medium">
              {item.ebay_sell_through_rate != null
                ? `${Number(item.ebay_sell_through_rate).toFixed(0)}%`
                : '-'}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-muted-foreground">Price Range</p>
            <p className="font-medium">
              {formatCurrency(item.ebay_min_sold_price)} –{' '}
              {formatCurrency(item.ebay_max_sold_price)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
