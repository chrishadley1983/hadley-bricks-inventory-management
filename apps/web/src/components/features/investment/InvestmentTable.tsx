'use client';

import { useState, useMemo } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { getInvestmentColumns, COLUMN_DISPLAY_NAMES } from './InvestmentColumns';
import { InvestmentFilters } from './InvestmentFilters';
import { useInvestmentSets } from '@/hooks/use-investment';
import type { InvestmentFilters as Filters } from '@/lib/api/investment';

export function InvestmentTable() {
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data, isLoading, error } = useInvestmentSets(filters, { page, pageSize });

  const handleFiltersChange = (newFilters: Filters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  const columns = useMemo(() => getInvestmentColumns(), []);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
        <p>Failed to load investment data: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InvestmentFilters filters={filters} onFiltersChange={handleFiltersChange} />

      <DataTable
        columns={columns}
        data={data?.data || []}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        enableColumnVisibility
        columnDisplayNames={COLUMN_DISPLAY_NAMES}
        columnVisibilityStorageKey="investment-table-columns"
        initialColumnVisibility={{
          subtheme: false,
          exclusivity_tier: false,
          is_licensed: false,
          retirement_confidence: false,
        }}
        pagination={{
          page: data?.page || 1,
          pageSize: data?.pageSize || pageSize,
          total: data?.total || 0,
          totalPages: data?.totalPages || 1,
          onPageChange: setPage,
          onPageSizeChange: handlePageSizeChange,
        }}
      />
    </div>
  );
}
