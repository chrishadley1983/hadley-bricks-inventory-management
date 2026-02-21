'use client';

import { useState } from 'react';
import { CalendarDays, Plus, Truck, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MiniCalendar } from './MiniCalendar';
import { PickupCard } from './PickupCard';
import { SchedulePickupDialog } from './SchedulePickupDialog';
import { CompletePickupDialog } from './CompletePickupDialog';
import {
  useMonthPickups,
  usePickupStats,
  useCancelPickup,
  useDeletePickup,
  type StockPickup,
} from '@/hooks/use-pickups';
import { useToast } from '@/hooks/use-toast';

export function PickupCalendarPanel() {
  const { toast } = useToast();
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedPickup, setSelectedPickup] = useState<StockPickup | null>(null);

  const { data: monthData, isLoading: pickupsLoading } = useMonthPickups(
    selectedYear,
    selectedMonth
  );
  const { data: stats, isLoading: statsLoading } = usePickupStats();
  const cancelPickup = useCancelPickup();
  const deletePickup = useDeletePickup();
  const [editingPickup, setEditingPickup] = useState<StockPickup | null>(null);

  const pickups = monthData?.pickups || [];

  // Filter pickups for selected date
  const selectedDatePickups = selectedDate
    ? pickups.filter((p) => p.scheduled_date === selectedDate)
    : [];

  // Get upcoming pickups (scheduled, not in the past)
  const todayStr = today.toISOString().split('T')[0];
  const upcomingPickups = pickups
    .filter((p) => p.status === 'scheduled' && p.scheduled_date >= todayStr)
    .slice(0, 3);

  const handleMonthChange = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
    setSelectedDate(null);
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(selectedDate === date ? null : date);
  };

  const handleCompletePickup = (pickup: StockPickup) => {
    setSelectedPickup(pickup);
    setCompleteDialogOpen(true);
  };

  const handleCancelPickup = async (pickup: StockPickup) => {
    try {
      await cancelPickup.mutateAsync(pickup.id);
      toast({
        title: 'Pickup cancelled',
        description: `${pickup.title} has been cancelled.`,
      });
    } catch {
      toast({
        title: 'Failed to cancel pickup',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSchedule = () => {
    setEditingPickup(null);
    setScheduleDialogOpen(true);
  };

  const handleEditPickup = (pickup: StockPickup) => {
    setEditingPickup(pickup);
    setScheduleDialogOpen(true);
  };

  const handleDeletePickup = async (pickup: StockPickup) => {
    if (!confirm(`Are you sure you want to delete "${pickup.title}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deletePickup.mutateAsync(pickup.id);
      toast({
        title: 'Pickup deleted',
        description: `${pickup.title} has been deleted.`,
      });
    } catch {
      toast({
        title: 'Failed to delete pickup',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const formatCurrency = (value: number): string => {
    return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Stock Pickups
          </CardTitle>
          <Button size="sm" onClick={handleSchedule}>
            <Plus className="h-4 w-4 mr-1" />
            Schedule
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats Row */}
          {statsLoading ? (
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Truck className="h-3.5 w-3.5" />
                  <span>Upcoming</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.upcoming}</p>
                <p className="text-xs text-muted-foreground">{stats.thisWeek} this week</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span>This Month</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.completedThisMonth}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(stats.totalValueThisMonth)} spent
                </p>
              </div>
            </div>
          ) : null}

          {/* Calendar */}
          {pickupsLoading ? (
            <Skeleton className="h-[280px]" />
          ) : (
            <MiniCalendar
              year={selectedYear}
              month={selectedMonth}
              pickups={pickups}
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              onMonthChange={handleMonthChange}
            />
          )}

          {/* Selected Date Pickups */}
          {selectedDate && selectedDatePickups.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">
                {new Date(selectedDate).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </h4>
              <div className="space-y-2">
                {selectedDatePickups.map((pickup) => (
                  <PickupCard
                    key={pickup.id}
                    pickup={pickup}
                    compact
                    onComplete={handleCompletePickup}
                    onCancel={handleCancelPickup}
                    onEdit={handleEditPickup}
                    onDelete={handleDeletePickup}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Upcoming Pickups (when no date selected) */}
          {!selectedDate && upcomingPickups.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Upcoming</h4>
              <div className="space-y-2">
                {upcomingPickups.map((pickup) => (
                  <PickupCard
                    key={pickup.id}
                    pickup={pickup}
                    compact
                    onComplete={handleCompletePickup}
                    onCancel={handleCancelPickup}
                    onEdit={handleEditPickup}
                    onDelete={handleDeletePickup}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!selectedDate && upcomingPickups.length === 0 && !pickupsLoading && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No upcoming pickups scheduled.</p>
              <Button variant="link" size="sm" className="mt-1" onClick={handleSchedule}>
                Schedule your first pickup
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <SchedulePickupDialog
        open={scheduleDialogOpen}
        onOpenChange={(open) => {
          setScheduleDialogOpen(open);
          if (!open) setEditingPickup(null);
        }}
        initialDate={selectedDate || undefined}
        pickup={editingPickup}
      />
      <CompletePickupDialog
        open={completeDialogOpen}
        onOpenChange={setCompleteDialogOpen}
        pickup={selectedPickup}
      />
    </>
  );
}
