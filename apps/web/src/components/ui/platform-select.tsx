'use client';

import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SELLING_PLATFORMS,
  TARGET_PLATFORMS,
  PLATFORM_LABELS,
  type SellingPlatform,
} from '@hadley-bricks/database';

interface PlatformSelectProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  tier?: 'selling' | 'target';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Whether to allow clearing the selection (show empty option) */
  allowClear?: boolean;
}

/**
 * Reusable platform select dropdown component.
 *
 * @param tier - 'selling' for Amazon/eBay/BrickLink, 'target' for Amazon/eBay only
 * @param allowClear - If true, allows selecting an empty value to clear
 */
export function PlatformSelect({
  value,
  onChange,
  tier = 'selling',
  placeholder = 'Select platform...',
  disabled,
  className,
  allowClear = false,
}: PlatformSelectProps) {
  const platforms = tier === 'target' ? TARGET_PLATFORMS : SELLING_PLATFORMS;

  return (
    <Select
      value={value || ''}
      onValueChange={(val: string) => onChange(val === '__clear__' ? '' : val)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowClear && (
          <SelectItem value="__clear__" className="text-muted-foreground">
            None
          </SelectItem>
        )}
        {platforms.map((platform) => (
          <SelectItem key={platform} value={platform}>
            {PLATFORM_LABELS[platform as SellingPlatform]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Platform select for use with react-hook-form Controller
 */
interface ControlledPlatformSelectProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  tier?: 'selling' | 'target';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ControlledPlatformSelect({
  value,
  onChange,
  tier = 'selling',
  placeholder = 'Select platform...',
  disabled,
  className,
}: ControlledPlatformSelectProps) {
  const platforms = tier === 'target' ? TARGET_PLATFORMS : SELLING_PLATFORMS;

  return (
    <Select
      value={value || ''}
      onValueChange={(val: string) => onChange(val || null)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {platforms.map((platform) => (
          <SelectItem key={platform} value={platform}>
            {PLATFORM_LABELS[platform as SellingPlatform]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
