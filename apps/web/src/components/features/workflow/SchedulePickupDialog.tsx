'use client';

import { useState, useEffect } from 'react';
import { CalendarDays, MapPin, Calendar, Check, ExternalLink, Loader2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { useCreatePickup, useUpdatePickup, type CreatePickupInput, type StockPickup } from '@/hooks/use-pickups';
import {
  useGoogleCalendarStatus,
  useConnectGoogleCalendar,
  useSyncPickupToCalendar,
} from '@/hooks/use-google-calendar';

interface SchedulePickupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: string;
  pickup?: StockPickup | null;
}

const SOURCE_PLATFORMS = [
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'gumtree', label: 'Gumtree' },
  { value: 'ebay', label: 'eBay Collection' },
  { value: 'bricklink', label: 'BrickLink' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' },
];

const getInitialFormData = (pickup?: StockPickup | null, initialDate?: string): CreatePickupInput => ({
  title: pickup?.title || '',
  description: pickup?.description || null,
  scheduled_date: pickup?.scheduled_date || initialDate || new Date().toISOString().split('T')[0],
  scheduled_time: pickup?.scheduled_time || null,
  scheduled_end_time: pickup?.scheduled_end_time || null,
  address_line1: pickup?.address_line1 || '',
  address_line2: pickup?.address_line2 || null,
  city: pickup?.city || '',
  postcode: pickup?.postcode || '',
  estimated_value: pickup?.estimated_value || null,
  agreed_price: pickup?.agreed_price || null,
  estimated_duration_minutes: pickup?.estimated_duration_minutes || 30,
  source_platform: pickup?.source_platform || null,
  notes: pickup?.notes || null,
  reminder_day_before: pickup?.reminder_day_before ?? true,
});

