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
import { SetLookupForm, SetDetailsCard } from '@/components/features/brickset';
import type { BricksetSet } from '@/lib/brickset';

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

function RecentLookupCard({ set, onClick }: { set: BricksetSet; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted transition-colors text-left w-full"
    >
      <div className="relative flex-shrink-0 w-12 h-12 bg-gray-100 rounded overflow-hidden">
        {set.imageUrl ? (
          <Image
            src={set.imageUrl}
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

        {/* Results */}
        {lookupMutation.isSuccess && lookupMutation.data && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Source: {lookupMutation.data.source === 'api' ? 'Brickset API' : 'Local Cache'}</span>
            </div>
            <SetDetailsCard set={lookupMutation.data.data} />
          </div>
        )}

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
