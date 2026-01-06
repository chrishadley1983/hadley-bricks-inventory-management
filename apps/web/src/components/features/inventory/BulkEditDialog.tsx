'use client';

import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { usePlatforms } from '@/hooks';

interface BulkEditField {
  enabled: boolean;
  value: string | null;
}

interface BulkEditFormState {
  storage_location: BulkEditField;
  linked_lot: BulkEditField;
  notes: BulkEditField;
  condition: BulkEditField;
  status: BulkEditField;
  source: BulkEditField;
  listing_platform: BulkEditField;
}

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (updates: Partial<Record<string, string | null>>) => void;
  isPending: boolean;
}

const STATUS_OPTIONS = ['NOT YET RECEIVED', 'BACKLOG', 'LISTED', 'SOLD'];
const CONDITION_OPTIONS = ['New', 'Used'];

const initialFieldState = (): BulkEditField => ({
  enabled: false,
  value: null,
});

export function BulkEditDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isPending,
}: BulkEditDialogProps) {
  const { data: platforms = [] } = usePlatforms();
  const [formState, setFormState] = useState<BulkEditFormState>({
    storage_location: initialFieldState(),
    linked_lot: initialFieldState(),
    notes: initialFieldState(),
    condition: initialFieldState(),
    status: initialFieldState(),
    source: initialFieldState(),
    listing_platform: initialFieldState(),
  });

  const handleFieldToggle = (field: keyof BulkEditFormState, enabled: boolean) => {
    setFormState((prev) => ({
      ...prev,
      [field]: { ...prev[field], enabled, value: enabled ? prev[field].value : null },
    }));
  };

  const handleFieldChange = (field: keyof BulkEditFormState, value: string | null) => {
    setFormState((prev) => ({
      ...prev,
      [field]: { ...prev[field], value },
    }));
  };

  const handleConfirm = () => {
    const updates: Partial<Record<string, string | null>> = {};

    Object.entries(formState).forEach(([key, field]) => {
      if (field.enabled) {
        updates[key] = field.value;
      }
    });

    if (Object.keys(updates).length > 0) {
      onConfirm(updates);
    }
  };

  const handleClose = () => {
    // Reset form state when closing
    setFormState({
      storage_location: initialFieldState(),
      linked_lot: initialFieldState(),
      notes: initialFieldState(),
      condition: initialFieldState(),
      status: initialFieldState(),
      source: initialFieldState(),
      listing_platform: initialFieldState(),
    });
    onOpenChange(false);
  };

  const enabledFieldsCount = Object.values(formState).filter((f) => f.enabled).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Edit {selectedCount} Items</DialogTitle>
          <DialogDescription>
            Select the fields you want to update. Only checked fields will be modified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Status */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-status"
                checked={formState.status.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('status', !!checked)
                }
              />
              <Label htmlFor="edit-status" className="font-medium">
                Status
              </Label>
            </div>
            {formState.status.enabled && (
              <Select
                value={formState.status.value || ''}
                onValueChange={(value: string) => handleFieldChange('status', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status === 'NOT YET RECEIVED' ? 'Pending' : status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Condition */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-condition"
                checked={formState.condition.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('condition', !!checked)
                }
              />
              <Label htmlFor="edit-condition" className="font-medium">
                Condition
              </Label>
            </div>
            {formState.condition.enabled && (
              <Select
                value={formState.condition.value || ''}
                onValueChange={(value: string) => handleFieldChange('condition', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_OPTIONS.map((condition) => (
                    <SelectItem key={condition} value={condition}>
                      {condition}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Source */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-source"
                checked={formState.source.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('source', !!checked)
                }
              />
              <Label htmlFor="edit-source" className="font-medium">
                Source
              </Label>
            </div>
            {formState.source.enabled && (
              <Input
                placeholder="Enter source"
                value={formState.source.value || ''}
                onChange={(e) => handleFieldChange('source', e.target.value || null)}
              />
            )}
          </div>

          {/* Listing Platform */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-listing-platform"
                checked={formState.listing_platform.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('listing_platform', !!checked)
                }
              />
              <Label htmlFor="edit-listing-platform" className="font-medium">
                Listing Platform
              </Label>
            </div>
            {formState.listing_platform.enabled && (
              <Select
                value={formState.listing_platform.value || ''}
                onValueChange={(value: string) => handleFieldChange('listing_platform', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Storage Location */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-storage-location"
                checked={formState.storage_location.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('storage_location', !!checked)
                }
              />
              <Label htmlFor="edit-storage-location" className="font-medium">
                Storage Location
              </Label>
            </div>
            {formState.storage_location.enabled && (
              <Input
                placeholder="Enter storage location"
                value={formState.storage_location.value || ''}
                onChange={(e) => handleFieldChange('storage_location', e.target.value || null)}
              />
            )}
          </div>

          {/* Linked Purchase */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-linked-lot"
                checked={formState.linked_lot.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('linked_lot', !!checked)
                }
              />
              <Label htmlFor="edit-linked-lot" className="font-medium">
                Linked Purchase
              </Label>
            </div>
            {formState.linked_lot.enabled && (
              <Input
                placeholder="Enter purchase reference"
                value={formState.linked_lot.value || ''}
                onChange={(e) => handleFieldChange('linked_lot', e.target.value || null)}
              />
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-notes"
                checked={formState.notes.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('notes', !!checked)
                }
              />
              <Label htmlFor="edit-notes" className="font-medium">
                Notes
              </Label>
            </div>
            {formState.notes.enabled && (
              <Textarea
                placeholder="Enter notes"
                value={formState.notes.value || ''}
                onChange={(e) => handleFieldChange('notes', e.target.value || null)}
                rows={3}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || enabledFieldsCount === 0}>
            {isPending
              ? 'Updating...'
              : `Update ${selectedCount} Item${selectedCount > 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
