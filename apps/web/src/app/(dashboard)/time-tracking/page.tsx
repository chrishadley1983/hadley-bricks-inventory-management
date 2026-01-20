'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, Edit2, Trash2, Plus, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  useTimeEntries,
  useTimeSummary,
  useCreateManualEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
  formatDuration,
  getCategoryColor,
  type TimeCategory,
  type TimeEntry,
} from '@/hooks/use-time-tracking';

const CATEGORIES: TimeCategory[] = ['Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other'];

export default function TimeTrackingPage() {
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState<TimeCategory | 'all'>('all');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntry | null>(null);

  const { toast } = useToast();

  const { data: entriesData, isLoading: isLoadingEntries } = useTimeEntries({
    page,
    limit: 20,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    dateFrom: dateFromFilter || undefined,
    dateTo: dateToFilter || undefined,
  });

  const { data: summary } = useTimeSummary();

  const createMutation = useCreateManualEntry();
  const updateMutation = useUpdateTimeEntry();
  const deleteMutation = useDeleteTimeEntry();

  const handleAddEntry = async (data: {
    category: TimeCategory;
    startedAt: string;
    endedAt: string;
    notes?: string;
  }) => {
    try {
      await createMutation.mutateAsync(data);
      toast({ title: 'Manual entry added' });
      setIsAddDialogOpen(false);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : 'Failed to add entry', variant: 'destructive' });
    }
  };

  const handleUpdateEntry = async (data: {
    id: string;
    category?: TimeCategory;
    startedAt?: string;
    endedAt?: string;
    notes?: string;
  }) => {
    try {
      await updateMutation.mutateAsync(data);
      toast({ title: 'Entry updated' });
      setEditingEntry(null);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : 'Failed to update entry', variant: 'destructive' });
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: 'Entry deleted' });
      setDeletingEntry(null);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : 'Failed to delete entry', variant: 'destructive' });
    }
  };

  const totalPages = Math.ceil((entriesData?.total || 0) / 20);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Time Tracking</h1>
          <p className="text-muted-foreground">Track and manage your time entries</p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Manual Entry
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary ? formatDuration(summary.today.total) : '--'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary ? formatDuration(summary.week.total) : '--'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Entries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{entriesData?.total || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Category:</Label>
              <Select
                value={categoryFilter}
                onValueChange={(value: string) => {
                  setCategoryFilter(value as TimeCategory | 'all');
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-sm">From:</Label>
              <Input
                type="date"
                value={dateFromFilter}
                onChange={(e) => {
                  setDateFromFilter(e.target.value);
                  setPage(1);
                }}
                className="w-[150px]"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-sm">To:</Label>
              <Input
                type="date"
                value={dateToFilter}
                onChange={(e) => {
                  setDateToFilter(e.target.value);
                  setPage(1);
                }}
                className="w-[150px]"
              />
            </div>

            {(categoryFilter !== 'all' || dateFromFilter || dateToFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryFilter('all');
                  setDateFromFilter('');
                  setDateToFilter('');
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingEntries ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : entriesData?.entries.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No time entries found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesData?.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {format(new Date(entry.startedAt), 'dd MMM yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(new Date(entry.startedAt), 'HH:mm')}
                      </TableCell>
                      <TableCell>
                        {entry.endedAt
                          ? format(new Date(entry.endedAt), 'HH:mm')
                          : '--:--'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {entry.durationSeconds
                            ? formatDuration(entry.durationSeconds)
                            : '--'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{
                              backgroundColor: getCategoryColor(entry.category as TimeCategory),
                            }}
                          />
                          {entry.category}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {entry.notes || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditingEntry(entry)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeletingEntry(entry)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Manual Entry Dialog */}
      <EntryFormDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onSubmit={handleAddEntry}
        isPending={createMutation.isPending}
        title="Add Manual Entry"
        description="Create a manual time entry for work you forgot to track."
      />

      {/* Edit Entry Dialog */}
      <EntryFormDialog
        open={!!editingEntry}
        onOpenChange={(open) => !open && setEditingEntry(null)}
        onSubmit={(data) =>
          editingEntry && handleUpdateEntry({ id: editingEntry.id, ...data })
        }
        isPending={updateMutation.isPending}
        title="Edit Entry"
        description="Update this time entry."
        initialData={editingEntry || undefined}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingEntry}
        onOpenChange={(open: boolean) => !open && setDeletingEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time entry? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingEntry && handleDeleteEntry(deletingEntry.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Entry Form Dialog Component
interface EntryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    category: TimeCategory;
    startedAt: string;
    endedAt: string;
    notes?: string;
  }) => void;
  isPending: boolean;
  title: string;
  description: string;
  initialData?: TimeEntry;
}

function EntryFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  description,
  initialData,
}: EntryFormDialogProps) {
  const [category, setCategory] = useState<TimeCategory>(
    (initialData?.category as TimeCategory) || 'Development'
  );
  const [date, setDate] = useState(
    initialData?.startedAt
      ? format(new Date(initialData.startedAt), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')
  );
  const [startTime, setStartTime] = useState(
    initialData?.startedAt
      ? format(new Date(initialData.startedAt), 'HH:mm')
      : '09:00'
  );
  const [endTime, setEndTime] = useState(
    initialData?.endedAt
      ? format(new Date(initialData.endedAt), 'HH:mm')
      : '10:00'
  );
  const [notes, setNotes] = useState(initialData?.notes || '');

  // Reset form when dialog opens with different data
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && initialData) {
      setCategory((initialData.category as TimeCategory) || 'Development');
      setDate(
        initialData.startedAt
          ? format(new Date(initialData.startedAt), 'yyyy-MM-dd')
          : format(new Date(), 'yyyy-MM-dd')
      );
      setStartTime(
        initialData.startedAt
          ? format(new Date(initialData.startedAt), 'HH:mm')
          : '09:00'
      );
      setEndTime(
        initialData.endedAt
          ? format(new Date(initialData.endedAt), 'HH:mm')
          : '10:00'
      );
      setNotes(initialData.notes || '');
    } else if (newOpen && !initialData) {
      // Reset to defaults for new entry
      setCategory('Development');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setStartTime('09:00');
      setEndTime('10:00');
      setNotes('');
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const startedAt = new Date(`${date}T${startTime}:00`).toISOString();
    const endedAt = new Date(`${date}T${endTime}:00`).toISOString();

    onSubmit({
      category,
      startedAt,
      endedAt,
      notes: notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
              {isPending ? 'Saving...' : initialData ? 'Update' : 'Add Entry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
