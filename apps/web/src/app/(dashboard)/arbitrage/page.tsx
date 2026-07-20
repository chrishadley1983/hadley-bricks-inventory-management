'use client';

/**
 * International Set Arbitrage — consignment-first purchase-decision view
 * (intl-set-arb F7; replaces the retired BrickLink/eBay/Seeded tabbed page).
 *
 * The unit of decision is a per-seller consignment basket, not a lone set:
 * shipping, duty, VAT and handling are basket-level realities, so the UI leads
 * with seller manifests and opens into per-set detail. Channel tabs are wired
 * for expansion — Amazon live now, eBay slot reserved.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Anchor, ChevronDown, ChevronRight, ExternalLink,
  PackageCheck, PackageX, RefreshCw, Scale, Ship, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------

interface BasketItem {
  candidateId: string;
  itemNo: string;
  name: string | null;
  buyGbp: number;
  landedShareGbp: number;
  sellGbp: number | null;
  sellNetGbp: number | null;
  marginGbp: number | null;
  /** House decision number: NET margin ÷ SALE, conservative basis. */
  marginPctSale: number | null;
  grade: 'green' | 'amber' | null;
  drops90: number | null;
  salesRank: number | null;
  was90Gbp: number | null;
  snapshotDate: string | null;
  asin: string | null;
  ukCheapestGbp: number | null;
  weightG: number | null;
  flags: Record<string, boolean>;
}

interface Basket {
  storeId: number;
  storeName: string | null;
  country: string | null;
  zone: string;
  calibrated: boolean;
  sets: number;
  velocitySum: number;
  breakdown: {
    itemsGbp: number; shippingGbp: number; dutyGbp: number; vatGbp: number;
    handlingGbp: number; landedGbp: number; sellNetGbp: number;
    netMarginGbp: number; netMarginPct: number | null; netMarginPctSale: number | null;
    clearsFloor: boolean; totalWeightG: number;
  };
  items: BasketItem[];
}

interface IntlArbResponse {
  channel: string;
  baskets: Basket[];
  meta: { candidates: number; sellers: number; lastComputed: string | null; zones: { zone: string; calibrated: boolean }[] };
}

const ZONE_TINT: Record<string, string> = {
  UK: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  ASIA: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  EU: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  US_CA: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  ROW: 'bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/30',
};

function flagEmoji(cc: string | null): string {
  if (!cc || cc.length !== 2) return '🌐';
  const base = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(base + cc.toUpperCase().charCodeAt(0) - a, base + cc.toUpperCase().charCodeAt(1) - a);
}

