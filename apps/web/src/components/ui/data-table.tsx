'use client';

import * as React from 'react';
import {
  ColumnDef,
  ColumnFiltersState,
  RowSelectionState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Settings2,
  Trash2,
  Copy,
  Pencil,
  CloudUpload,
  Save,
  RotateCcw,
} from 'lucide-react';
import { Skeleton } from './skeleton';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  isLoading?: boolean;
  /** Function to extract a unique ID from each row for React keys and deduplication */
  getRowId?: (row: TData) => string;
  /** Enable row selection with checkboxes */
  enableRowSelection?: boolean;
  /** Callback when selected rows change */
  onRowSelectionChange?: (selectedRows: TData[]) => void;
  /** Bulk actions for selected rows */
  bulkActions?: {
    onDelete?: (rows: TData[]) => void;
    onDuplicate?: (rows: TData[]) => void;
    onEdit?: (rows: TData[]) => void;
    onBulkEdit?: (rows: TData[]) => void;
    onAddToAmazonSync?: (rows: TData[]) => void;
  };
  /** Enable column visibility controls */
  enableColumnVisibility?: boolean;
  /** Column display names for the visibility menu */
  columnDisplayNames?: Record<string, string>;
  /** Initial column visibility state - columns not listed default to visible */
  initialColumnVisibility?: VisibilityState;
  /** Storage key for persisting column visibility to localStorage */
  columnVisibilityStorageKey?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
    pageSizeOptions?: number[];
  };
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Search...',
  isLoading = false,
  getRowId,
  enableRowSelection = false,
  onRowSelectionChange,
  bulkActions,
  enableColumnVisibility = false,
  columnDisplayNames = {},
  initialColumnVisibility = {},
  columnVisibilityStorageKey,
  pagination,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  // Load column visibility from localStorage or use initial value
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    if (columnVisibilityStorageKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(columnVisibilityStorageKey);
        if (saved) {
          return JSON.parse(saved) as VisibilityState;
        }
      } catch {
        // If parsing fails, fall back to initial value
      }
    }
    return initialColumnVisibility;
  });

  // Save column visibility as default
  const saveColumnVisibilityAsDefault = React.useCallback(() => {
    if (columnVisibilityStorageKey && typeof window !== 'undefined') {
      localStorage.setItem(columnVisibilityStorageKey, JSON.stringify(columnVisibility));
    }
  }, [columnVisibilityStorageKey, columnVisibility]);

  // Reset to initial (non-saved) defaults
  const resetColumnVisibility = React.useCallback(() => {
    setColumnVisibility(initialColumnVisibility);
    if (columnVisibilityStorageKey && typeof window !== 'undefined') {
      localStorage.removeItem(columnVisibilityStorageKey);
    }
  }, [initialColumnVisibility, columnVisibilityStorageKey]);

  // Build columns with selection checkbox if enabled
  const tableColumns = React.useMemo(() => {
    if (!enableRowSelection) return columns;

    const selectColumn: ColumnDef<TData, TValue> = {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value: boolean | 'indeterminate') =>
            table.toggleAllPageRowsSelected(!!value)
          }
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value: boolean | 'indeterminate') => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    };

    return [selectColumn, ...columns];
  }, [columns, enableRowSelection]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: pagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    manualPagination: !!pagination,
    getRowId,
  });

  // Get selected rows data
  const selectedRows = React.useMemo(() => {
    return table.getFilteredSelectedRowModel().rows.map((row) => row.original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getFilteredSelectedRowModel().rows]);

  // Notify parent of selection changes
  React.useEffect(() => {
    onRowSelectionChange?.(selectedRows);
  }, [selectedRows, onRowSelectionChange]);

  const getColumnDisplayName = (columnId: string): string => {
    return (
      columnDisplayNames[columnId] ||
      columnId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    );
  };

  const pageSizeOptions = pagination?.pageSizeOptions || PAGE_SIZE_OPTIONS;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {searchKey && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ''}
                onChange={(event) => table.getColumn(searchKey)?.setFilterValue(event.target.value)}
                className="max-w-sm pl-9"
              />
            </div>
          )}

          {/* Bulk Actions - shown when rows are selected */}
          {enableRowSelection && selectedRows.length > 0 && (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-sm text-muted-foreground">{selectedRows.length} selected</span>
              {bulkActions?.onEdit && selectedRows.length === 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkActions.onEdit?.(selectedRows)}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
              {bulkActions?.onBulkEdit && selectedRows.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkActions.onBulkEdit?.(selectedRows)}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Bulk Edit
                </Button>
              )}
              {bulkActions?.onDuplicate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkActions.onDuplicate?.(selectedRows)}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Duplicate
                </Button>
              )}
              {bulkActions?.onAddToAmazonSync && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkActions.onAddToAmazonSync?.(selectedRows)}
                >
                  <CloudUpload className="h-4 w-4 mr-1" />
                  Amazon Sync
                </Button>
              )}
              {bulkActions?.onDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => bulkActions.onDelete?.(selectedRows)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Rows per page selector */}
          {pagination?.onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select
                value={String(pagination.pageSize)}
                onValueChange={(value: string) => pagination.onPageSizeChange?.(Number(value))}
              >
                <SelectTrigger className="w-[70px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Column visibility dropdown */}
          {enableColumnVisibility && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings2 className="h-4 w-4 mr-1" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[200px] max-h-[400px] overflow-y-auto">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(value: boolean) => column.toggleVisibility(!!value)}
                      >
                        {getColumnDisplayName(column.id)}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                {columnVisibilityStorageKey && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="p-1 space-y-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={saveColumnVisibilityAsDefault}
                      >
                        <Save className="h-3.5 w-3.5 mr-2" />
                        Save as Default
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={resetColumnVisibility}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-2" />
                        Reset to Default
                      </Button>
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((_, colIndex) => (
                    <TableCell key={`skeleton-${rowIndex}-${colIndex}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {enableRowSelection && (
              <span>
                {table.getFilteredSelectedRowModel().rows.length} of{' '}
                {table.getFilteredRowModel().rows.length} row(s) selected
              </span>
            )}
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} items)
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {!pagination && (
        <div className="flex items-center justify-end space-x-2 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
