'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { useMinifigSyncItems } from '@/hooks/use-minifig-sync';
import type { MinifigSyncFilters } from '@/lib/api/minifig-sync';
import { getMinifigItemsColumns, MINIFIG_COLUMN_DISPLAY_NAMES } from './MinifigItemsColumns';
import { MinifigItemsFilters } from './MinifigItemsFilters';

const columns = getMinifigItemsColumns();

export function MinifigItemsTable() {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<MinifigSyncFilters>(() => {
    const initial: MinifigSyncFilters = {};
    const meetsThreshold = searchParams.get('meetsThreshold');
    if (meetsThreshold === 'true') initial.meetsThreshold = true;
    if (meetsThreshold === 'false') initial.meetsThreshold = false;
    const status = searchParams.get('listingStatus');
    if (status) initial.listingStatus = status as MinifigSyncFilters['listingStatus'];
    const search = searchParams.get('search');
    if (search) initial.search = search;
    return initial;
  });

  const { data, isLoading } = useMinifigSyncItems(filters);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All Minifig Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MinifigItemsFilters filters={filters} onFiltersChange={setFilters} />
        <DataTable
          columns={columns}
          data={data ?? []}
          isLoading={isLoading}
          getRowId={(row) => row.id}
          enableColumnVisibility
          columnDisplayNames={MINIFIG_COLUMN_DISPLAY_NAMES}
          initialColumnVisibility={{
            ebay_sell_through_rate: false,
          }}
          columnVisibilityStorageKey="minifig-items-columns"
        />
      </CardContent>
    </Card>
  );
}
