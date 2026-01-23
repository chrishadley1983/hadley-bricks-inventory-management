'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useUpdateHomeCostsSettings } from '@/hooks/use-home-costs';
import type { HomeCostsSettings, DisplayMode } from '@/types/home-costs';

interface SettingsTabProps {
  settings: HomeCostsSettings;
  isLoading?: boolean;
}

/**
 * Settings Tab
 * Allows configuring P&L display mode for home costs
 * F57-F60: Settings Tab criteria
 */
export function SettingsTab({ settings, isLoading }: SettingsTabProps) {
  const { toast } = useToast();
  const updateMutation = useUpdateHomeCostsSettings();

  const [displayMode, setDisplayMode] = useState<DisplayMode>('separate');

  // Initialize from settings
  useEffect(() => {
    setDisplayMode(settings.displayMode);
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ displayMode });
      toast({ title: 'Settings saved successfully' });
    } catch (error) {
      toast({
        title: 'Failed to save',
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
      </div>
    );
  }

  const isSaving = updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        Configure how home costs appear in your Profit & Loss report.
      </div>

      {/* Display mode selection */}
      <div className="space-y-3">
        <Label>P&L Display Mode</Label>
        <RadioGroup
          value={displayMode}
          onValueChange={(value: string) => setDisplayMode(value as DisplayMode)}
        >
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="separate" id="display-separate" className="mt-1" />
            <div>
              <Label htmlFor="display-separate" className="font-normal cursor-pointer">
                Separate line items
              </Label>
              <p className="text-sm text-muted-foreground">
                Show Use of Home, Phone & Broadband, and Insurance as separate rows
              </p>
            </div>
          </div>
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="consolidated" id="display-consolidated" className="mt-1" />
            <div>
              <Label htmlFor="display-consolidated" className="font-normal cursor-pointer">
                Single consolidated line
              </Label>
              <p className="text-sm text-muted-foreground">
                Combine all home costs into a single &quot;Home Costs&quot; row
              </p>
            </div>
          </div>
        </RadioGroup>
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
