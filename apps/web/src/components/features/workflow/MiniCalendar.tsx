'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { StockPickup } from '@/hooks/use-pickups';
import { getDaysInMonth, getFirstDayOfMonth, groupPickupsByDate } from '@/hooks/use-pickups';

interface MiniCalendarProps {
  year: number;
  month: number;
  pickups: StockPickup[];
  selectedDate: string | null;
  onDateSelect: (date: string) => void;
  onMonthChange: (year: number, month: number) => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function MiniCalendar({
  year,
  month,
  pickups,
  selectedDate,
  onDateSelect,
  onMonthChange,
}: MiniCalendarProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfMonth = getFirstDayOfMonth(year, month);

  // Adjust first day to start from Monday (0 = Monday, 6 = Sunday)
  const firstDayAdjusted = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const pickupsByDate = groupPickupsByDate(pickups);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const handlePrevMonth = () => {
    if (month === 1) {
      onMonthChange(year - 1, 12);
    } else {
      onMonthChange(year, month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      onMonthChange(year + 1, 1);
    } else {
      onMonthChange(year, month + 1);
    }
  };

  const formatDate = (day: number): string => {
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  };

  // Generate calendar grid
  const calendarDays: (number | null)[] = [];

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < firstDayAdjusted; i++) {
    calendarDays.push(null);
  }

  // Add days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  return (
    <div className="w-full">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="icon" onClick={handlePrevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {MONTHS[month - 1]} {year}
        </span>
        <Button variant="ghost" size="icon" onClick={handleNextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS.map((day) => (
          <div key={day} className="text-xs text-muted-foreground text-center font-medium py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="h-8" />;
          }

          const dateStr = formatDate(day);
          const datePickups = pickupsByDate[dateStr] || [];
          const hasPickups = datePickups.length > 0;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const hasScheduled = datePickups.some((p) => p.status === 'scheduled');
          const hasCompleted = datePickups.some((p) => p.status === 'completed');

          return (
            <button
              key={day}
              onClick={() => onDateSelect(dateStr)}
              className={cn(
                'h-8 w-full rounded-md text-sm relative transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                isToday && 'font-bold',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                !isSelected && isToday && 'border border-primary'
              )}
            >
              {day}
              {/* Pickup indicators */}
              {hasPickups && !isSelected && (
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {hasScheduled && <div className="h-1 w-1 rounded-full bg-blue-500" />}
                  {hasCompleted && <div className="h-1 w-1 rounded-full bg-green-500" />}
                </div>
              )}
              {hasPickups && isSelected && (
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                  <div className="h-1 w-1 rounded-full bg-primary-foreground" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span>Scheduled</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>Completed</span>
        </div>
      </div>
    </div>
  );
}
