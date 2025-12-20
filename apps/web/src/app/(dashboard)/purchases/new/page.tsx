'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const PurchaseForm = dynamic(
  () =>
    import('@/components/features/purchases/PurchaseForm').then((mod) => ({
      default: mod.PurchaseForm,
    })),
  { ssr: false }
);

export default function NewPurchasePage() {
  return (
    <>
      <Header title="New Purchase" />
      <div className="p-6">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/purchases">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Purchases
            </Link>
          </Button>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">New Purchase</h2>
          <p className="text-muted-foreground">Record a new purchase</p>
        </div>

        <div className="max-w-2xl">
          <PurchaseForm mode="create" />
        </div>
      </div>
    </>
  );
}
