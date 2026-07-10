'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useModelStatus } from '@/hooks/use-investment';
import type { ModelHorizonMetrics } from '@/lib/api/investment';

function HorizonSummary({
  title,
  metrics,
  unreliable,
}: {
  title: string;
  metrics: ModelHorizonMetrics;
  unreliable: boolean;
}) {
  return (
    <div className={unreliable ? 'opacity-70' : ''}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {unreliable ? (
          <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            unreliable
          </Badge>
        ) : metrics.beats_baseline ? (
          <Badge variant="outline" className="gap-1 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            beats baseline
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            below baseline
          </Badge>
        )}
      </div>
      <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        <div className="flex justify-between gap-4">
          <dt>Rank quality (Spearman)</dt>
          <dd className="font-mono tabular-nums text-foreground">{metrics.spearman.toFixed(2)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Typical error (MAE)</dt>
          <dd className="font-mono tabular-nums text-foreground">
            ±{metrics.mae_pct.toFixed(0)}pts{' '}
            <span className="text-muted-foreground">(baseline ±{metrics.baseline_mae_pct.toFixed(0)})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Holdout sets</dt>
          <dd className="font-mono tabular-nums text-foreground">{metrics.n_holdout}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ModelStatusCard() {
  const { data, isLoading, error } = useModelStatus();

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-lg border bg-muted" />;
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-destructive">
          Failed to load model status{error ? `: ${error.message}` : ''}
        </CardContent>
      </Card>
    );
  }

  const threeYrUnreliable =
    data.horizon_3yr != null && (data.horizon_3yr.n_holdout < 30 || !data.horizon_3yr.beats_baseline);

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Identity + freshness */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">Prediction model</span>
              {data.model_version && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {data.model_version}
                </Badge>
              )}
              {data.scoring_stale && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  scoring stale
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Trained {data.trained_at ? formatDate(data.trained_at) : '—'}
              {' · '}last scored{' '}
              {data.last_scored_at
                ? `${formatDate(data.last_scored_at)} (${data.scoring_age_days}d ago)`
                : 'never'}
              {data.temporal_cutoff_date &&
                ` · holdout: retirements after ${formatDate(data.temporal_cutoff_date)}`}
            </p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              Screening tool — trust the ranking, not the exact percentages.
            </p>
          </div>

          {/* Coverage */}
          <div className="flex gap-6">
            <div>
              <div className="text-2xl font-bold tabular-nums">{data.scored_sets}</div>
              <div className="text-xs text-muted-foreground">sets scored</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{data.high_confidence_sets}</div>
              <div className="text-xs text-muted-foreground">high confidence</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{data.training_labels}</div>
              <div className="text-xs text-muted-foreground">training labels</div>
            </div>
          </div>

          {/* Honest holdout metrics */}
          <div className="flex gap-8">
            {data.horizon_1yr && (
              <HorizonSummary title="1-year horizon" metrics={data.horizon_1yr} unreliable={false} />
            )}
            {data.horizon_3yr && (
              <HorizonSummary
                title="3-year horizon"
                metrics={data.horizon_3yr}
                unreliable={threeYrUnreliable}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
