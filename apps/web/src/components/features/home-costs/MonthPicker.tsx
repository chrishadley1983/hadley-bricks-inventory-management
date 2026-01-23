'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MonthPickerProps {
  value: string; // 'YYYY-MM' format
  onChange: (value: string) => void;
  minYear?: number;
  maxYear?: number;
}

/**
 * Month Picker Component
 * Select component for choosing month and year
 * U4: Month picker displays "Month YYYY" format
 */
export function MonthPicker({
  value,
  onChange,
  minYear = 2020,
  maxYear = new Date().getFullYear() + 2,
}: MonthPickerProps) {
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  // Generate year options
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) {
    years.push(y);
  }

  // Generate all month-year combinations
  const options: { value: string; label: string }[] = [];
  for (const year of years) {
    for (const month of months) {
      options.push({
        value: `${year}-${month.value}`,
        label: `${month.label} ${year}`,
      });
    }
  }

  // Find display value
  const displayValue = options.find((o) => o.value === value)?.label || 'Select month';

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select month">{value ? displayValue : 'Select month'}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
