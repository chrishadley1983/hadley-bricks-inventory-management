'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useCreateHomeCost,
  useUpdateHomeCost,
  useDeleteHomeCost,
} from '@/hooks/use-home-costs';
import { MonthPicker } from './MonthPicker';
import type { HomeCost, HoursPerMonth } from '@/types/home-costs';
import { HMRC_RATES } from '@/types/home-costs';

interface UseOfHomeTabProps {
  existingCost: HomeCost | null;
  isLoading?: boolean;
}

/**
 * Use of Home Tab
 * Allows configuring HMRC simplified flat rate expense
 * F21-F31: Use of Home Tab criteria
 */
export function UseOfHomeTab({ existingCost, isLoading }: UseOfHomeTabProps) {
  const { toast } = useToast();
  const createMutation = useCreateHomeCost();
  const updateMutation = useUpdateHomeCost();
  const deleteMutation = useDeleteHomeCost();

  // Local state
  const [hoursPerMonth, setHoursPerMonth] = useState<HoursPerMonth | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string | null>(null);
  const [isOngoing, setIsOngoing] = useState(true);

  // Initialize state from existing cost
  useEffect(() => {
    if (existingCost) {
      setHoursPerMonth(existingCost.hoursPerMonth ?? null);
      setStartDate(existingCost.startDate);
      setEndDate(existingCost.endDate);
      setIsOngoing(!existingCost.endDate);
    } else {
      // Default to current month if no existing cost
      const now = new Date();
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      setEndDate(null);
      setIsOngoing(true);
      setHoursPerMonth(null);
    }
  }, [existingCost]);

  // Calculate displays
  const monthlyRate = hoursPerMonth ? HMRC_RATES[hoursPerMonth] : 0;
  const annualEstimate = monthlyRate * 12;

  const handleSave = async () => {
    if (!hoursPerMonth) {
      toast({
        title: 'Hours per month required',
        description: 'Please select how many hours you work from home per month.',
        variant: 'destructive',
      });
      return;
    }

    if (!startDate) {
      toast({
        title: 'Start date required',
        description: 'Please select a start date.',
        variant: 'destructive',
      });
      return;
    }

    const finalEndDate = isOngoing ? null : endDate;

    if (finalEndDate && finalEndDate < startDate) {
      toast({
        title: 'Invalid date range',
        description: 'End date must be on or after start date.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (existingCost) {
        await updateMutation.mutateAsync({
          id: existingCost.id,
          data: {
            hoursPerMonth,
            startDate,
            endDate: finalEndDate,
          },
        });
      } else {
        await createMutation.mutateAsync({
          costType: 'use_of_home',
          hoursPerMonth,
          startDate,
          endDate: finalEndDate,
        });
      }
      toast({ title: 'Use of Home saved successfully' });
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!existingCost) return;

    try {
      await deleteMutation.mutateAsync(existingCost.id);
      toast({ title: 'Use of Home deleted' });
      // Reset form
      setHoursPerMonth(null);
      const now = new Date();
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      setEndDate(null);
      setIsOngoing(true);
    } catch (error) {
      toast({
        title: 'Failed to delete',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        HMRC simplified expenses allow you to claim a flat rate based on hours worked from home.
      </div>

      {/* Hours per month selection */}
      <div className="space-y-3">
        <Label>Hours worked from home per month</Label>
        <RadioGroup
          value={hoursPerMonth ?? ''}
          onValueChange={(value) => setHoursPerMonth(value as HoursPerMonth)}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="25-50" id="hours-25-50" />
            <Label htmlFor="hours-25-50" className="font-normal cursor-pointer">
              25-50 hours → £10/month
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="51-100" id="hours-51-100" />
            <Label htmlFor="hours-51-100" className="font-normal cursor-pointer">
              51-100 hours → £18/month
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="101+" id="hours-101" />
            <Label htmlFor="hours-101" className="font-normal cursor-pointer">
              101+ hours → £26/month
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Date</Label>
          <MonthPicker value={startDate} onChange={setStartDate} />
        </div>
        <div className="space-y-2">
          <Label>End Date</Label>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="ongoing"
                checked={isOngoing}
                onCheckedChange={(checked) => {
                  setIsOngoing(checked === true);
                  if (checked) setEndDate(null);
                }}
              />
              <Label htmlFor="ongoing" className="font-normal cursor-pointer">
                Ongoing
              </Label>
            </div>
            {!isOngoing && (
              <MonthPicker value={endDate ?? ''} onChange={setEndDate} />
            )}
          </div>
        </div>
      </div>

      {/* Calculated values */}
      <div className="rounded-lg bg-muted p-4 space-y-2">
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Monthly Allowance</span>
          <span className="font-medium">
            {monthlyRate > 0 ? `£${monthlyRate.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Annual Estimate</span>
          <span className="font-medium">
            {annualEstimate > 0 ? `£${annualEstimate.toFixed(2)}` : '—'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-2">
        {existingCost && (
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting || isSaving}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        )}
        <div className={existingCost ? '' : 'ml-auto'}>
          <Button onClick={handleSave} disabled={isSaving || isDeleting}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
