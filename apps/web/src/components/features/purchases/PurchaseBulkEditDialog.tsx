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

interface BulkEditField<T = string | null> {
  enabled: boolean;
  value: T;
}

interface BulkEditFormState {
  purchase_date: BulkEditField;
  short_description: BulkEditField;
  cost: BulkEditField<number | null>;
  source: BulkEditField;
  payment_method: BulkEditField;
  description: BulkEditField;
  reference: BulkEditField;
}

interface PurchaseBulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (updates: Partial<Record<string, string | number | null>>) => void;
  isPending: boolean;
}

const SOURCE_OPTIONS = [
  'eBay',
  'FB Marketplace',
  'BrickLink',
  'Amazon',
  'Car Boot',
  'Gumtree',
  'Retail',
  'Vinted',
  'Sports Direct',
  'Private',
  'Auction',
  'Other',
];

const PAYMENT_OPTIONS = [
  'Cash',
  'Card',
  'PayPal',
  'Bank Transfer',
  'HSBC - Cash',
  'Monzo - Card',
];

const initialFieldState = <T = string | null,>(defaultValue: T = null as T): BulkEditField<T> => ({
  enabled: false,
  value: defaultValue,
});

const getInitialFormState = (): BulkEditFormState => ({
  purchase_date: initialFieldState(),
  short_description: initialFieldState(),
  cost: initialFieldState<number | null>(),
  source: initialFieldState(),
  payment_method: initialFieldState(),
  description: initialFieldState(),
  reference: initialFieldState(),
});

export function PurchaseBulkEditDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isPending,
}: PurchaseBulkEditDialogProps) {
  const [formState, setFormState] = useState<BulkEditFormState>(getInitialFormState());

  const handleFieldToggle = (field: keyof BulkEditFormState, enabled: boolean) => {
    setFormState((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        enabled,
        value: enabled ? prev[field].value : field === 'cost' ? null : null,
      },
    }));
  };

  const handleFieldChange = (
    field: keyof BulkEditFormState,
    value: string | number | null
  ) => {
    setFormState((prev) => ({
      ...prev,
      [field]: { ...prev[field], value },
    }));
  };

  const handleConfirm = () => {
    const updates: Partial<Record<string, string | number | null>> = {};

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
    setFormState(getInitialFormState());
    onOpenChange(false);
  };

  const enabledFieldsCount = Object.values(formState).filter((f) => f.enabled).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Edit {selectedCount} Purchases</DialogTitle>
          <DialogDescription>
            Select the fields you want to update. Only checked fields will be modified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Purchase Date */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-purchase-date"
                checked={formState.purchase_date.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('purchase_date', !!checked)
                }
              />
              <Label htmlFor="edit-purchase-date" className="font-medium">
                Purchase Date
              </Label>
            </div>
            {formState.purchase_date.enabled && (
              <Input
                type="date"
                value={formState.purchase_date.value || ''}
                onChange={(e) => handleFieldChange('purchase_date', e.target.value || null)}
              />
            )}
          </div>

          {/* Short Description */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-short-description"
                checked={formState.short_description.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('short_description', !!checked)
                }
              />
              <Label htmlFor="edit-short-description" className="font-medium">
                Description
              </Label>
            </div>
            {formState.short_description.enabled && (
              <Input
                placeholder="Enter description"
                value={formState.short_description.value || ''}
                onChange={(e) =>
                  handleFieldChange('short_description', e.target.value || null)
                }
              />
            )}
          </div>

          {/* Cost */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-cost"
                checked={formState.cost.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('cost', !!checked)
                }
              />
              <Label htmlFor="edit-cost" className="font-medium">
                Cost
              </Label>
            </div>
            {formState.cost.enabled && (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  £
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="pl-7"
                  value={formState.cost.value ?? ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'cost',
                      e.target.value ? parseFloat(e.target.value) : null
                    )
                  }
                />
              </div>
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
              <Select
                value={formState.source.value || ''}
                onValueChange={(value: string) => handleFieldChange('source', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-payment-method"
                checked={formState.payment_method.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('payment_method', !!checked)
                }
              />
              <Label htmlFor="edit-payment-method" className="font-medium">
                Payment Method
              </Label>
            </div>
            {formState.payment_method.enabled && (
              <Select
                value={formState.payment_method.value || ''}
                onValueChange={(value: string) => handleFieldChange('payment_method', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_OPTIONS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-reference"
                checked={formState.reference.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('reference', !!checked)
                }
              />
              <Label htmlFor="edit-reference" className="font-medium">
                Reference
              </Label>
            </div>
            {formState.reference.enabled && (
              <Input
                placeholder="Enter reference"
                value={formState.reference.value || ''}
                onChange={(e) => handleFieldChange('reference', e.target.value || null)}
              />
            )}
          </div>

          {/* Notes (description field) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-description"
                checked={formState.description.enabled}
                onCheckedChange={(checked: boolean | 'indeterminate') =>
                  handleFieldToggle('description', !!checked)
                }
              />
              <Label htmlFor="edit-description" className="font-medium">
                Notes
              </Label>
            </div>
            {formState.description.enabled && (
              <Textarea
                placeholder="Enter notes"
                value={formState.description.value || ''}
                onChange={(e) => handleFieldChange('description', e.target.value || null)}
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
              : `Update ${selectedCount} Purchase${selectedCount > 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
