'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DateRangePreset } from '@/lib/services';

interface DateRangePickerProps {
  startDate?: Date;
  endDate?: Date;
  preset?: DateRangePreset;
  onDateChange: (start: Date, end: Date, preset?: DateRangePreset) => void;
  showPresets?: boolean;
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'last_quarter', label: 'Last Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'last_year', label: 'Last Year' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'last_90_days', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom Range' },
];

function getPresetDates(preset: DateRangePreset): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  switch (preset) {
    case 'this_month':
      start.setDate(1);
      end.setMonth(end.getMonth() + 1, 0);
      break;
    case 'last_month':
      start.setMonth(start.getMonth() - 1, 1);
      end.setDate(0);
      break;
    case 'this_quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      start.setMonth(quarter * 3, 1);
      end.setMonth(quarter * 3 + 3, 0);
      break;
    }
    case 'last_quarter': {
      const lastQuarter = Math.floor(now.getMonth() / 3) - 1;
      const year = lastQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const adjustedQuarter = lastQuarter < 0 ? 3 : lastQuarter;
      start.setFullYear(year, adjustedQuarter * 3, 1);
      end.setFullYear(year, adjustedQuarter * 3 + 3, 0);
      break;
    }
    case 'this_year':
      start.setMonth(0, 1);
      end.setMonth(11, 31);
      break;
    case 'last_year':
      start.setFullYear(start.getFullYear() - 1, 0, 1);
      end.setFullYear(end.getFullYear() - 1, 11, 31);
      break;
    case 'last_30_days':
      start.setDate(start.getDate() - 30);
      break;
    case 'last_90_days':
      start.setDate(start.getDate() - 90);
      break;
    default:
      break;
  }

  return { start, end };
}

export function DateRangePicker({
  startDate,
  endDate,
  preset,
  onDateChange,
  showPresets = true,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedPreset, setSelectedPreset] = React.useState<DateRangePreset>(
    preset || 'this_month'
  );
  const [dateRange, setDateRange] = React.useState<{ from?: Date; to?: Date }>({
    from: startDate,
    to: endDate,
  });

  React.useEffect(() => {
    if (preset && preset !== 'custom') {
      const { start, end } = getPresetDates(preset);
      setDateRange({ from: start, to: end });
    }
  }, [preset]);

  const handlePresetChange = (value: DateRangePreset) => {
    setSelectedPreset(value);
    if (value !== 'custom') {
      const { start, end } = getPresetDates(value);
      setDateRange({ from: start, to: end });
      onDateChange(start, end, value);
    }
  };

  const handleDateSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range) {
      setDateRange(range);
      if (range.from && range.to) {
        setSelectedPreset('custom');
        onDateChange(range.from, range.to, 'custom');
      }
    }
  };

  return (
    <div className="flex items-center gap-2">
      {showPresets && (
        <Select value={selectedPreset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'w-[260px] justify-start text-left font-normal',
              !dateRange.from && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {dateRange.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, 'MMM d, yyyy')} - {format(dateRange.to, 'MMM d, yyyy')}
                </>
              ) : (
                format(dateRange.from, 'MMM d, yyyy')
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange.from && dateRange.to ? { from: dateRange.from, to: dateRange.to } : undefined}
            onSelect={handleDateSelect}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
