'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { DiscountRulesEditor } from './DiscountRulesEditor';
import type { NegotiationConfig, NegotiationDiscountRule } from '@/lib/ebay/negotiation.types';

interface ConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config?: NegotiationConfig;
  rules?: NegotiationDiscountRule[];
  isLoading?: boolean;
  onUpdateConfig: (updates: Partial<NegotiationConfig>) => Promise<void>;
  onCreateRule: (rule: Omit<NegotiationDiscountRule, 'id' | 'userId'>) => Promise<void>;
  onUpdateRule: (id: string, rule: Omit<NegotiationDiscountRule, 'id' | 'userId'>) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
}

export function ConfigModal({
  open,
  onOpenChange,
  config,
  rules,
  isLoading,
  onUpdateConfig,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
}: ConfigModalProps) {
  const [localConfig, setLocalConfig] = useState<Partial<NegotiationConfig>>({});
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // Reset local config when modal opens or config changes
  useEffect(() => {
    if (config) {
      setLocalConfig({
        automationEnabled: config.automationEnabled,
        minDaysBeforeOffer: config.minDaysBeforeOffer,
        reOfferCooldownDays: config.reOfferCooldownDays,
        reOfferEscalationPercent: config.reOfferEscalationPercent,
        weightListingAge: config.weightListingAge,
        weightStockLevel: config.weightStockLevel,
        weightItemValue: config.weightItemValue,
        weightCategory: config.weightCategory,
        weightWatchers: config.weightWatchers,
        offerMessageTemplate: config.offerMessageTemplate,
      });
    }
  }, [config]);

  const handleSave = async () => {
    // Validate weights sum to 100
    const totalWeight =
      (localConfig.weightListingAge ?? 0) +
      (localConfig.weightStockLevel ?? 0) +
      (localConfig.weightItemValue ?? 0) +
      (localConfig.weightCategory ?? 0) +
      (localConfig.weightWatchers ?? 0);

    if (totalWeight !== 100) {
      toast({
        title: 'Invalid weights',
        description: `Weights must sum to 100. Current sum: ${totalWeight}`,
        variant: 'destructive',
      });
      return;
    }

    // Validate listing age weight >= 30
    if ((localConfig.weightListingAge ?? 0) < 30) {
      toast({
        title: 'Invalid listing age weight',
        description: 'Listing age weight must be at least 30%',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      await onUpdateConfig(localConfig);
      toast({ title: 'Settings saved' });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutomationToggle = async (enabled: boolean) => {
    setLocalConfig({ ...localConfig, automationEnabled: enabled });
    // Save immediately for toggle
    try {
      await onUpdateConfig({ automationEnabled: enabled });
      toast({
        title: enabled ? 'Automation enabled' : 'Automation disabled',
        description: enabled
          ? 'Offers will be sent automatically at scheduled times'
          : 'Automatic offer sending has been turned off',
      });
    } catch {
      // Revert local state
      setLocalConfig({ ...localConfig, automationEnabled: !enabled });
      toast({
        title: 'Error',
        description: 'Failed to update automation setting',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Negotiation Settings</DialogTitle>
          <DialogDescription>
            Configure automated offer sending and discount rules
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-6 py-4">
            {/* Automation Toggle */}
            <div className="flex items-center justify-between" data-testid="automation-toggle">
              <div className="space-y-0.5">
                <Label htmlFor="automation">Automated Offers</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically send offers at 8am, 12pm, 4pm, 8pm UK time
                </p>
              </div>
              <Switch
                id="automation"
                checked={localConfig.automationEnabled ?? false}
                onCheckedChange={handleAutomationToggle}
              />
            </div>

            <Separator />

            {/* Message Template */}
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium">Offer Message</h4>
                <p className="text-xs text-muted-foreground">
                  Customise the message sent with your offers. Max 2,000 characters.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="messageTemplate">Message Template</Label>
                <Textarea
                  id="messageTemplate"
                  rows={4}
                  maxLength={2000}
                  value={localConfig.offerMessageTemplate ?? ''}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      offerMessageTemplate: e.target.value,
                    })
                  }
                  placeholder="Thank you for your interest! We're offering you an exclusive {discount}% discount..."
                />
                <div className="flex justify-between">
                  <p className="text-xs text-muted-foreground">
                    Available placeholders: <code className="text-xs bg-muted px-1 rounded">{'{discount}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{title}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{price}'}</code> <code className="text-xs bg-muted px-1 rounded">{'{offer_price}'}</code>
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {localConfig.offerMessageTemplate?.length ?? 0}/2000
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Timing Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Timing</h4>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minDays">Min Days Before Offer</Label>
                  <Input
                    id="minDays"
                    type="number"
                    min={1}
                    max={365}
                    value={localConfig.minDaysBeforeOffer ?? 14}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        minDaysBeforeOffer: parseInt(e.target.value, 10) || 14,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Days from original listing date before sending offers
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cooldown">Re-offer Cooldown (days)</Label>
                  <Input
                    id="cooldown"
                    type="number"
                    min={1}
                    max={90}
                    value={localConfig.reOfferCooldownDays ?? 7}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        reOfferCooldownDays: parseInt(e.target.value, 10) || 7,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Days to wait before sending another offer
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="escalation">Re-offer Escalation (%)</Label>
                <Input
                  id="escalation"
                  type="number"
                  min={0}
                  max={20}
                  value={localConfig.reOfferEscalationPercent ?? 5}
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      reOfferEscalationPercent: parseInt(e.target.value, 10) || 5,
                    })
                  }
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Additional discount % added when re-sending an offer
                </p>
              </div>
            </div>

            <Separator />

            {/* Scoring Weights */}
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium">Scoring Weights</h4>
                <p className="text-xs text-muted-foreground">
                  Weights must sum to 100. Listing age must be at least 30%.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="weightAge">Listing Age</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weightAge"
                      type="number"
                      min={30}
                      max={100}
                      value={localConfig.weightListingAge ?? 50}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          weightListingAge: parseInt(e.target.value, 10) || 50,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="weightStock">Stock Level</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weightStock"
                      type="number"
                      min={0}
                      max={50}
                      value={localConfig.weightStockLevel ?? 15}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          weightStockLevel: parseInt(e.target.value, 10) || 15,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="weightValue">Item Value</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weightValue"
                      type="number"
                      min={0}
                      max={50}
                      value={localConfig.weightItemValue ?? 15}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          weightItemValue: parseInt(e.target.value, 10) || 15,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="weightCategory">Category</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weightCategory"
                      type="number"
                      min={0}
                      max={50}
                      value={localConfig.weightCategory ?? 10}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          weightCategory: parseInt(e.target.value, 10) || 10,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="weightWatchers">Watchers</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weightWatchers"
                      type="number"
                      min={0}
                      max={50}
                      value={localConfig.weightWatchers ?? 10}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          weightWatchers: parseInt(e.target.value, 10) || 10,
                        })
                      }
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Current sum:{' '}
                <span
                  className={
                    (localConfig.weightListingAge ?? 0) +
                      (localConfig.weightStockLevel ?? 0) +
                      (localConfig.weightItemValue ?? 0) +
                      (localConfig.weightCategory ?? 0) +
                      (localConfig.weightWatchers ?? 0) ===
                    100
                      ? 'text-green-600'
                      : 'text-red-600'
                  }
                >
                  {(localConfig.weightListingAge ?? 0) +
                    (localConfig.weightStockLevel ?? 0) +
                    (localConfig.weightItemValue ?? 0) +
                    (localConfig.weightCategory ?? 0) +
                    (localConfig.weightWatchers ?? 0)}
                  %
                </span>
              </p>
            </div>

            <Separator />

            {/* Discount Rules */}
            <DiscountRulesEditor
              rules={rules}
              isLoading={isLoading}
              onCreateRule={onCreateRule}
              onUpdateRule={onUpdateRule}
              onDeleteRule={onDeleteRule}
            />

            {/* Save Button */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
