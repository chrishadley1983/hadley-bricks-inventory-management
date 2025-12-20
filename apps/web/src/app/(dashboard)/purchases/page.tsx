'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const PurchaseTable = dynamic(
  () => import('@/components/features/purchases').then((mod) => ({ default: mod.PurchaseTable })),
  { ssr: false }
);

const QuickAddPurchase = dynamic(
  () =>
    import('@/components/features/purchases').then((mod) => ({
      default: mod.QuickAddPurchase,
    })),
  { ssr: false }
);

const SyncControls = dynamic(
  () => import('@/components/features/sync').then((mod) => ({ default: mod.SyncControls })),
  { ssr: false }
);

export default function PurchasesPage() {
  return (
    <>
      <Header title="Purchases" />
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Purchases</h2>
              <p className="text-muted-foreground">Track your LEGO purchases and expenses</p>
            </div>
            <SyncControls compact table="purchases" />
          </div>
          <Button asChild>
            <Link href="/purchases/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Purchase
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="list" className="space-y-4">
          <TabsList>
            <TabsTrigger value="list">All Purchases</TabsTrigger>
            <TabsTrigger value="quick-add" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Quick Add
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            <PurchaseTable />
          </TabsContent>

          <TabsContent value="quick-add">
            <QuickAddPurchase />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
