'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHomeCosts } from '@/hooks/use-home-costs';
import { UseOfHomeTab } from './UseOfHomeTab';
import { PhoneBroadbandTab } from './PhoneBroadbandTab';
import { InsuranceTab } from './InsuranceTab';
import { SettingsTab } from './SettingsTab';

interface HomeCostsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Home Costs Modal
 * Modal dialog with tabs for configuring home working expenses
 * F12-F20: Modal UI Structure criteria
 */
export function HomeCostsModal({ open, onOpenChange }: HomeCostsModalProps) {
  const { data, isLoading } = useHomeCosts();

  // Filter costs by type
  const useOfHomeCost = data?.costs.find((c) => c.costType === 'use_of_home') ?? null;
  const phoneBroadbandCosts = data?.costs.filter((c) => c.costType === 'phone_broadband') ?? [];
  const insuranceCost = data?.costs.find((c) => c.costType === 'insurance') ?? null;
  const settings = data?.settings ?? { displayMode: 'separate' as const };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e: Event) => e.preventDefault()}
        onEscapeKeyDown={(e: KeyboardEvent) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Home Costs Configuration</DialogTitle>
          <DialogDescription>
            Configure allowable home working expenses for your P&L calculations.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="use-of-home" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="use-of-home">Use of Home</TabsTrigger>
            <TabsTrigger value="phone-broadband">Phone & Broadband</TabsTrigger>
            <TabsTrigger value="insurance">Insurance</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="use-of-home" className="mt-4">
            <UseOfHomeTab existingCost={useOfHomeCost} isLoading={isLoading} />
          </TabsContent>

          <TabsContent value="phone-broadband" className="mt-4">
            <PhoneBroadbandTab existingCosts={phoneBroadbandCosts} isLoading={isLoading} />
          </TabsContent>

          <TabsContent value="insurance" className="mt-4">
            <InsuranceTab existingCost={insuranceCost} isLoading={isLoading} />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <SettingsTab settings={settings} isLoading={isLoading} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
