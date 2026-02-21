'use client';

import * as React from 'react';
import { ArrowLeft, FormInput, Sparkles, Camera, FileSpreadsheet, Grid3X3 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InventoryForm } from './InventoryForm';

// Lazy load the other tabs to reduce initial bundle size
// These will be implemented in subsequent phases
const NaturalLanguageInput = React.lazy(() =>
  import('./NaturalLanguageInput').then((mod) => ({ default: mod.NaturalLanguageInput }))
);
const PhotoInput = React.lazy(() =>
  import('./PhotoInput').then((mod) => ({ default: mod.PhotoInput }))
);
const CsvImportWizard = React.lazy(() =>
  import('./CsvImportWizard').then((mod) => ({ default: mod.CsvImportWizard }))
);
const BulkEntryGrid = React.lazy(() =>
  import('./BulkEntryGrid').then((mod) => ({ default: mod.BulkEntryGrid }))
);

type TabValue = 'single' | 'natural-language' | 'photo' | 'csv' | 'bulk';

interface TabConfig {
  value: TabValue;
  label: string;
  icon: React.ReactNode;
  available: boolean;
}

const TAB_CONFIG: TabConfig[] = [
  { value: 'single', label: 'Single', icon: <FormInput className="h-4 w-4" />, available: true },
  {
    value: 'natural-language',
    label: 'Natural Language',
    icon: <Sparkles className="h-4 w-4" />,
    available: true,
  },
  { value: 'photo', label: 'Photo', icon: <Camera className="h-4 w-4" />, available: true },
  {
    value: 'csv',
    label: 'CSV Import',
    icon: <FileSpreadsheet className="h-4 w-4" />,
    available: true,
  },
  { value: 'bulk', label: 'Bulk', icon: <Grid3X3 className="h-4 w-4" />, available: true },
];

/**
 * Fallback component for lazy loaded tabs
 */
function TabLoadingFallback() {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}

/**
 * Placeholder component for tabs not yet implemented
 */
function ComingSoonPlaceholder({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <div className="text-muted-foreground mb-2">Coming Soon</div>
      <div className="text-sm text-muted-foreground">
        The {feature} feature is not yet available.
      </div>
    </div>
  );
}

interface InventoryAddTabsProps {
  /** Pre-select a purchase when adding from a purchase detail page */
  initialPurchaseId?: string | null;
}

/**
 * Tabbed interface for adding inventory items through multiple input methods
 */
export function InventoryAddTabs({ initialPurchaseId }: InventoryAddTabsProps) {
  const [activeTab, setActiveTab] = React.useState<TabValue>('single');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inventory">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Add Inventory</h1>
          <p className="text-muted-foreground">
            Add items to your inventory using your preferred method
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as TabValue)}>
        <TabsList className="grid w-full grid-cols-5">
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              disabled={!tab.available}
              className="flex items-center gap-2"
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="single" className="mt-6" forceMount>
          <div className={activeTab !== 'single' ? 'hidden' : ''}>
            <InventoryForm mode="create" showHeader={false} initialPurchaseId={initialPurchaseId} />
          </div>
        </TabsContent>

        <TabsContent value="natural-language" className="mt-6">
          <React.Suspense fallback={<TabLoadingFallback />}>
            {TAB_CONFIG.find((t) => t.value === 'natural-language')?.available ? (
              <NaturalLanguageInput />
            ) : (
              <ComingSoonPlaceholder feature="Natural Language" />
            )}
          </React.Suspense>
        </TabsContent>

        <TabsContent value="photo" className="mt-6">
          <React.Suspense fallback={<TabLoadingFallback />}>
            {TAB_CONFIG.find((t) => t.value === 'photo')?.available ? (
              <PhotoInput />
            ) : (
              <ComingSoonPlaceholder feature="Photo" />
            )}
          </React.Suspense>
        </TabsContent>

        <TabsContent value="csv" className="mt-6">
          <React.Suspense fallback={<TabLoadingFallback />}>
            {TAB_CONFIG.find((t) => t.value === 'csv')?.available ? (
              <CsvImportWizard />
            ) : (
              <ComingSoonPlaceholder feature="CSV Import" />
            )}
          </React.Suspense>
        </TabsContent>

        <TabsContent value="bulk" className="mt-6">
          <React.Suspense fallback={<TabLoadingFallback />}>
            {TAB_CONFIG.find((t) => t.value === 'bulk')?.available ? (
              <BulkEntryGrid />
            ) : (
              <ComingSoonPlaceholder feature="Bulk Entry" />
            )}
          </React.Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
