'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, Edit2, Trash2, Plus, Filter, Copy } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import {
  TimeEntryDialog,
  DeleteTimeEntryDialog,
  type TimeEntryDialogMode,
} from '@/components/features/workflow/TimeEntryDialog';
import {
  useTimeEntries,
  useTimeSummary,
  formatDuration,
  getCategoryColor,
  type TimeCategory,
  type TimeEntry,
} from '@/hooks/use-time-tracking';

const CATEGORIES: TimeCategory[] = ['Development', 'Listing', 'Shipping', 'Sourcing', 'Admin', 'Other'];

export default function TimeTrackingPage() {
  usePerfPage('TimeTrackingPage');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState<TimeCategory | 'all'>('all');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<TimeEntryDialogMode>('add');
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: entriesData, isLoading: isLoadingEntries } = useTimeEntries({
    page,
    limit: 20,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    dateFrom: dateFromFilter || undefined,
    dateTo: dateToFilter || undefined,
  });

  const { data: summary } = useTimeSummary();

  const handleAddEntry = () => {
    setSelectedEntry(null);
    setDialogMode('add');
    setDialogOpen(true);
  };

  const handleEditEntry = (entry: TimeEntry) => {
    setSelectedEntry(entry);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  const handleDuplicateEntry = (entry: TimeEntry) => {
    setSelectedEntry(entry);
    setDialogMode('duplicate');
    setDialogOpen(true);
  };

  const handleDeleteEntry = (entry: TimeEntry) => {
    setSelectedEntry(entry);
    setDeleteDialogOpen(true);
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
        <Button onClick={handleAddEntry}>
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
                          {entry.isManualEntry && (
                            <Badge variant="secondary" className="ml-1 text-xs">
                              Manual
                            </Badge>
                          )}
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
                        <TooltipProvider>
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleEditEntry(entry)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit entry</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleDuplicateEntry(entry)}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Duplicate entry</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteEntry(entry)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete entry</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
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

      {/* Entry Dialog (Add/Edit/Duplicate) */}
      <TimeEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        entry={selectedEntry}
      />

      {/* Delete Confirmation */}
      <DeleteTimeEntryDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        entry={selectedEntry}
      />
    </div>
  );
}
