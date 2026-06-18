'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

interface OfficialPovCardProps {
  setNumber: string | null;
  enabled: boolean;
}

interface PovRow {
  set_name: string | null;
  native_currency: string | null;
  sold_6mo_native: number | string | null;
  sold_6mo_avg_gbp: number | string | null;
  sold_6mo_items: number | null;
  sold_6mo_lots: number | null;
  for_sale_native: number | string | null;
  for_sale_avg_gbp: number | string | null;
  uk_retail_gbp: number | string | null;
  partout_multiple: number | string | null;
  is_aggregate_listing: boolean | null;
  fetched_at: string;
}

interface PovGetResponse {
  found: boolean;
  isFresh?: boolean;
  ageMs?: number;
  row?: PovRow;
}

interface PovPostResponse {
  scraped: boolean;
  cdpReachable?: boolean;
  note?: string;
  row?: PovRow | null;
}

const n = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return isFinite(x) ? x : null;
};
const money = (v: number | string | null | undefined, ccy: string | null): string => {
  const x = n(v);
  if (x == null) return '—';
  const sym = ccy === 'USD' ? '$' : '£';
  return `${sym}${x.toFixed(2)}`;
};
const gbp = (v: number | string | null | undefined): string => {
  const x = n(v);
  return x == null ? '—' : `£${x.toFixed(2)}`;
};
const fmtAge = (ms: number): string => {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

async function fetchPov(setNumber: string, condition: 'N' | 'U'): Promise<PovGetResponse> {
  const params = new URLSearchParams({ set: setNumber, condition });
  const res = await fetch(`/api/bricklink/part-out-value?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load POV (${res.status})`);
  return (await res.json()).data as PovGetResponse;
}

async function refreshPov(setNumber: string, condition: 'N' | 'U'): Promise<PovPostResponse> {
  const res = await fetch('/api/bricklink/part-out-value', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set: setNumber, condition, force: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Fetch failed (${res.status})`);
  return json.data as PovPostResponse;
}

/**
 * Official BrickLink Part Out Value — BL's own authoritative 6-month sold and current-listing
 * averages (one scrape), with UK RRP and the part-out multiple. Complements the computed,
 * lot-by-lot partout below. Reads cache; the Fetch button does a live scrape (local dev only).
 */
export function OfficialPovCard({ setNumber, enabled }: OfficialPovCardProps) {
  const [condition, setCondition] = useState<'N' | 'U'>('N');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const queryKey = ['official-pov', setNumber, condition];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchPov(setNumber!, condition),
    enabled: enabled && !!setNumber,
    staleTime: 60_000,
  });

  const refresh = useMutation({
    mutationFn: () => refreshPov(setNumber!, condition),
    onSuccess: (d) => {
      if (d.scraped === false && d.cdpReachable === false) {
        toast({
          title: 'Live fetch unavailable here',
          description: d.note ?? 'Live POV fetch only works on the local dev server (needs local Chrome).',
        });
      } else if (d.scraped) {
        toast({ title: 'Part Out Value refreshed', description: 'Scraped fresh from BrickLink.' });
      }
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => {
      toast({
        title: 'Refresh failed',
        description: e instanceof Error ? e.message : 'Could not fetch Part Out Value.',
        variant: 'destructive',
      });
    },
  });

  if (!enabled || !setNumber) return null;

  const row = data?.found ? data.row : undefined;
  const ccy = row?.native_currency ?? 'GBP';
  const mult = n(row?.partout_multiple);
  // CMF "Complete Series of N" / "Box of N" listings divide a multi-item sold value by a single-pack
  // RRP, so the multiple is inflated ~Nx and not comparable to single-set multiples. Don't badge it
  // green as a "deal", and say why.
  const isAggregate = row?.is_aggregate_listing === true;

  return (
    <Card data-testid="official-pov-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            Official BrickLink Part Out Value
            {data?.found && (
              <Badge variant={data.isFresh ? 'default' : 'secondary'} className="font-normal">
                {data.ageMs != null ? `fetched ${fmtAge(data.ageMs)} ago` : 'cached'}
                {data.isFresh === false ? ' · stale' : ''}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={condition} onValueChange={(v: string) => setCondition(v as 'N' | 'U')}>
              <TabsList className="h-8">
                <TabsTrigger value="N" className="text-xs px-2 py-1">
                  New
                </TabsTrigger>
                <TabsTrigger value="U" className="text-xs px-2 py-1">
                  Used
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${refresh.isPending ? 'animate-spin' : ''}`} />
              {data?.found ? 'Refresh' : 'Fetch'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
        ) : !data?.found ? (
          <div className="text-sm text-muted-foreground py-2">
            Not yet scraped for this set/condition. Click <span className="font-medium">Fetch</span> to pull
            BrickLink&apos;s Part Out Value (live fetch runs on the local dev server).
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Sold avg (6mo)</div>
              <div className="text-xl font-semibold">{money(row?.sold_6mo_native, ccy)}</div>
              <div className="text-xs text-muted-foreground">
                {row?.sold_6mo_items ?? '?'} items · {row?.sold_6mo_lots ?? '?'} lots
                {ccy !== 'GBP' && n(row?.sold_6mo_avg_gbp) != null ? ` · ≈ ${gbp(row?.sold_6mo_avg_gbp)}` : ''}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">For-sale avg</div>
              <div className="text-xl font-semibold">{money(row?.for_sale_native, ccy)}</div>
              <div className="text-xs text-muted-foreground">current listings</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">UK RRP</div>
              <div className="text-xl font-semibold">{gbp(row?.uk_retail_gbp)}</div>
              <div className="text-xs text-muted-foreground">Brickset</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> Part Out
              </div>
              <div
                className={`text-xl font-bold ${
                  isAggregate
                    ? 'text-muted-foreground'
                    : mult != null && mult >= 2
                      ? 'text-green-600'
                      : mult != null && mult >= 1.5
                        ? 'text-amber-600'
                        : ''
                }`}
              >
                {mult != null ? `${mult.toFixed(2)}×` : '—'}
              </div>
              <div className="text-xs text-muted-foreground">
                {isAggregate ? 'series aggregate — vs single-pack RRP, not comparable' : 'sold ÷ RRP'}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
