'use client';

import { Skeleton } from './skeleton';
import { Card, CardContent, CardHeader } from './card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

interface TableSkeletonProps {
  /** Number of columns to render */
  columns?: number;
  /** Number of rows to render */
  rows?: number;
  /** Show search bar skeleton */
  showSearch?: boolean;
  /** Show pagination skeleton */
  showPagination?: boolean;
}

/**
 * Skeleton loader for DataTable components
 */
export function TableSkeleton({
  columns = 6,
  rows = 8,
  showSearch = true,
  showPagination = true,
}: TableSkeletonProps) {
  return (
    <div className="space-y-4">
      {/* Search bar skeleton */}
      {showSearch && (
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
      )}

      {/* Table skeleton */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={i}>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <TableRow key={rowIndex}>
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <TableCell key={colIndex}>
                    <Skeleton
                      className="h-4"
                      style={{
                        width: `${60 + Math.random() * 40}%`,
                      }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination skeleton */}
      {showPagination && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Skeleton loader for page headers
 */
export function HeaderSkeleton() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <Skeleton className="h-6 w-32" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
      </div>
    </header>
  );
}

interface WidgetCardSkeletonProps {
  /** Show icon placeholder */
  showIcon?: boolean;
  /** Number of content lines */
  lines?: number;
}

/**
 * Skeleton loader for dashboard widget cards
 */
export function WidgetCardSkeleton({ showIcon = true, lines = 3 }: WidgetCardSkeletonProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        {showIcon && <Skeleton className="h-4 w-4" />}
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: i === 0 ? '60%' : `${40 + Math.random() * 40}%` }}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton loader for stat/metric cards with large value display
 */
export function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-28 mb-1" />
        <Skeleton className="h-3 w-20" />
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton loader for page title and description area
 */
export function PageTitleSkeleton() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-10 w-28" />
    </div>
  );
}

/**
 * Full page skeleton combining header, title, and table
 */
export function PageSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        <PageTitleSkeleton />
        <TableSkeleton />
      </div>
    </>
  );
}

/**
 * Dashboard page skeleton with widget grid
 */
export function DashboardSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-6">
        {/* Controls skeleton */}
        <div className="mb-4 flex flex-wrap items-center justify-end gap-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-6 w-32" />
        </div>

        {/* Top widgets grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCardSkeleton />
          <WidgetCardSkeleton lines={4} />
          <div className="md:col-span-2">
            <WidgetCardSkeleton lines={5} />
          </div>
        </div>

        {/* Bottom widgets grid */}
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <WidgetCardSkeleton lines={6} />
          <WidgetCardSkeleton lines={4} />
        </div>
      </div>
    </>
  );
}
