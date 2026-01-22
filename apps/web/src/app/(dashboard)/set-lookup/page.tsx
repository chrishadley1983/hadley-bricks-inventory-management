'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Settings, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SetLookupForm, SetDetailsCard, SetLookupEbayModal, SetStockCard, SetStockModal, AmazonOffersModal } from '@/components/features/brickset';
import { PartoutTab } from '@/components/features/set-lookup';
import type { SetPricingData } from '@/components/features/brickset';
import type { BricksetSet } from '@/lib/brickset';
import type { InventoryStockSummary } from '@/app/api/brickset/inventory-stock/route';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface LookupResult {
  data: BricksetSet;
  source: 'api' | 'cache';
}

async function lookupSet(
  setNumber: string,
  forceRefresh: boolean
): Promise<LookupResult> {
  const params = new URLSearchParams({
    setNumber,
    forceRefresh: String(forceRefresh),
  });

  const response = await fetch(`/api/brickset/lookup?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || 'Failed to look up set');
  }

  return response.json();
}

async function fetchRecentLookups(): Promise<BricksetSet[]> {
  const response = await fetch('/api/brickset/search?query=&limit=5');

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.data || [];
}

async function fetchBricksetStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/integrations/brickset/credentials');
  if (!response.ok) return { configured: false };
  return response.json();
}

async function fetchSetPricing(
  setNumber: string,
  ean?: string | null,
  upc?: string | null
): Promise<SetPricingData> {
  const params = new URLSearchParams({ setNumber });
  if (ean) params.set('ean', ean);
  if (upc) params.set('upc', upc);

  const response = await fetch(`/api/brickset/pricing?${params}`);

  if (!response.ok) {
    throw new Error('Failed to fetch pricing data');
  }

  const result = await response.json();
  return result.data;
}

async function fetchInventoryStock(
  setNumber: string,
  asin?: string | null
): Promise<InventoryStockSummary> {
  const params = new URLSearchParams({ setNumber });
  if (asin) params.set('asin', asin);

  const response = await fetch(`/api/brickset/inventory-stock?${params}`);

  if (!response.ok) {
    throw new Error('Failed to fetch inventory stock');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Check if a string is a valid image URL
 */
function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/');
}

function RecentLookupCard({ set, onClick }: { set: BricksetSet; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted transition-colors text-left w-full"
    >
      <div className="relative flex-shrink-0 w-12 h-12 bg-gray-100 rounded overflow-hidden">
        {isValidImageUrl(set.imageUrl) ? (
          <Image
            src={set.imageUrl!}
            alt={set.setName}
            fill
            sizes="48px"
            className="object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
            N/A
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{set.setNumber}</div>
        <div className="text-sm text-muted-foreground truncate">{set.setName}</div>
      </div>
      <div className="text-xs text-muted-foreground">
        {set.theme}
      </div>
    </button>
  );
}

export default function SetLookupPage() {
  const queryClient = useQueryClient();
  const [currentSetNumber, setCurrentSetNumber] = useState<string | null>(null);
  const [ebayModalOpen, setEbayModalOpen] = useState(false);
  const [ebayUsedModalOpen, setEbayUsedModalOpen] = useState(false);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockModalTab, setStockModalTab] = useState<'current' | 'sold'>('current');
  const [amazonOffersModalOpen, setAmazonOffersModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('details');

  // Check if Brickset is configured
  const { data: bricksetStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['brickset', 'status'],
    queryFn: fetchBricksetStatus,
  });

  // Fetch recent lookups
  const { data: recentLookups } = useQuery({
    queryKey: ['brickset', 'recent'],
    queryFn: fetchRecentLookups,
    enabled: bricksetStatus?.configured,
  });

  // Lookup mutation
  const lookupMutation = useMutation({
    mutationFn: ({ setNumber, forceRefresh }: { setNumber: string; forceRefresh: boolean }) =>
      lookupSet(setNumber, forceRefresh),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brickset', 'recent'] });
    },
  });

  // Fetch pricing data when a set is successfully looked up
  const currentSet = lookupMutation.data?.data;
  const { data: pricingData, isLoading: pricingLoading } = useQuery({
    queryKey: ['brickset', 'pricing', currentSet?.setNumber],
    queryFn: () => fetchSetPricing(
      currentSet!.setNumber,
      currentSet!.ean,
      currentSet!.upc
    ),
    enabled: !!currentSet,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch inventory stock data when a set is successfully looked up
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['brickset', 'stock', currentSet?.setNumber],
    queryFn: () => fetchInventoryStock(
      currentSet!.setNumber,
      pricingData?.amazon?.asin // Use ASIN from pricing if available
    ),
    enabled: !!currentSet,
    staleTime: 1 * 60 * 1000, // 1 minute (stock changes more frequently)
  });

  const handleOpenStockModal = (tab: 'current' | 'sold') => {
    setStockModalTab(tab);
    setStockModalOpen(true);
  };

  const handleLookup = (setNumber: string, forceRefresh: boolean) => {
    setCurrentSetNumber(setNumber);
    lookupMutation.mutate({ setNumber, forceRefresh });
  };

  const handleRecentClick = (set: BricksetSet) => {
    setCurrentSetNumber(set.setNumber);
    lookupMutation.mutate({ setNumber: set.setNumber, forceRefresh: false });
  };

  if (statusLoading) {
    return (
      <>
        <Header title="Set Lookup" description="Look up LEGO set information from Brickset" />
        <div className="container mx-auto py-6 px-4">
          <Skeleton className="h-[200px] w-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Set Lookup" description="Look up LEGO set information from Brickset" />

      <div className="container mx-auto py-6 px-4 space-y-6">
        {/* Configuration Warning */}
        {!bricksetStatus?.configured && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Brickset Not Configured</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                Configure your Brickset API key to look up sets that aren&apos;t in the local cache.
                You can still search cached sets without an API key.
              </span>
              <Link href="/settings/integrations">
                <Button variant="outline" size="sm">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure
                </Button>
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {/* Search Form */}
        <Card>
          <CardHeader>
            <CardTitle>Look Up Set</CardTitle>
          </CardHeader>
          <CardContent>
            <SetLookupForm
              onLookup={handleLookup}
              isLoading={lookupMutation.isPending}
            />
          </CardContent>
        </Card>

        {/* Error Display */}
        {lookupMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Lookup Failed</AlertTitle>
            <AlertDescription>
              {lookupMutation.error instanceof Error
                ? lookupMutation.error.message
                : 'An error occurred while looking up the set'}
            </AlertDescription>
          </Alert>
        )}

        {/* Results with Tabs */}
        {lookupMutation.isSuccess && lookupMutation.data && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Source: {lookupMutation.data.source === 'api' ? 'Brickset API' : 'Local Cache'}</span>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="partout" data-testid="partout-tab">
                  Partout
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-4 space-y-4">
                <SetDetailsCard
                  set={lookupMutation.data.data}
                  pricing={pricingData}
                  pricingLoading={pricingLoading}
                  onEbayClick={() => setEbayModalOpen(true)}
                  onEbayUsedClick={() => setEbayUsedModalOpen(true)}
                  onAmazonOffersClick={() => setAmazonOffersModalOpen(true)}
                />
                {/* Inventory Stock Card */}
                <SetStockCard
                  stock={stockData ?? null}
                  loading={stockLoading}
                  onCurrentStockClick={() => handleOpenStockModal('current')}
                  onSoldStockClick={() => handleOpenStockModal('sold')}
                />
              </TabsContent>

              <TabsContent value="partout" className="mt-4">
                <PartoutTab
                  setNumber={currentSet?.setNumber ?? null}
                  enabled={activeTab === 'partout'}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* eBay Listings Modal (New) */}
        <SetLookupEbayModal
          setNumber={currentSet?.setNumber ?? null}
          setName={currentSet?.setName ?? null}
          condition="new"
          isOpen={ebayModalOpen}
          onClose={() => setEbayModalOpen(false)}
        />

        {/* eBay Listings Modal (Used) */}
        <SetLookupEbayModal
          setNumber={currentSet?.setNumber ?? null}
          setName={currentSet?.setName ?? null}
          condition="used"
          isOpen={ebayUsedModalOpen}
          onClose={() => setEbayUsedModalOpen(false)}
        />

        {/* Inventory Stock Modal */}
        <SetStockModal
          setNumber={currentSet?.setNumber ?? null}
          setName={currentSet?.setName ?? null}
          stock={stockData ?? null}
          isOpen={stockModalOpen}
          onClose={() => setStockModalOpen(false)}
          initialTab={stockModalTab}
        />

        {/* Amazon Offers Modal */}
        <AmazonOffersModal
          setNumber={currentSet?.setNumber ?? null}
          setName={currentSet?.setName ?? null}
          asin={pricingData?.amazon?.asin ?? null}
          offers={pricingData?.amazon?.offers ?? []}
          isOpen={amazonOffersModalOpen}
          onClose={() => setAmazonOffersModalOpen(false)}
        />

        {/* Loading State */}
        {lookupMutation.isPending && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-muted-foreground">Looking up set {currentSetNumber}...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Lookups */}
        {!lookupMutation.data && !lookupMutation.isPending && recentLookups && recentLookups.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent Lookups
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentLookups.map((set) => (
                  <RecentLookupCard
                    key={set.id}
                    set={set}
                    onClick={() => handleRecentClick(set)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
