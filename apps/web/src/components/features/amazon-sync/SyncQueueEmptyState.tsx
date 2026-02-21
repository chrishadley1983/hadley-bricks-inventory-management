'use client';

import { CloudUpload, Package } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function SyncQueueEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <CloudUpload className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No items in queue</h3>
      <p className="text-muted-foreground max-w-sm mb-6">
        Add inventory items to the sync queue from the inventory page, then return here to validate
        and submit to Amazon.
      </p>
      <Button asChild>
        <Link href="/inventory">
          <Package className="mr-2 h-4 w-4" />
          Go to Inventory
        </Link>
      </Button>
    </div>
  );
}
