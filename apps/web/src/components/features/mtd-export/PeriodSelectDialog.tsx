'use client';

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PeriodSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (startMonth: string, endMonth: string) => void;
  title: string;
  description: string;
}

function generateMonthOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const now = new Date();

  // Generate last 24 months
  for (let i = 0; i < 24; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }

  return options;
}

export function PeriodSelectDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
}: PeriodSelectDialogProps) {
  const monthOptions = useMemo(() => generateMonthOptions(), []);

  // Default to current month for both start and end
  const [startMonth, setStartMonth] = useState(monthOptions[0]?.value || '');
  const [endMonth, setEndMonth] = useState(monthOptions[0]?.value || '');

  const handleConfirm = () => {
    onConfirm(startMonth, endMonth);
  };

  // Validate that end month is not before start month
  const isValid = useMemo(() => {
    if (!startMonth || !endMonth) return false;
    return endMonth >= startMonth;
  }, [startMonth, endMonth]);

  // Format the selected range for display
  const rangeLabel = useMemo(() => {
    if (!startMonth || !endMonth) return '';

    const startDate = new Date(startMonth + '-01');
    const endDate = new Date(endMonth + '-01');

    const startLabel = startDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    const endLabel = endDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

    if (startMonth === endMonth) {
      return startLabel;
    }
    return `${startLabel} to ${endLabel}`;
  }, [startMonth, endMonth]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="start-month" className="text-right">
              From
            </Label>
            <Select value={startMonth} onValueChange={setStartMonth}>
              <SelectTrigger id="start-month" className="col-span-3">
                <SelectValue placeholder="Select start month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="end-month" className="text-right">
              To
            </Label>
            <Select value={endMonth} onValueChange={setEndMonth}>
              <SelectTrigger id="end-month" className="col-span-3">
                <SelectValue placeholder="Select end month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={option.value < startMonth}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isValid && startMonth && endMonth && (
            <p className="text-sm text-destructive text-center">
              End month must be the same as or after start month
            </p>
          )}

          {isValid && rangeLabel && (
            <p className="text-sm text-muted-foreground text-center">
              Selected: <span className="font-medium">{rangeLabel}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
