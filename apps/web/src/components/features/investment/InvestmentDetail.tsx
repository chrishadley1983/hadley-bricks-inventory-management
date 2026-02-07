'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Package,
  DollarSign,
  Calendar,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { useInvestmentSetDetail, usePriceHistory } from '@/hooks/use-investment';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart } from '@/components/charts/line-chart';
import { formatCurrency, formatDate } from '@/lib/utils';

interface InvestmentDetailProps {
  setNumber: string;
}

const RETIREMENT_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  available: 'default',
  retiring_soon: 'destructive',
  retired: 'secondary',
};

const RETIREMENT_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  retiring_soon: 'Retiring Soon',
  retired: 'Retired',
};

const CONFIDENCE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  confirmed: 'default',
  likely: 'secondary',
  speculative: 'outline',
};

export function InvestmentDetail({ setNumber }: InvestmentDetailProps) {
  const { data: set, isLoading, error } = useInvestmentSetDetail(setNumber);
  const { data: priceHistory, isLoading: priceHistoryLoading } = usePriceHistory(setNumber);

  if (isLoading) {
    return <InvestmentDetailSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6 text-destructive">
        <h3 className="font-semibold">Error loading set</h3>
        <p>{error.message}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/investment">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Investment Tracker
          </Link>
        </Button>
      </div>
    );
  }

  if (!set) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <h3 className="font-semibold">Set not found</h3>
        <p className="text-muted-foreground">This LEGO set does not exist in the investment tracker.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/investment">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Investment Tracker
          </Link>
        </Button>
      </div>
    );
  }

  const discount = set.pricing?.buy_box_price && set.uk_retail_price
    ? ((set.uk_retail_price - set.pricing.buy_box_price) / set.uk_retail_price) * 100
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/investment">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-2xl font-bold">{set.set_name || `Set ${set.set_number}`}</h1>
            {set.retirement_status && (
              <Badge variant={RETIREMENT_STATUS_VARIANTS[set.retirement_status] || 'outline'}>
                {RETIREMENT_STATUS_LABELS[set.retirement_status] || set.retirement_status}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Set #{set.set_number}
            {set.theme && <> &middot; {set.theme}</>}
            {set.subtheme && <> &middot; {set.subtheme}</>}
            {set.year_from && <> &middot; {set.year_from}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {set.image_url && (
            <img
              src={set.image_url}
              alt={set.set_name || set.set_number}
              className="h-16 w-16 rounded-lg object-contain border"
            />
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">RRP (GBP)</div>
            <div className="text-2xl font-bold">
              {set.uk_retail_price != null ? formatCurrency(set.uk_retail_price) : '\u2014'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Buy Box Price</div>
            <div className="text-2xl font-bold">
              {set.pricing?.buy_box_price != null ? formatCurrency(set.pricing.buy_box_price) : '\u2014'}
            </div>
            {discount != null && (
              <div className={`text-sm flex items-center gap-1 ${discount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {discount > 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {Math.abs(discount).toFixed(1)}% {discount > 0 ? 'below' : 'above'} RRP
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Sales Rank</div>
            <div className="text-2xl font-bold">
              {set.pricing?.sales_rank != null ? set.pricing.sales_rank.toLocaleString() : '\u2014'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Offers</div>
            <div className="text-2xl font-bold">
              {set.pricing?.offer_count != null ? set.pricing.offer_count.toLocaleString() : '\u2014'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Set Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Set Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailRow label="Set Number" value={set.set_number} />
            <DetailRow label="Name" value={set.set_name} />
            <DetailRow label="Theme" value={set.theme} />
            <DetailRow label="Subtheme" value={set.subtheme} />
            <DetailRow label="Year" value={set.year_from} />
            <DetailRow label="Pieces" value={set.pieces?.toLocaleString()} />
            <DetailRow label="Minifigs" value={set.minifigs} />
          </CardContent>
        </Card>

        {/* Classification */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Classification
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailRow
              label="Licensed"
              value={set.is_licensed ? 'Yes' : set.is_licensed === false ? 'No' : '\u2014'}
            />
            <DetailRow
              label="UCS"
              value={set.is_ucs ? 'Yes' : set.is_ucs === false ? 'No' : '\u2014'}
            />
            <DetailRow
              label="Modular"
              value={set.is_modular ? 'Yes' : set.is_modular === false ? 'No' : '\u2014'}
            />
            <DetailRow
              label="Exclusivity"
              value={
                set.exclusivity_tier && set.exclusivity_tier !== 'none' ? (
                  <Badge variant="secondary" className="capitalize">{set.exclusivity_tier}</Badge>
                ) : (
                  '\u2014'
                )
              }
            />
            <DetailRow label="Availability" value={set.availability} />
          </CardContent>
        </Card>

        {/* Amazon Pricing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Amazon Pricing
            </CardTitle>
            {set.amazon_asin && (
              <CardDescription>
                ASIN: {set.amazon_asin}
                <a
                  href={`https://www.amazon.co.uk/dp/${set.amazon_asin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center text-primary hover:underline"
                >
                  View on Amazon
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {set.amazon_asin ? (
              <>
                <DetailRow
                  label="Buy Box Price"
                  value={set.pricing?.buy_box_price != null ? formatCurrency(set.pricing.buy_box_price) : '\u2014'}
                />
                <DetailRow
                  label="Was Price (90d)"
                  value={set.pricing?.was_price != null ? formatCurrency(set.pricing.was_price) : '\u2014'}
                />
                <DetailRow
                  label="Lowest Offer"
                  value={set.pricing?.lowest_offer_price != null ? formatCurrency(set.pricing.lowest_offer_price) : '\u2014'}
                />
                <DetailRow
                  label="Sales Rank"
                  value={set.pricing?.sales_rank?.toLocaleString()}
                />
                <DetailRow
                  label="Offer Count"
                  value={set.pricing?.offer_count?.toLocaleString()}
                />
                <DetailRow
                  label="Last Updated"
                  value={formatDate(set.pricing?.latest_snapshot_date)}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No Amazon ASIN linked to this set.</p>
            )}
          </CardContent>
        </Card>

        {/* Retirement Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Retirement Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailRow
              label="Status"
              value={
                set.retirement_status ? (
                  <Badge variant={RETIREMENT_STATUS_VARIANTS[set.retirement_status] || 'outline'}>
                    {RETIREMENT_STATUS_LABELS[set.retirement_status] || set.retirement_status}
                  </Badge>
                ) : (
                  '\u2014'
                )
              }
            />
            <DetailRow label="Expected Date" value={formatDate(set.expected_retirement_date)} />
            <DetailRow
              label="Confidence"
              value={
                set.retirement_confidence ? (
                  <Badge variant={CONFIDENCE_VARIANTS[set.retirement_confidence] || 'outline'} className="capitalize">
                    {set.retirement_confidence}
                  </Badge>
                ) : (
                  '\u2014'
                )
              }
            />
            {set.retirement_sources && set.retirement_sources.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-sm font-medium mb-2">Sources</p>
                <div className="space-y-2">
                  {set.retirement_sources.map((source, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{source.source}</span>
                      <div className="flex items-center gap-2">
                        {source.expected_retirement_date && (
                          <span>{formatDate(source.expected_retirement_date)}</span>
                        )}
                        <Badge variant={CONFIDENCE_VARIANTS[source.confidence] || 'outline'} className="capitalize text-xs">
                          {source.confidence}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Investment Prediction */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Investment Prediction
          </CardTitle>
        </CardHeader>
        <CardContent>
          {set.prediction ? (
            <div className="space-y-6">
              {/* Score + Confidence row */}
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Investment Score</div>
                  <Badge
                    variant={
                      set.prediction.investment_score >= 7
                        ? 'default'
                        : set.prediction.investment_score >= 4
                          ? 'secondary'
                          : 'destructive'
                    }
                    className="text-lg font-mono px-3 py-1"
                  >
                    {set.prediction.investment_score.toFixed(1)} / 10
                  </Badge>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Confidence</div>
                  <span className="text-lg font-medium">
                    {set.prediction.confidence > 0
                      ? `${(set.prediction.confidence * 100).toFixed(0)}%`
                      : 'Rule-based'}
                  </span>
                </div>
                {set.prediction.model_version && (
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Model</div>
                    <span className="text-sm font-mono">{set.prediction.model_version}</span>
                  </div>
                )}
              </div>

              {/* Appreciation predictions */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">1-Year Predicted Appreciation</div>
                  {set.prediction.predicted_1yr_appreciation != null ? (
                    <>
                      <div className={`text-2xl font-bold ${set.prediction.predicted_1yr_appreciation >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {set.prediction.predicted_1yr_appreciation > 0 ? '+' : ''}
                        {set.prediction.predicted_1yr_appreciation.toFixed(1)}%
                      </div>
                      {set.prediction.predicted_1yr_price_gbp != null && (
                        <div className="text-sm text-muted-foreground">
                          Predicted price: {formatCurrency(set.prediction.predicted_1yr_price_gbp)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg text-muted-foreground">{'\u2014'}</div>
                  )}
                </div>
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">3-Year Predicted Appreciation</div>
                  {set.prediction.predicted_3yr_appreciation != null ? (
                    <>
                      <div className={`text-2xl font-bold ${set.prediction.predicted_3yr_appreciation >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {set.prediction.predicted_3yr_appreciation > 0 ? '+' : ''}
                        {set.prediction.predicted_3yr_appreciation.toFixed(1)}%
                      </div>
                      {set.prediction.predicted_3yr_price_gbp != null && (
                        <div className="text-sm text-muted-foreground">
                          Predicted price: {formatCurrency(set.prediction.predicted_3yr_price_gbp)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg text-muted-foreground">{'\u2014'}</div>
                  )}
                </div>
              </div>

              {/* Risk Factors */}
              {set.prediction.risk_factors && set.prediction.risk_factors.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">Risk Factors</div>
                  <div className="flex flex-wrap gap-2">
                    {set.prediction.risk_factors.map((risk, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {risk.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Last scored */}
              <div className="text-xs text-muted-foreground">
                Last scored: {formatDate(set.prediction.scored_at)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              Prediction not available for this set. The scoring pipeline has not yet been run,
              or this set is not eligible for scoring.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Price History Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Price History
          </CardTitle>
          {priceHistory?.asin && (
            <CardDescription>Amazon price tracking for ASIN {priceHistory.asin}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!set.amazon_asin ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No Amazon ASIN linked to this set. Price history is not available.
            </p>
          ) : priceHistoryLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-[300px] w-full" />
            </div>
          ) : priceHistory?.data && priceHistory.data.length > 0 ? (
            <div>
              <LineChart
                data={priceHistory.data.map((point) => {
                  const mapped: Record<string, string | number> = {
                    snapshot_date: point.snapshot_date,
                  };
                  if (point.buy_box_price != null) mapped.buy_box_price = point.buy_box_price;
                  if (point.was_price_90d != null) mapped.was_price_90d = point.was_price_90d;
                  if (point.lowest_offer_price != null) mapped.lowest_offer_price = point.lowest_offer_price;
                  if (point.sales_rank != null) mapped.sales_rank = point.sales_rank;
                  if (priceHistory.rrp != null) mapped.rrp = priceHistory.rrp;
                  return mapped;
                })}
                xAxisKey="snapshot_date"
                lines={[
                  { dataKey: 'buy_box_price', name: 'Buy Box', color: '#3b82f6' },
                  { dataKey: 'was_price_90d', name: 'Was Price (90d)', color: '#f59e0b' },
                  { dataKey: 'lowest_offer_price', name: 'Lowest Offer', color: '#10b981' },
                  ...(priceHistory.rrp != null
                    ? [{ dataKey: 'rrp' as const, name: 'RRP', color: '#ef4444', dot: false }]
                    : []),
                ]}
                height={350}
                formatXAxis={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                }}
                formatYAxis={(value) => `\u00A3${value}`}
                formatTooltip={(value) => formatCurrency(value)}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {priceHistory?.message || 'No price history data available yet.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? '\u2014'}</dd>
    </div>
  );
}

function InvestmentDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-16 w-16 rounded-lg" />
      </div>

      {/* Quick stats skeleton */}
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Details grid skeleton */}
      <div className="grid gap-6 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3, 4, 5].map((j) => (
                <div key={j} className="flex justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[350px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