function gbp(v: number | null | undefined, dp = 2): string {
  if (v == null) return '—';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** Stacked landed-cost waterfall: item / shipping / duty / VAT / handling. */
function CostWaterfall({ b }: { b: Basket['breakdown'] }) {
  const total = b.landedGbp || 1;
  const segs = [
    { v: b.itemsGbp, cls: 'bg-foreground/70', label: 'items' },
    { v: b.shippingGbp, cls: 'bg-sky-500/80', label: 'shipping' },
    { v: b.dutyGbp, cls: 'bg-amber-500/80', label: 'duty' },
    { v: b.vatGbp, cls: 'bg-rose-500/80', label: 'VAT' },
    { v: b.handlingGbp, cls: 'bg-stone-400/80', label: 'handling' },
  ];
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {segs.map((s) => (
          <div key={s.label} className={s.cls} style={{ width: `${(100 * s.v) / total}%` }} title={`${s.label} ${gbp(s.v)}`} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
        {segs.filter((s) => s.v > 0).map((s) => (
          <span key={s.label} className="whitespace-nowrap">
            <span className={`mr-1 inline-block h-2 w-2 rounded-sm align-middle ${s.cls}`} />
            {s.label} {gbp(s.v, 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

function VelocityBadge({ drops }: { drops: number | null }) {
  if (drops == null) return <Badge variant="outline" className="text-muted-foreground">no data</Badge>;
  if (drops === 0) return <Badge variant="outline" className="border-rose-500/40 text-rose-600 dark:text-rose-400">0 sales/90d</Badge>;
  if (drops >= 20) return <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"><Zap className="mr-1 h-3 w-3" />{drops}/90d</Badge>;
  return <Badge variant="outline">{drops}/90d</Badge>;
}

/** House margin grade: green >25% / amber >15% of sale (max-buy.ts bands). */
function GradeBadge({ grade, pct }: { grade: 'green' | 'amber' | null; pct: number | null }) {
  if (grade == null || pct == null) return null;
  const cls = grade === 'green'
    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
    : 'border-amber-500/50 text-amber-600 dark:text-amber-400';
  return <Badge variant="outline" className={cls}>{(100 * pct).toFixed(0)}%</Badge>;
}

/** Days since the Amazon quote's snapshot; badge when older than a week. */
function QuoteAgeBadge({ snapshotDate }: { snapshotDate: string | null }) {
  if (!snapshotDate) return null;
  const days = Math.floor((Date.now() - new Date(snapshotDate).getTime()) / 864e5);
  if (days <= 7) return null;
  return (
    <Badge variant="outline" className="ml-1 border-rose-500/40 text-rose-500" title={`Amazon price snapshotted ${snapshotDate}`}>
      {days}d old
    </Badge>
  );
}

function BasketCard({ basket, onStatus }: { basket: Basket; onStatus: (id: string, status: 'excluded' | 'bought') => void }) {
  const [open, setOpen] = useState(false);
  const b = basket.breakdown;
  const liveSets = basket.items.filter((i) => (i.drops90 ?? 0) > 0).length;
  return (
    <Card className="overflow-hidden border-l-4" style={{ borderLeftColor: b.netMarginGbp >= 200 ? 'rgb(16 185 129)' : b.netMarginGbp >= 75 ? 'rgb(245 158 11)' : 'rgb(120 113 108)' }}>
      <CardContent className="p-0">
        <button className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/40" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="text-xl leading-none">{flagEmoji(basket.country)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold">{basket.storeName ?? `store ${basket.storeId}`}</span>
              <Badge variant="outline" className={ZONE_TINT[basket.zone] ?? ''}>{basket.zone}</Badge>
              {!basket.calibrated && (
                <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                  <Scale className="mr-1 h-3 w-3" />uncalibrated
                </Badge>
              )}
              {!b.clearsFloor && <Badge variant="outline" className="border-rose-500/40 text-rose-500">under £135 floor</Badge>}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {basket.sets} set{basket.sets === 1 ? '' : 's'} · {liveSets} with velocity · {(b.totalWeightG / 1000).toFixed(1)}kg ·
              {' '}landed {gbp(b.landedGbp, 0)} → sells {gbp(b.sellNetGbp, 0)} net
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-lg font-bold tabular-nums leading-tight">
              {gbp(b.netMarginGbp, 0)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {b.netMarginPctSale != null ? `${(100 * b.netMarginPctSale).toFixed(0)}% of sale`
                : b.netMarginPct != null ? `${(100 * b.netMarginPct).toFixed(0)}% on landed` : '—'}
            </div>
          </div>
        </button>

        {open && (
          <div className="border-t bg-muted/20 px-4 py-3">
            <CostWaterfall b={b} />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">Set</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Buy</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Landed share</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Amazon</th>
                    <th className="py-1.5 pr-2 text-right font-medium">90d avg</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Margin</th>
                    <th className="py-1.5 pr-2 text-right font-medium">UK alt</th>
                    <th className="py-1.5 pr-2 text-right font-medium">BSR</th>
                    <th className="py-1.5 pr-2 font-medium">Velocity</th>
                    <th className="py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {basket.items.map((i) => (
                    <tr key={i.candidateId} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2">
                        <a
                          href={`https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(i.itemNo.includes('-') ? i.itemNo : `${i.itemNo}-1`)}`}
                          target="_blank" rel="noreferrer"
                          className="font-medium hover:underline"
                        >
                          {i.itemNo}
                        </a>
                        <span className="ml-2 hidden text-xs text-muted-foreground md:inline">{(i.name ?? '').slice(0, 44)}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right">{gbp(i.buyGbp)}</td>
                      <td className="py-1.5 pr-2 text-right">{gbp(i.landedShareGbp)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {i.asin ? (
                          <a href={`https://www.amazon.co.uk/dp/${i.asin}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                            {gbp(i.sellGbp)}<ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        ) : gbp(i.sellGbp)}
                        <QuoteAgeBadge snapshotDate={i.snapshotDate} />
                      </td>
                      <td className="py-1.5 pr-2 text-right text-muted-foreground">{gbp(i.was90Gbp)}</td>
                      <td className={`py-1.5 pr-2 text-right font-semibold ${i.grade === 'green' ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                        <span className="mr-1">{gbp(i.marginGbp)}</span>
                        <GradeBadge grade={i.grade} pct={i.marginPctSale} />
                      </td>
                      <td className="py-1.5 pr-2 text-right text-muted-foreground">{gbp(i.ukCheapestGbp)}</td>
                      <td className="py-1.5 pr-2 text-right text-muted-foreground">
                        {i.salesRank == null ? '—' : i.salesRank >= 1000 ? `${Math.round(i.salesRank / 1000)}k` : String(i.salesRank)}
                      </td>
                      <td className="py-1.5 pr-2"><VelocityBadge drops={i.drops90} /></td>
                      <td className="py-1.5">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Mark bought" onClick={() => onStatus(i.candidateId, 'bought')}>
                            <PackageCheck className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" title="Exclude" onClick={() => onStatus(i.candidateId, 'excluded')}>
                            <PackageX className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Store:{' '}
              <a className="hover:underline" href={`https://store.bricklink.com/${basket.storeId}`} target="_blank" rel="noreferrer">
                open on BrickLink <ExternalLink className="inline h-3 w-3" />
              </a>
              {' '}· margins are basket-allocated — removing sets changes every share.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

type SortMode = 'velocityWeighted' | 'margin' | 'marginPct';

export default function IntlSetArbPage() {
  const qc = useQueryClient();
  const [channel, setChannel] = useState('amazon');
  const [zone, setZone] = useState('all');
  const [minNet, setMinNet] = useState('50');
  const [velocityOnly, setVelocityOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('velocityWeighted');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<IntlArbResponse>({
    queryKey: ['intl-set-arb', channel],
    queryFn: async () => {
      const res = await fetch(`/api/arbitrage/intl?channel=${channel}`);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch('/api/arbitrage/intl', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: id, status }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intl-set-arb'] }),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const minN = parseFloat(minNet) || 0;
    const q = search.trim().toLowerCase();
    const rows = data.baskets.filter((b) => {
      if (zone !== 'all' && b.zone !== zone) return false;
      if (b.breakdown.netMarginGbp < minN) return false;
      if (velocityOnly && b.velocitySum === 0) return false;
      if (q && !(
        (b.storeName ?? '').toLowerCase().includes(q) ||
        b.items.some((i) => i.itemNo.toLowerCase().includes(q) || (i.name ?? '').toLowerCase().includes(q))
      )) return false;
      return true;
    });
    const score = (b: Basket) => {
      switch (sortMode) {
        case 'margin': return b.breakdown.netMarginGbp;
        case 'marginPct': return b.breakdown.netMarginPctSale ?? b.breakdown.netMarginPct ?? 0;
        case 'velocityWeighted':
        default:
          // margin haircut when velocity is thin — the drops90-0 mirage guard
          return b.breakdown.netMarginGbp * Math.min(1, b.velocitySum / 20 + 0.1);
      }
    };
    return rows.sort((a, b) => score(b) - score(a));
  }, [data, zone, minNet, velocityOnly, search, sortMode]);

  const uncalibrated = data?.meta.zones.some((z) => z.zone !== 'UK' && !z.calibrated) ?? true;
  const totalNet = filtered.reduce((a, b) => a + b.breakdown.netMarginGbp, 0);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Ship className="h-6 w-6" /> International Set Arbitrage
          </h1>
          <p className="text-sm text-muted-foreground">
            BrickLink sourcing → Amazon UK — domestic and import, landed-cost honest. {data?.meta.candidates ?? '…'} candidates across {data?.meta.sellers ?? '…'} sellers
            {data?.meta.lastComputed ? ` · computed ${new Date(data.meta.lastComputed).toLocaleString('en-GB')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={channel} onValueChange={setChannel}>
            <TabsList>
              <TabsTrigger value="amazon">Amazon</TabsTrigger>
              <TabsTrigger value="ebay" disabled title="Channel slot reserved — valuation returns with the eBay rebuild">
                eBay <span className="ml-1 text-[10px] text-muted-foreground">soon</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {uncalibrated && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle>Shipping bands are uncalibrated</AlertTitle>
          <AlertDescription>
            Landed costs use placeholder zone bands. Place one modest calibration consignment, then record actuals with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">scripts/intl-arb/record-zone-actuals.ts</code> — every margin here firms up overnight.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search store or set…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" />
        <Select value={zone} onValueChange={setZone}>
          <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All zones</SelectItem>
            <SelectItem value="UK">UK (domestic)</SelectItem>
            <SelectItem value="ASIA">Asia</SelectItem>
            <SelectItem value="EU">EU</SelectItem>
            <SelectItem value="US_CA">US / CA</SelectItem>
            <SelectItem value="ROW">Rest of world</SelectItem>
          </SelectContent>
        </Select>
        <Select value={minNet} onValueChange={setMinNet}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any basket net</SelectItem>
            <SelectItem value="50">Net ≥ £50</SelectItem>
            <SelectItem value="100">Net ≥ £100</SelectItem>
            <SelectItem value="250">Net ≥ £250</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={(v: string) => setSortMode(v as SortMode)}>
          <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="velocityWeighted">Velocity-weighted margin</SelectItem>
            <SelectItem value="margin">Raw margin £</SelectItem>
            <SelectItem value="marginPct">Margin %</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={velocityOnly ? 'default' : 'outline'} size="sm" className="h-9"
          onClick={() => setVelocityOnly(!velocityOnly)}
          title="Hide baskets where no set has a single Amazon sale in 90 days"
        >
          <Zap className="mr-1 h-4 w-4" /> Velocity only
        </Button>
        <div className="ml-auto text-sm text-muted-foreground tabular-nums">
          {filtered.length} basket{filtered.length === 1 ? '' : 's'} · {gbp(totalNet, 0)} addressable net
        </div>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load candidates</AlertTitle>
          <AlertDescription>{String(error)}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Anchor className="h-8 w-8" />
            <p>No baskets match the filters. Candidates refresh nightly after the price-guide run.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((b) => (
            <BasketCard key={b.storeId} basket={b} onStatus={(id, status) => statusMutation.mutate({ id, status })} />
          ))}
        </div>
      )}
    </div>
  );
}
