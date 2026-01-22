/**
 * Vinted Automation Dashboard
 *
 * Central control panel for the automated Vinted LEGO arbitrage scanner.
 * Shows scanner status, opportunities, scan history, and configuration.
 */

'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScannerControlPanel } from '@/components/features/vinted-automation/ScannerControlPanel';
import { ConnectionStatusCard } from '@/components/features/vinted-automation/ConnectionStatusCard';
import { OpportunitiesTable } from '@/components/features/vinted-automation/OpportunitiesTable';
import { ScanHistoryTable } from '@/components/features/vinted-automation/ScanHistoryTable';
import { ScheduleViewer } from '@/components/features/vinted-automation/ScheduleViewer';
import { WatchlistPanel } from '@/components/features/vinted-automation/WatchlistPanel';
import { ScannerConfigDialog } from '@/components/features/vinted-automation/ScannerConfigDialog';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';

export default function VintedAutomationPage() {
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vinted Scanner Automation</h1>
          <p className="text-muted-foreground">
            Automated arbitrage scanning with notifications
          </p>
        </div>
        <Button variant="outline" onClick={() => setConfigDialogOpen(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Configuration
        </Button>
      </div>

      {/* Scanner Control & Connection Status */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <ScannerControlPanel />
        </div>
        <ConnectionStatusCard />
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="opportunities" className="space-y-4">
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities">
          <OpportunitiesTable />
        </TabsContent>

        <TabsContent value="schedule">
          <ScheduleViewer />
        </TabsContent>

        <TabsContent value="history">
          <ScanHistoryTable />
        </TabsContent>

        <TabsContent value="watchlist">
          <WatchlistPanel />
        </TabsContent>
      </Tabs>

      {/* Configuration Dialog */}
      <ScannerConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
      />
    </div>
  );
}
