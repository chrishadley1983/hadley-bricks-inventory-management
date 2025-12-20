'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Dynamically import Header to prevent SSR issues with Supabase
const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// Dynamically import InventoryTable to prevent SSR issues
const InventoryTable = dynamic(
  () => import('@/components/features/inventory').then((mod) => ({ default: mod.InventoryTable })),
  { ssr: false }
);

// Dynamically import SyncControls
const SyncControls = dynamic(
  () => import('@/components/features/sync').then((mod) => ({ default: mod.SyncControls })),
  { ssr: false }
);

export default function InventoryPage() {
  return (
    <>
      <Header title="Inventory" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Inventory Items</h2>
              <p className="text-muted-foreground">Manage your LEGO inventory</p>
            </div>
            <SyncControls compact table="inventory" />
          </div>
          <Button asChild>
            <Link href="/inventory/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Link>
          </Button>
        </div>

        <InventoryTable />
      </div>
    </>
  );
}
