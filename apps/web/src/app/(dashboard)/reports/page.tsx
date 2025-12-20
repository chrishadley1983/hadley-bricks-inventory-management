'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  TrendingUp,
  Package,
  Clock,
  BarChart3,
  LineChart as LineChartIcon,
  ShoppingBag,
  FileText,
  Settings,
  ArrowRight,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

const reportCategories = [
  {
    title: 'Financial Reports',
    description: 'Profit, loss, and tax reporting',
    reports: [
      {
        name: 'Profit & Loss',
        description: 'Revenue, costs, and profit analysis with period comparison',
        href: '/reports/profit-loss',
        icon: TrendingUp,
        color: 'text-green-600',
      },
      {
        name: 'Tax Summary',
        description: 'UK financial year summary for HMRC reporting',
        href: '/reports/tax-summary',
        icon: FileText,
        color: 'text-purple-600',
      },
    ],
  },
  {
    title: 'Inventory Reports',
    description: 'Stock analysis and valuation',
    reports: [
      {
        name: 'Inventory Valuation',
        description: 'Current stock value at cost and estimated sale price',
        href: '/reports/inventory-valuation',
        icon: Package,
        color: 'text-blue-600',
      },
      {
        name: 'Inventory Aging',
        description: 'Age bracket analysis to identify slow-moving stock',
        href: '/reports/inventory-aging',
        icon: Clock,
        color: 'text-orange-600',
      },
    ],
  },
  {
    title: 'Sales Reports',
    description: 'Sales trends and platform analysis',
    reports: [
      {
        name: 'Platform Performance',
        description: 'Compare sales, profit, and fees across platforms',
        href: '/reports/platform-performance',
        icon: BarChart3,
        color: 'text-indigo-600',
      },
      {
        name: 'Sales Trends',
        description: 'Time-series analysis of sales and revenue',
        href: '/reports/sales-trends',
        icon: LineChartIcon,
        color: 'text-cyan-600',
      },
    ],
  },
  {
    title: 'Purchase Reports',
    description: 'Investment and ROI analysis',
    reports: [
      {
        name: 'Purchase Analysis',
        description: 'ROI tracking per purchase with mileage costs',
        href: '/reports/purchase-analysis',
        icon: ShoppingBag,
        color: 'text-rose-600',
      },
    ],
  },
];

export default function ReportsPage() {
  return (
    <>
      <Header title="Reports" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Financial Reports</h1>
            <p className="text-muted-foreground">
              Comprehensive reporting and analytics for your Lego resale business
            </p>
          </div>
          <Link href="/reports/settings">
            <Button variant="outline">
              <Settings className="mr-2 h-4 w-4" />
              Report Settings
            </Button>
          </Link>
        </div>

        {/* Report Categories */}
        <div className="space-y-8">
          {reportCategories.map((category) => (
            <div key={category.title}>
              <div className="mb-4">
                <h2 className="text-lg font-semibold">{category.title}</h2>
                <p className="text-sm text-muted-foreground">{category.description}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {category.reports.map((report) => {
                  const Icon = report.icon;
                  return (
                    <Link key={report.name} href={report.href}>
                      <Card className="h-full hover:bg-accent/50 transition-colors cursor-pointer">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <div className={`p-2 rounded-lg bg-muted ${report.color}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <CardTitle className="text-base">{report.name}</CardTitle>
                          <CardDescription>{report.description}</CardDescription>
                        </CardHeader>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Quick Stats Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Tips</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Date Range:</strong> All reports support custom date ranges and preset
              periods (this month, last quarter, etc.)
            </p>
            <p>
              <strong>Export:</strong> Reports can be exported to CSV or JSON for external
              analysis
            </p>
            <p>
              <strong>Tax Year:</strong> UK financial year runs April to April. The Tax Summary
              report is specifically designed for HMRC reporting
            </p>
            <p>
              <strong>Mileage:</strong> Collection mileage is tracked at HMRC rate of 45p/mile
              for tax deduction purposes
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
