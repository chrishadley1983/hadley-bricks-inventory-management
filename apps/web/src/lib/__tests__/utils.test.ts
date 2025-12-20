import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '../utils';

describe('cn utility', () => {
  it('merges class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('merges tailwind classes correctly', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});

describe('formatCurrency', () => {
  it('formats GBP correctly', () => {
    expect(formatCurrency(1234.56)).toBe('£1,234.56');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('£0.00');
  });

  it('handles negative values', () => {
    expect(formatCurrency(-50)).toBe('-£50.00');
  });

  it('formats other currencies', () => {
    expect(formatCurrency(100, 'USD')).toBe('US$100.00');
  });
});

describe('formatDate', () => {
  it('formats date string correctly', () => {
    const result = formatDate('2024-01-15');
    expect(result).toBe('15 Jan 2024');
  });

  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });
});

describe('formatRelativeTime', () => {
  it('formats just now', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('Just now');
  });

  it('formats minutes ago', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('formats days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
  });

  it('formats older dates as full date', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoWeeksAgo);
    // Should be formatted as a date, not relative
    expect(result).toMatch(/\d{1,2} \w{3} \d{4}/);
  });
});
