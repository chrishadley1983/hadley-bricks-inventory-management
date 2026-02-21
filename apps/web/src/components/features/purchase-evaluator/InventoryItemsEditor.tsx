'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wand2 } from 'lucide-react';
import { SELLING_PLATFORMS, PLATFORM_LABELS, type SellingPlatform } from '@hadley-bricks/database';
import type { EditableInventoryItem } from '@/lib/purchase-evaluator';

const STATUS_OPTIONS = [
  { value: 'NOT YET RECEIVED', label: 'Not Yet Received' },
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'LISTED', label: 'Listed' },
] as const;

const CONDITION_OPTIONS = [
  { value: 'New', label: 'New' },
  { value: 'Used', label: 'Used' },
] as const;

interface InventoryItemsEditorProps {
  items: EditableInventoryItem[];
  onChange: (items: EditableInventoryItem[]) => void;
}

export function InventoryItemsEditor({ items, onChange }: InventoryItemsEditorProps) {
  const [bulkStorageLocation, setBulkStorageLocation] = React.useState('');
  const [bulkStatus, setBulkStatus] = React.useState<string>('');

  const handleItemChange = React.useCallback(
    (index: number, field: keyof EditableInventoryItem, value: string | number | null) => {
      const updatedItems = [...items];
      updatedItems[index] = {
        ...updatedItems[index],
        [field]: value,
      };
      onChange(updatedItems);
    },
    [items, onChange]
  );

  const handleApplyBulkStorageLocation = React.useCallback(() => {
    if (!bulkStorageLocation) return;
    const updatedItems = items.map((item) => ({
      ...item,
      storage_location: bulkStorageLocation,
    }));
    onChange(updatedItems);
  }, [items, onChange, bulkStorageLocation]);

  const handleApplyBulkStatus = React.useCallback(() => {
    if (!bulkStatus) return;
    const updatedItems = items.map((item) => ({
      ...item,
      status: bulkStatus,
    }));
    onChange(updatedItems);
  }, [items, onChange, bulkStatus]);

  return (
    <div className="space-y-4">
      {/* Bulk Actions Toolbar */}
      <Card className="bg-muted/50">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">Bulk Actions</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Storage location..."
                value={bulkStorageLocation}
                onChange={(e) => setBulkStorageLocation(e.target.value)}
                className="w-48"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleApplyBulkStorageLocation}
                disabled={!bulkStorageLocation}
              >
                <Wand2 className="mr-1 h-3 w-3" />
                Apply to All
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status..." />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleApplyBulkStatus}
                disabled={!bulkStatus}
              >
                <Wand2 className="mr-1 h-3 w-3" />
                Apply to All
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items List */}
      <ScrollArea className="h-[400px] rounded-md border p-4">
        <div className="space-y-4">
          {items.map((item, index) => (
            <Card key={`${item.sourceItemId}-${item.rowIndex}`} className="relative">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">
                  <span className="text-muted-foreground">#{index + 1}</span>{' '}
                  <span className="font-mono">{item.set_number}</span>
                  {item.item_name && (
                    <span className="ml-2 font-normal text-muted-foreground">{item.item_name}</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Row 1: Set Number (read-only), Item Name, Condition, Status */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Set Number</Label>
                    <Input value={item.set_number} disabled className="bg-muted" />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Item Name</Label>
                    <Input
                      value={item.item_name}
                      onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                      placeholder="Item name"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Condition</Label>
                    <Select
                      value={item.condition || ''}
                      onValueChange={(val: string) =>
                        handleItemChange(index, 'condition', val as 'New' | 'Used' | null)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select
                      value={item.status}
                      onValueChange={(val: string) => handleItemChange(index, 'status', val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Row 2: Cost, Listing Value, Platform, Storage */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Cost (GBP)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.cost ?? ''}
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          'cost',
                          e.target.value ? parseFloat(e.target.value) : null
                        )
                      }
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Listing Value (GBP)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.listing_value ?? ''}
                      onChange={(e) =>
                        handleItemChange(
                          index,
                          'listing_value',
                          e.target.value ? parseFloat(e.target.value) : null
                        )
                      }
                      placeholder="0.00"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Platform</Label>
                    <Select
                      value={item.listing_platform || ''}
                      onValueChange={(val: string) =>
                        handleItemChange(index, 'listing_platform', val)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {SELLING_PLATFORMS.map((platform) => (
                          <SelectItem key={platform} value={platform}>
                            {PLATFORM_LABELS[platform as SellingPlatform]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Storage Location</Label>
                    <Input
                      value={item.storage_location}
                      onChange={(e) => handleItemChange(index, 'storage_location', e.target.value)}
                      placeholder="e.g., Shelf A3"
                    />
                  </div>

                  {/* Row 3: ASIN, SKU, Source, Notes */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Amazon ASIN</Label>
                    <Input
                      value={item.amazon_asin}
                      onChange={(e) => handleItemChange(index, 'amazon_asin', e.target.value)}
                      placeholder="B0..."
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">SKU</Label>
                    <Input
                      value={item.sku}
                      onChange={(e) => handleItemChange(index, 'sku', e.target.value)}
                      placeholder="Auto-generated if empty"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Source</Label>
                    <Input
                      value={item.source}
                      onChange={(e) => handleItemChange(index, 'source', e.target.value)}
                      placeholder="e.g., eBay, Car Boot"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <Input
                      value={item.notes}
                      onChange={(e) => handleItemChange(index, 'notes', e.target.value)}
                      placeholder="Any notes..."
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* Summary Footer */}
      <div className="rounded-md bg-muted p-3 text-center text-sm text-muted-foreground">
        Creating <span className="font-semibold text-foreground">{items.length}</span> inventory
        {items.length === 1 ? ' item' : ' items'}
      </div>
    </div>
  );
}
