'use client';

import { cn } from '@/lib/utils';

interface PomodoroProgressProps {
  /** Progress value from 0 to 100 */
  progress: number;
  /** Size of the circle in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Color for work phase */
  workColor?: string;
  /** Color for break phase */
  breakColor?: string;
  /** Whether currently in break phase */
  isBreak?: boolean;
  /** Children to render in center */
  children?: React.ReactNode;
  className?: string;
}

export function PomodoroProgress({
  progress,
  size = 48,
  strokeWidth = 4,
  workColor = 'hsl(var(--primary))',
  breakColor = 'hsl(142.1 76.2% 36.3%)', // Green for break
  isBreak = false,
  children,
  className,
}: PomodoroProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const color = isBreak ? breakColor : workColor;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        className="transform -rotate-90"
        width={size}
        height={size}
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      {/* Center content */}
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
