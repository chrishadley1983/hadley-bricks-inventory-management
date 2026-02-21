'use client';

import { useState } from 'react';
import { Settings, Save, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useWorkflowConfig,
  useUpdateWorkflowConfig,
  DEFAULT_CONFIG,
  type UpdateWorkflowConfigInput,
} from '@/hooks/use-workflow-config';
import { useToast } from '@/hooks/use-toast';

export function WorkflowSettingsPanel() {
  const { toast } = useToast();
  const { data: config, isLoading } = useWorkflowConfig();
  const updateConfig = useUpdateWorkflowConfig();
  const [open, setOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<UpdateWorkflowConfigInput>({});

  // Initialize local config when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && config) {
      setLocalConfig({
        target_ebay_listings: config.target_ebay_listings,
        target_amazon_listings: config.target_amazon_listings,
        target_bricklink_weekly_value: config.target_bricklink_weekly_value,
        target_daily_listed_value: config.target_daily_listed_value,
        target_daily_sold_value: config.target_daily_sold_value,
        pomodoro_daily_target: config.pomodoro_daily_target,
        pomodoro_classic_work: config.pomodoro_classic_work,
        pomodoro_classic_break: config.pomodoro_classic_break,
        pomodoro_long_work: config.pomodoro_long_work,
        pomodoro_long_break: config.pomodoro_long_break,
        notifications_enabled: config.notifications_enabled,
        notification_dispatch_hours: config.notification_dispatch_hours,
        notification_overdue_orders: config.notification_overdue_orders,
        audio_enabled: config.audio_enabled,
      });
    }
    setOpen(isOpen);
  };

  const updateField = <K extends keyof UpdateWorkflowConfigInput>(
    field: K,
    value: UpdateWorkflowConfigInput[K]
  ) => {
    setLocalConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      await updateConfig.mutateAsync(localConfig);
      toast({
        title: 'Settings saved',
        description: 'Your workflow settings have been updated.',
      });
      setOpen(false);
    } catch {
      toast({
        title: 'Failed to save settings',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleReset = () => {
    setLocalConfig({
      ...DEFAULT_CONFIG,
    } as UpdateWorkflowConfigInput);
    toast({
      title: 'Settings reset',
      description: 'Click Save to apply the default settings.',
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workflow Settings</DialogTitle>
          <DialogDescription>
            Configure your workflow targets, timers, and notifications.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="targets" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="targets">Targets</TabsTrigger>
              <TabsTrigger value="pomodoro">Pomodoro</TabsTrigger>
              <TabsTrigger value="notifications">Alerts</TabsTrigger>
            </TabsList>

            {/* Targets Tab */}
            <TabsContent value="targets" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="target_ebay_listings">eBay Weekly Listed Value (£)</Label>
                  <Input
                    id="target_ebay_listings"
                    type="number"
                    min="0"
                    step="0.01"
                    value={localConfig.target_ebay_listings ?? ''}
                    onChange={(e) =>
                      updateField(
                        'target_ebay_listings',
                        e.target.value ? parseFloat(e.target.value) : null
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="target_amazon_listings">Amazon Weekly Listed Value (£)</Label>
                  <Input
                    id="target_amazon_listings"
                    type="number"
                    min="0"
                    step="0.01"
                    value={localConfig.target_amazon_listings ?? ''}
                    onChange={(e) =>
                      updateField(
                        'target_amazon_listings',
                        e.target.value ? parseFloat(e.target.value) : null
                      )
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="target_bricklink_weekly_value">
                  BrickLink Weekly Value Target (£)
                </Label>
                <Input
                  id="target_bricklink_weekly_value"
                  type="number"
                  min="0"
                  step="10"
                  value={localConfig.target_bricklink_weekly_value ?? ''}
                  onChange={(e) =>
                    updateField(
                      'target_bricklink_weekly_value',
                      e.target.value ? parseInt(e.target.value, 10) : null
                    )
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="target_daily_listed_value">Daily Listed Value (£)</Label>
                  <Input
                    id="target_daily_listed_value"
                    type="number"
                    min="0"
                    step="10"
                    value={localConfig.target_daily_listed_value ?? ''}
                    onChange={(e) =>
                      updateField(
                        'target_daily_listed_value',
                        e.target.value ? parseInt(e.target.value, 10) : null
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="target_daily_sold_value">Daily Sold Value (£)</Label>
                  <Input
                    id="target_daily_sold_value"
                    type="number"
                    min="0"
                    step="10"
                    value={localConfig.target_daily_sold_value ?? ''}
                    onChange={(e) =>
                      updateField(
                        'target_daily_sold_value',
                        e.target.value ? parseInt(e.target.value, 10) : null
                      )
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* Pomodoro Tab */}
            <TabsContent value="pomodoro" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="pomodoro_daily_target">Daily Pomodoro Target</Label>
                <Input
                  id="pomodoro_daily_target"
                  type="number"
                  min="1"
                  max="20"
                  value={localConfig.pomodoro_daily_target ?? ''}
                  onChange={(e) =>
                    updateField(
                      'pomodoro_daily_target',
                      e.target.value ? parseInt(e.target.value, 10) : null
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How many pomodoros you aim to complete each day
                </p>
              </div>

              <div className="border rounded-lg p-4 space-y-4">
                <h4 className="text-sm font-medium">Classic Mode</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pomodoro_classic_work">Work (minutes)</Label>
                    <Input
                      id="pomodoro_classic_work"
                      type="number"
                      min="1"
                      max="120"
                      value={localConfig.pomodoro_classic_work ?? ''}
                      onChange={(e) =>
                        updateField(
                          'pomodoro_classic_work',
                          e.target.value ? parseInt(e.target.value, 10) : null
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pomodoro_classic_break">Break (minutes)</Label>
                    <Input
                      id="pomodoro_classic_break"
                      type="number"
                      min="1"
                      max="60"
                      value={localConfig.pomodoro_classic_break ?? ''}
                      onChange={(e) =>
                        updateField(
                          'pomodoro_classic_break',
                          e.target.value ? parseInt(e.target.value, 10) : null
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-4">
                <h4 className="text-sm font-medium">Long Mode</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pomodoro_long_work">Work (minutes)</Label>
                    <Input
                      id="pomodoro_long_work"
                      type="number"
                      min="1"
                      max="120"
                      value={localConfig.pomodoro_long_work ?? ''}
                      onChange={(e) =>
                        updateField(
                          'pomodoro_long_work',
                          e.target.value ? parseInt(e.target.value, 10) : null
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pomodoro_long_break">Break (minutes)</Label>
                    <Input
                      id="pomodoro_long_break"
                      type="number"
                      min="1"
                      max="60"
                      value={localConfig.pomodoro_long_break ?? ''}
                      onChange={(e) =>
                        updateField(
                          'pomodoro_long_break',
                          e.target.value ? parseInt(e.target.value, 10) : null
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Sound Effects</Label>
                  <p className="text-xs text-muted-foreground">Play sounds when phases complete</p>
                </div>
                <Switch
                  checked={localConfig.audio_enabled ?? true}
                  onCheckedChange={(checked: boolean) => updateField('audio_enabled', checked)}
                />
              </div>
            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Notifications</Label>
                  <p className="text-xs text-muted-foreground">
                    Show workflow alerts and reminders
                  </p>
                </div>
                <Switch
                  checked={localConfig.notifications_enabled ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateField('notifications_enabled', checked)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification_dispatch_hours">Dispatch Alert (hours before)</Label>
                <Input
                  id="notification_dispatch_hours"
                  type="number"
                  min="1"
                  max="72"
                  value={localConfig.notification_dispatch_hours ?? ''}
                  onChange={(e) =>
                    updateField(
                      'notification_dispatch_hours',
                      e.target.value ? parseInt(e.target.value, 10) : null
                    )
                  }
                  disabled={!localConfig.notifications_enabled}
                />
                <p className="text-xs text-muted-foreground">
                  Alert when orders need dispatching within this time
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Overdue Order Alerts</Label>
                  <p className="text-xs text-muted-foreground">
                    Alert for orders past dispatch deadline
                  </p>
                </div>
                <Switch
                  checked={localConfig.notification_overdue_orders ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateField('notification_overdue_orders', checked)
                  }
                  disabled={!localConfig.notifications_enabled}
                />
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isLoading}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateConfig.isPending || isLoading}>
              <Save className="h-4 w-4 mr-2" />
              {updateConfig.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
