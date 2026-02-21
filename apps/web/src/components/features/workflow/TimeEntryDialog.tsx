'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useToast } from '@/hooks/use-toast';
import {
  useCreateManualEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
  formatDuration,
  type TimeCategory,
  type TimeEntry,
} from '@/hooks/use-time-tracking';

const CATEGORIES: TimeCategory[] = [
  'Development',
  'Listing',
  'Shipping',
  'Sourcing',
  'Admin',
  'Other',
];

export type TimeEntryDialogMode = 'add' | 'edit' | 'duplicate';

interface TimeEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: TimeEntryDialogMode;
  entry?: TimeEntry | null;
}

export function TimeEntryDialog({ open, onOpenChange, mode, entry }: TimeEntryDialogProps) {
  const { toast } = useToast();

  const createMutation = useCreateManualEntry();
  const updateMutation = useUpdateTimeEntry();

  const [category, setCategory] = useState<TimeCategory>('Development');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [notes, setNotes] = useState('');

  // Calculate duration preview
  const getDurationPreview = (): string => {
    try {
      const start = new Date(`${date}T${startTime}:00`);
      const end = new Date(`${date}T${endTime}:00`);
      const diffSeconds = Math.floor((end.getTime() - start.getTime()) / 1000);
      if (diffSeconds <= 0) return 'Invalid time range';
      return formatDuration(diffSeconds);
    } catch {
      return '--';
    }
  };

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (entry && (mode === 'edit' || mode === 'duplicate')) {
        setCategory((entry.category as TimeCategory) || 'Development');
        setDate(
          entry.startedAt
            ? format(new Date(entry.startedAt), 'yyyy-MM-dd')
            : format(new Date(), 'yyyy-MM-dd')
        );
        setStartTime(entry.startedAt ? format(new Date(entry.startedAt), 'HH:mm') : '09:00');
        setEndTime(entry.endedAt ? format(new Date(entry.endedAt), 'HH:mm') : '10:00');
        // For duplicate, add a note prefix
        setNotes(
          mode === 'duplicate'
            ? entry.notes
              ? `(Copy) ${entry.notes}`
              : '(Copy)'
            : entry.notes || ''
        );
      } else {
        // Reset to defaults for new entry
        setCategory('Development');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setStartTime('09:00');
        setEndTime('10:00');
        setNotes('');
      }
    }
  }, [open, entry, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const startedAt = new Date(`${date}T${startTime}:00`).toISOString();
    const endedAt = new Date(`${date}T${endTime}:00`).toISOString();

    // Validate end time is after start time
    if (new Date(endedAt) <= new Date(startedAt)) {
      toast({ title: 'End time must be after start time', variant: 'destructive' });
      return;
    }

    try {
      if (mode === 'edit' && entry) {
        await updateMutation.mutateAsync({
          id: entry.id,
          category,
          startedAt,
          endedAt,
          notes: notes || undefined,
        });
        toast({ title: 'Entry updated' });
      } else {
        // Add or duplicate - both create a new entry
        await createMutation.mutateAsync({
          category,
          startedAt,
          endedAt,
          notes: notes || undefined,
        });
        toast({ title: mode === 'duplicate' ? 'Entry duplicated' : 'Manual entry added' });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to save entry',
        variant: 'destructive',
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const getTitle = () => {
    switch (mode) {
      case 'add':
        return 'Add Manual Entry';
      case 'edit':
        return 'Edit Entry';
      case 'duplicate':
        return 'Duplicate Entry';
    }
  };

  const getDescription = () => {
    switch (mode) {
      case 'add':
        return 'Create a manual time entry for work you forgot to track.';
      case 'edit':
        return 'Update this time entry.';
      case 'duplicate':
        return 'Create a copy of this time entry.';
    }
  };

  const getSubmitLabel = () => {
    if (isPending) return 'Saving...';
    switch (mode) {
      case 'add':
        return 'Add Entry';
      case 'edit':
        return 'Update';
      case 'duplicate':
        return 'Create Copy';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'duplicate' && <Copy className="h-4 w-4" />}
            {getTitle()}
          </DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={(value: string) => setCategory(value as TimeCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Duration preview */}
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Duration: </span>
            <span className="font-medium">{getDurationPreview()}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What were you working on?"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {getSubmitLabel()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteTimeEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TimeEntry | null;
}

export function DeleteTimeEntryDialog({ open, onOpenChange, entry }: DeleteTimeEntryDialogProps) {
  const { toast } = useToast();
  const deleteMutation = useDeleteTimeEntry();

  const handleDelete = async () => {
    if (!entry) return;

    try {
      await deleteMutation.mutateAsync(entry.id);
      toast({ title: 'Entry deleted' });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to delete entry',
        variant: 'destructive',
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Time Entry</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this time entry? This action cannot be undone.
            {entry && (
              <span className="mt-2 block text-sm">
                <strong>{entry.category}</strong> -{' '}
                {entry.startedAt ? format(new Date(entry.startedAt), 'dd MMM yyyy HH:mm') : ''}
                {entry.durationSeconds && ` (${formatDuration(entry.durationSeconds)})`}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