export function SchedulePickupDialog({
  open,
  onOpenChange,
  initialDate,
  pickup,
}: SchedulePickupDialogProps) {
  const { toast } = useToast();
  const createPickup = useCreatePickup();
  const updatePickup = useUpdatePickup();
  const isEditing = !!pickup;

  // Google Calendar hooks
  const { data: calendarStatus, isLoading: isLoadingCalendarStatus } = useGoogleCalendarStatus();
  const connectCalendar = useConnectGoogleCalendar();
  const syncToCalendar = useSyncPickupToCalendar();

  const isCalendarConnected = calendarStatus?.isConnected ?? false;
  const isPickupSynced = !!pickup?.google_calendar_event_id;

  const [formData, setFormData] = useState<CreatePickupInput>(() =>
    getInitialFormData(pickup, initialDate)
  );

  // Reset form when dialog opens/closes or pickup changes
  useEffect(() => {
    if (open) {
      setFormData(getInitialFormData(pickup, initialDate));
    }
  }, [open, pickup, initialDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast({
        title: 'Title required',
        description: 'Please enter a title for the pickup.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.address_line1.trim() || !formData.city.trim() || !formData.postcode.trim()) {
      toast({
        title: 'Address required',
        description: 'Please enter the pickup address.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (isEditing && pickup) {
        await updatePickup.mutateAsync({ id: pickup.id, ...formData });
        toast({
          title: 'Pickup updated',
          description: `${formData.title} has been updated.`,
        });
      } else {
        await createPickup.mutateAsync(formData);
        toast({
          title: 'Pickup scheduled',
          description: `${formData.title} has been scheduled.`,
        });
      }
      onOpenChange(false);
    } catch {
      toast({
        title: isEditing ? 'Failed to update pickup' : 'Failed to schedule pickup',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const updateField = <K extends keyof CreatePickupInput>(
    field: K,
    value: CreatePickupInput[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSyncToCalendar = async () => {
    if (!pickup?.id) return;

    try {
      await syncToCalendar.mutateAsync(pickup.id);
      toast({
        title: 'Synced to Google Calendar',
        description: 'The pickup has been added to your Google Calendar.',
      });
    } catch (error) {
      toast({
        title: 'Failed to sync',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleConnectCalendar = () => {
    // Pass the current URL so user returns here after connecting
    connectCalendar.mutate(window.location.pathname);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {isEditing ? 'Edit Pickup' : 'Schedule Stock Pickup'}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the pickup details.' : 'Add a new stock pickup to your calendar.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="e.g., Bulk Lego lot from John"
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Details about the pickup..."
              value={formData.description || ''}
              onChange={(e) => updateField('description', e.target.value || null)}
              rows={2}
            />
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="date">Date *</Label>
            <Input
              id="date"
              type="date"
              value={formData.scheduled_date}
              onChange={(e) => updateField('scheduled_date', e.target.value)}
            />
          </div>

          {/* Start and End Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time</Label>
              <Input
                id="start-time"
                type="time"
                value={formData.scheduled_time || ''}
                onChange={(e) => updateField('scheduled_time', e.target.value || null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time</Label>
              <Input
                id="end-time"
                type="time"
                value={formData.scheduled_end_time || ''}
                onChange={(e) => updateField('scheduled_end_time', e.target.value || null)}
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              Address *
            </Label>
            <Input
              placeholder="Address line 1"
              value={formData.address_line1}
              onChange={(e) => updateField('address_line1', e.target.value)}
            />
            <Input
              placeholder="Address line 2 (optional)"
              value={formData.address_line2 || ''}
              onChange={(e) => updateField('address_line2', e.target.value || null)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="City"
                value={formData.city}
                onChange={(e) => updateField('city', e.target.value)}
              />
              <Input
                placeholder="Postcode"
                value={formData.postcode}
                onChange={(e) => updateField('postcode', e.target.value)}
              />
            </div>
          </div>

          {/* Financial Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimated_value">Estimated Value</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  £
                </span>
                <Input
                  id="estimated_value"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="pl-7"
                  value={formData.estimated_value ?? ''}
                  onChange={(e) =>
                    updateField(
                      'estimated_value',
                      e.target.value ? parseFloat(e.target.value) : null
                    )
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agreed_price">Agreed Price</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  £
                </span>
                <Input
                  id="agreed_price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="pl-7"
                  value={formData.agreed_price ?? ''}
                  onChange={(e) =>
                    updateField(
                      'agreed_price',
                      e.target.value ? parseFloat(e.target.value) : null
                    )
                  }
                />
              </div>
            </div>
          </div>

          {/* Source Platform */}
          <div className="space-y-2">
            <Label htmlFor="source_platform">Source Platform</Label>
            <Select
              value={formData.source_platform || undefined}
              onValueChange={(value: string) => updateField('source_platform', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Where did you find this?" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_PLATFORMS.map((platform) => (
                  <SelectItem key={platform.value} value={platform.value}>
                    {platform.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes..."
              value={formData.notes || ''}
              onChange={(e) => updateField('notes', e.target.value || null)}
              rows={2}
            />
          </div>

          {/* Google Calendar Section - Only show when editing */}
          {isEditing && (
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Google Calendar</Label>
              </div>

              {isLoadingCalendarStatus ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking calendar status...
                </div>
              ) : !isCalendarConnected ? (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    Connect Google Calendar to sync this pickup.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleConnectCalendar}
                    disabled={connectCalendar.isPending}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Connect Google Calendar
                  </Button>
                </div>
              ) : isPickupSynced ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <Check className="h-4 w-4" />
                    <span>Synced to Google Calendar</span>
                  </div>
                  <p className="text-xs text-green-600 mt-1">
                    Changes will auto-sync when you save.
                  </p>
                </div>
              ) : (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    Add this pickup to your Google Calendar.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSyncToCalendar}
                    disabled={syncToCalendar.isPending}
                  >
                    {syncToCalendar.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Calendar className="h-4 w-4 mr-2" />
                        Send to Calendar
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createPickup.isPending || updatePickup.isPending}>
              {isEditing
                ? updatePickup.isPending
                  ? 'Saving...'
                  : 'Save Changes'
                : createPickup.isPending
                  ? 'Scheduling...'
                  : 'Schedule Pickup'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
