'use client';

import { Package, Layers, PoundSterling, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import type { BrickLinkUpload } from '@/lib/services/bricklink-upload.service';

interface BrickLinkUploadSummaryProps {
  uploads: BrickLinkUpload[];
}

/**
 * Summary card showing aggregated stats for the filtered uploads
 */
export function BrickLinkUploadSummary({ uploads }: BrickLinkUploadSummaryProps) {
  // Calculate totals
  const totalParts = uploads.reduce((sum, u) => sum + u.total_quantity, 0);
  const totalLots = uploads.reduce((sum, u) => sum + (u.lots || 0), 0);
  const totalCost = uploads.reduce((sum, u) => sum + (u.cost || 0), 0);
  const totalValue = uploads.reduce((sum, u) => sum + u.selling_price, 0);
  const totalProfit = totalValue - totalCost;
  const profitMargin = totalValue > 0 ? (totalProfit / totalValue) * 100 : 0;

  const stats = [
    {
      label: 'Parts',
      value: totalParts.toLocaleString(),
      icon: Package,
      subtext: `${uploads.length} uploads`,
    },
    {
      label: 'Lots',
      value: totalLots > 0 ? totalLots.toLocaleString() : '-',
      icon: Layers,
      subtext: totalLots > 0 ? 'unique lots' : 'not tracked',
    },
    {
      label: 'Cost',
      value: formatCurrency(totalCost),
      icon: PoundSterling,
      subtext: 'purchase cost',
    },
    {
      label: 'Value',
      value: formatCurrency(totalValue),
      icon: TrendingUp,
      subtext:
        totalCost > 0
          ? `${profitMargin >= 0 ? '+' : ''}${profitMargin.toFixed(0)}% margin`
          : 'listing value',
      highlight: totalCost > 0,
      positive: profitMargin >= 0,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p
                    className={`text-xs ${stat.highlight ? (stat.positive ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground'}`}
                  >
                    {stat.subtext}
                  </p>
                </div>
                <Icon className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
