'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Package, Check } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { fetchInventory, type InventoryFilters } from '@/lib/api/inventory';
import type { InventoryItem } from '@hadley-bricks/database';

interface InventoryImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: InventoryItem) => void;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'LISTED', label: 'Listed' },
  { value: 'NOT YET RECEIVED', label: 'Not Yet Received' },
  { value: 'SOLD', label: 'Sold' },
];

const CONDITION_OPTIONS = [
  { value: 'all', label: 'All Conditions' },
  { value: 'New', label: 'New' },
  { value: 'Used', label: 'Used' },
];

const PLATFORM_OPTIONS = [
  { value: 'all', label: 'All Platforms' },
  { value: 'ebay', label: 'eBay' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'bricklink', label: 'BrickLink' },
  { value: 'brickowl', label: 'Brick Owl' },
];

export function InventoryImportModal({
  open,
  onOpenChange,
  onSelect,
}: InventoryImportModalProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [condition, setCondition] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Debounce search input
  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value);
  }, 300);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      debouncedSetSearch(value);
    },
    [debouncedSetSearch]
  );

  // Build filters
  const filters: InventoryFilters = useMemo(() => {
    const f: InventoryFilters = {};
    if (debouncedSearch) f.search = debouncedSearch;
    if (status !== 'all') f.status = status;
    if (condition !== 'all') f.condition = condition;
    if (platform !== 'all') f.platform = platform;
    return f;
  }, [debouncedSearch, status, condition, platform]);

  // Fetch inventory items
  const { data, isLoading, error } = useQuery({
    queryKey: ['inventory-import', filters],
    queryFn: () => fetchInventory(filters, { pageSize: 50 }),
    enabled: open,
    staleTime: 30000,
  });

  const items = data?.data ?? [];

  // Reset state when modal closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearch('');
        setDebouncedSearch('');
        setStatus('all');
        setCondition('all');
        setPlatform('all');
        setSelectedItem(null);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  // Handle import
  const handleImport = useCallback(() => {
    if (selectedItem) {
      onSelect(selectedItem);
      handleOpenChange(false);
    }
  }, [selectedItem, onSelect, handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Import from Inventory
          </DialogTitle>
          <DialogDescription>
            Search and select an inventory item to populate the listing form.
          </DialogDescription>
        </DialogHeader>

        {/* Search and Filters */}
        <div className="space-y-4 py-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by set number or name..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          {/* Filters Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue />
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
            <div className="space-y-1.5">
              <Label className="text-xs">Condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="h-9">
                  <SelectValue />
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
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1 -mx-6 px-6 min-h-[300px]">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive">
              Failed to load inventory items
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No inventory items found matching your criteria
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <InventoryItemRow
                  key={item.id}
                  item={item}
                  isSelected={selectedItem?.id === item.id}
                  onClick={() => setSelectedItem(item)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="pt-4 border-t">
          <div className="flex items-center justify-between w-full">
            <span className="text-sm text-muted-foreground">
              {items.length > 0 && `${items.length} items found`}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!selectedItem}>
                <Check className="mr-2 h-4 w-4" />
                Import Item
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface InventoryItemRowProps {
  item: InventoryItem;
  isSelected: boolean;
  onClick: () => void;
}

function InventoryItemRow({ item, isSelected, onClick }: InventoryItemRowProps) {
  const displayName = item.item_name
    ? `${item.set_number} - ${item.item_name}`
    : item.set_number;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-colors',
        'hover:bg-muted/50',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{displayName}</div>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            {item.condition && (
              <Badge
                variant={item.condition === 'New' ? 'default' : 'secondary'}
                className="text-xs"
              >
                {item.condition}
              </Badge>
            )}
            {item.status && (
              <Badge variant="outline" className="text-xs">
                {item.status}
              </Badge>
            )}
            {item.listing_platform && (
              <span className="text-xs">{item.listing_platform}</span>
            )}
          </div>
          {item.notes && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {item.notes}
            </p>
          )}
        </div>
        {isSelected && (
          <Check className="h-5 w-5 text-primary flex-shrink-0" />
        )}
      </div>
    </button>
  );
}
