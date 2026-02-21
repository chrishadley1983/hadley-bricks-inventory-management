'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// eBay Inventory API condition values for minifigures
const CONDITION_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'USED_EXCELLENT', label: 'Used - Excellent' },
  { value: 'USED_VERY_GOOD', label: 'Used - Very Good' },
  { value: 'USED_GOOD', label: 'Used - Good' },
];

interface EbayFieldsSectionProps {
  condition: string | null;
  categoryId: string | null;
  onConditionChange: (condition: string) => void;
  onCategoryIdChange: (categoryId: string) => void;
  isUpdating?: boolean;
}

export function EbayFieldsSection({
  condition,
  categoryId,
  onConditionChange,
  onCategoryIdChange,
  isUpdating,
}: EbayFieldsSectionProps) {
  const [localCategoryId, setLocalCategoryId] = useState(categoryId || '19003');

  // Sync external value changes
  useEffect(() => {
    setLocalCategoryId(categoryId || '19003');
  }, [categoryId]);

  const handleCategoryBlur = () => {
    const trimmed = localCategoryId.trim();
    if (trimmed && trimmed !== (categoryId || '19003')) {
      onCategoryIdChange(trimmed);
    }
  };

  const handleCategoryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCategoryBlur();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium text-muted-foreground">eBay Fields</span>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Condition</label>
          <Select
            value={condition || 'USED_EXCELLENT'}
            onValueChange={onConditionChange}
            disabled={isUpdating}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Category ID</label>
          <Input
            value={localCategoryId}
            onChange={(e) => setLocalCategoryId(e.target.value)}
            onBlur={handleCategoryBlur}
            onKeyDown={handleCategoryKeyDown}
            className="h-8 text-xs"
            disabled={isUpdating}
          />
        </div>
      </div>
    </div>
  );
}
