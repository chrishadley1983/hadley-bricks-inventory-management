'use client';

import { useState } from 'react';
import {
  usePromotedCampaigns,
  usePromotionSchedules,
  useSaveSchedule,
  useDeleteSchedule,
} from '@/hooks/use-promoted-listings';
import type { PromotionSchedule, PromotionStage } from '@/hooks/use-promoted-listings';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Plus, Trash2, ArrowRight, Clock, Percent } from 'lucide-react';

export function ScheduleConfigView() {
  const { toast } = useToast();
  const { data: campaigns, isLoading: campaignsLoading } = usePromotedCampaigns();
  const { data: schedules, isLoading: schedulesLoading } = usePromotionSchedules();
  const saveSchedule = useSaveSchedule();
  const deleteSchedule = useDeleteSchedule();

  const [showEditor, setShowEditor] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<PromotionSchedule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Editor form state
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [stages, setStages] = useState<PromotionStage[]>([
    { days_threshold: 7, bid_percentage: 4.1 },
    { days_threshold: 45, bid_percentage: 6.0 },
  ]);

  const openNewSchedule = () => {
    setEditingSchedule(null);
    setSelectedCampaignId('');
    setEnabled(true);
    setStages([
      { days_threshold: 7, bid_percentage: 4.1 },
      { days_threshold: 45, bid_percentage: 6.0 },
    ]);
    setShowEditor(true);
  };

  const openEditSchedule = (schedule: PromotionSchedule) => {
    setEditingSchedule(schedule);
    setSelectedCampaignId(schedule.campaign_id);
    setEnabled(schedule.enabled);
    setStages(
      schedule.stages.map((s) => ({
        days_threshold: s.days_threshold,
        bid_percentage: Number(s.bid_percentage),
      }))
    );
    setShowEditor(true);
  };

  const addStage = () => {
    const maxDays = stages.length > 0 ? Math.max(...stages.map((s) => s.days_threshold)) : 0;
    setStages([...stages, { days_threshold: maxDays + 14, bid_percentage: 5.0 }]);
  };

  const removeStage = (index: number) => {
    setStages(stages.filter((_, i) => i !== index));
  };

  const updateStage = (index: number, field: keyof PromotionStage, value: number) => {
    setStages(stages.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const handleSave = async () => {
    if (!selectedCampaignId) {
      toast({ title: 'Select a campaign', variant: 'destructive' });
      return;
    }
    if (stages.length === 0) {
      toast({ title: 'Add at least one stage', variant: 'destructive' });
      return;
    }

    // Validate stages
    for (const stage of stages) {
      if (stage.bid_percentage < 2.0 || stage.bid_percentage > 100.0) {
        toast({
          title: 'Invalid bid percentage',
          description: 'Bid must be between 2.0% and 100.0%',
          variant: 'destructive',
        });
        return;
      }
    }

    // Check for duplicate day thresholds
    const daySet = new Set(stages.map((s) => s.days_threshold));
    if (daySet.size !== stages.length) {
      toast({
        title: 'Duplicate day thresholds',
        description: 'Each stage must have a unique number of days.',
        variant: 'destructive',
      });
      return;
    }

    const campaign = campaigns?.find((c) => c.campaignId === selectedCampaignId);

    try {
      await saveSchedule.mutateAsync({
        campaignId: selectedCampaignId,
        campaignName: campaign?.campaignName,
        enabled,
        stages: stages.map((s) => ({
          days_threshold: s.days_threshold,
          bid_percentage: s.bid_percentage,
        })),
      });
      toast({ title: 'Schedule saved' });
      setShowEditor(false);
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save schedule',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteSchedule.mutateAsync(deleteId);
      toast({ title: 'Schedule deleted' });
      setDeleteId(null);
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Failed to delete',
        variant: 'destructive',
      });
    }
  };

  const isLoading = campaignsLoading || schedulesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading schedules...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Promotion Schedules</h3>
          <p className="text-sm text-muted-foreground">
            Automatically adjust bid percentages based on how long a listing has been active.
          </p>
        </div>
        <Button onClick={openNewSchedule}>
          <Plus className="h-4 w-4 mr-1" />
          New Schedule
        </Button>
      </div>

      {/* Existing schedules */}
      {!schedules || schedules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              No promotion schedules configured yet.
              <br />
              Create one to automatically manage your promoted listing bid rates.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {schedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {schedule.campaign_name || schedule.campaign_id}
                    </CardTitle>
                    <CardDescription>Campaign ID: {schedule.campaign_id}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={schedule.enabled ? 'default' : 'secondary'}>
                      {schedule.enabled ? 'Active' : 'Paused'}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditSchedule(schedule)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(schedule.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Stage timeline */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Day 0: No promotion
                  </div>
                  {schedule.stages.map((stage, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <div className="flex items-center gap-1 text-sm">
                        <Clock className="h-3.5 w-3.5" />
                        Day {stage.days_threshold}:
                        <Badge variant="secondary" className="ml-1">
                          <Percent className="h-3 w-3 mr-0.5" />
                          {stage.bid_percentage}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Schedule Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingSchedule ? 'Edit Schedule' : 'New Promotion Schedule'}
            </DialogTitle>
            <DialogDescription>
              Define when and how promotion bid percentages should change over time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Campaign selection */}
            <div>
              <label className="text-sm font-medium">Campaign</label>
              <Select
                value={selectedCampaignId}
                onValueChange={setSelectedCampaignId}
                disabled={!!editingSchedule}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {(campaigns || []).map((c) => (
                    <SelectItem key={c.campaignId} value={c.campaignId}>
                      {c.campaignName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Enabled</label>
                <p className="text-xs text-muted-foreground">
                  When enabled, the schedule will automatically adjust bid rates.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* Stages */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium">Promotion Stages</label>
                <Button variant="outline" size="sm" onClick={addStage}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Stage
                </Button>
              </div>

              <p className="text-xs text-muted-foreground mb-3">
                Listings start with no promotion. Each stage applies after the specified number of
                days since listing.
              </p>

              <div className="space-y-3">
                {stages
                  .sort((a, b) => a.days_threshold - b.days_threshold)
                  .map((stage, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-md border bg-muted/30"
                    >
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground">After days</label>
                        <Input
                          type="number"
                          min="0"
                          value={stage.days_threshold}
                          onChange={(e) =>
                            updateStage(index, 'days_threshold', parseInt(e.target.value) || 0)
                          }
                          className="mt-1 h-8"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground">Bid %</label>
                        <Input
                          type="number"
                          min="2.0"
                          max="100.0"
                          step="0.1"
                          value={stage.bid_percentage}
                          onChange={(e) =>
                            updateStage(index, 'bid_percentage', parseFloat(e.target.value) || 2.0)
                          }
                          className="mt-1 h-8"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStage(index)}
                        className="mt-4"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
              </div>

              {stages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No stages defined. Add at least one stage.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditor(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveSchedule.isPending}>
              {saveSchedule.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open: boolean) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this promotion schedule. Existing promotions on eBay will
              not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
