'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Table2 } from 'lucide-react';
import { ModelStatusCard } from './ModelStatusCard';
import { TopPicksPreview } from './TopPicksPreview';
import { RetirementRadarSection } from './RetirementRadarSection';
import { PatternsSection } from './PatternsSection';
import { INVESTMENT_CHART_VARS_CLASSNAME } from './investment-chart-tokens';

export function InvestmentDashboard() {
  return (
    <div className={`space-y-6 ${INVESTMENT_CHART_VARS_CLASSNAME}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Investment</h2>
          <p className="text-muted-foreground">
            What to buy, what&apos;s about to retire, and how the market has actually behaved
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/investment/sets">
            <Table2 className="mr-2 h-4 w-4" />
            Browse all sets
          </Link>
        </Button>
      </div>

      <ModelStatusCard />
      <TopPicksPreview />
      <RetirementRadarSection />

      <div>
        <h3 className="mb-3 text-lg font-semibold">Market patterns</h3>
        <PatternsSection />
      </div>
    </div>
  );
}
