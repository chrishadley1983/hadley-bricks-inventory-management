'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
import type { HomeCost } from '@/types/home-costs';
import { calculateInsuranceClaimable } from '@/types/home-costs';

interface InsuranceTabProps {
  existingCost: HomeCost | null;
  isLoading?: boolean;
}

/**
 * Insurance Tab
 * Allows configuring home contents insurance with business proportion
 * F45-F56: Insurance Tab criteria
 */
export function InsuranceTab({ existingCost, isLoading }: InsuranceTabProps) {
  const { toast } = useToast();
  const createMutation = useCreateHomeCost();
  const updateMutation = useUpdateHomeCost();
  const deleteMutation = useDeleteHomeCost();

  // Local state
  const [annualPremium, setAnnualPremium] = useState('');
  const [businessStockValue, setBusinessStockValue] = useState('');
  const [totalContentsValue, setTotalContentsValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState<string | null>(null);
  const [isOngoing, setIsOngoing] = useState(true);

  // Initialize state from existing cost
  useEffect(() => {
    if (existingCost) {
      setAnnualPremium(existingCost.annualPremium?.toString() || '');
      setBusinessStockValue(existingCost.businessStockValue?.toString() || '');
      setTotalContentsValue(existingCost.totalContentsValue?.toString() || '');
      setStartDate(existingCost.startDate);
      setEndDate(existingCost.endDate);
      setIsOngoing(!existingCost.endDate);
    } else {
      // Default to current month
      const now = new Date();
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      setEndDate(null);
      setIsOngoing(true);
      setAnnualPremium('');
      setBusinessStockValue('');
      setTotalContentsValue('');
    }
  }, [existingCost]);

  // Calculate displays
  const premium = parseFloat(annualPremium) || 0;
  const stockValue = parseFloat(businessStockValue) || 0;
  const contentsValue = parseFloat(totalContentsValue) || 0;

  const calculations =
    premium > 0 && stockValue > 0 && contentsValue > 0
      ? calculateInsuranceClaimable(premium, stockValue, contentsValue)
      : null;

  const handleSave = async () => {
    const premiumNum = parseFloat(annualPremium);
    const stockNum = parseFloat(businessStockValue);
    const contentsNum = parseFloat(totalContentsValue);

    if (isNaN(premiumNum) || premiumNum <= 0) {
      toast({
        title: 'Invalid annual premium',
        description: 'Annual premium must be a positive number.',
        variant: 'destructive',
      });
      return;
    }

    if (isNaN(stockNum) || stockNum <= 0) {
      toast({
        title: 'Invalid business stock value',
        description: 'Business stock value must be a positive number.',
        variant: 'destructive',
      });
      return;
    }

    if (isNaN(contentsNum) || contentsNum <= 0) {
      toast({
        title: 'Invalid total contents value',
        description: 'Total contents value must be a positive number.',
        variant: 'destructive',
      });
      return;
    }

    if (stockNum > contentsNum) {
      toast({
        title: 'Invalid values',
        description: 'Business stock value cannot exceed total contents value.',
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
            annualPremium: premiumNum,
            businessStockValue: stockNum,
            totalContentsValue: contentsNum,
            startDate,
            endDate: finalEndDate,
          },
        });
      } else {
        await createMutation.mutateAsync({
          costType: 'insurance',
          annualPremium: premiumNum,
          businessStockValue: stockNum,
          totalContentsValue: contentsNum,
          startDate,
          endDate: finalEndDate,
        });
      }
      toast({ title: 'Insurance saved successfully' });
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
      toast({ title: 'Insurance deleted' });
      // Reset form
      const now = new Date();
      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      setEndDate(null);
      setIsOngoing(true);
      setAnnualPremium('');
      setBusinessStockValue('');
      setTotalContentsValue('');
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
        Claim a proportion of your home contents insurance based on business stock value.
      </div>

      {/* Form fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Annual Premium</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              £
            </span>
            <Input
              type="number"
              step="0.01"
              min="0"
              className="pl-7"
              value={annualPremium}
              onChange={(e) => setAnnualPremium(e.target.value)}
              placeholder="e.g. 240"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Business Stock Value</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              £
            </span>
            <Input
              type="number"
              step="0.01"
              min="0"
              className="pl-7"
              value={businessStockValue}
              onChange={(e) => setBusinessStockValue(e.target.value)}
              placeholder="e.g. 5000"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Total Contents Value</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              £
            </span>
            <Input
              type="number"
              step="0.01"
              min="0"
              className="pl-7"
              value={totalContentsValue}
              onChange={(e) => setTotalContentsValue(e.target.value)}
              placeholder="e.g. 25000"
            />
          </div>
        </div>
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
                id="ins-ongoing"
                checked={isOngoing}
                onCheckedChange={(checked: boolean) => {
                  setIsOngoing(checked === true);
                  if (checked) setEndDate(null);
                }}
              />
              <Label htmlFor="ins-ongoing" className="font-normal cursor-pointer">
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
      {calculations && (
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Business Proportion</span>
            <span className="font-medium">{calculations.proportion.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Annual Claimable</span>
            <span className="font-medium">£{calculations.annualClaimable.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Monthly Equivalent</span>
            <span className="font-medium">£{calculations.monthlyClaimable.toFixed(2)}</span>
          </div>
        </div>
      )}

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
