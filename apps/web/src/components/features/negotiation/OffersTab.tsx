'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Send, Settings, AlertCircle, Loader2, Info } from 'lucide-react';
import {
  useNegotiationConfig,
  useUpdateNegotiationConfig,
  useNegotiationMetrics,
  useNegotiationOffers,
  useSendOffers,
  useDiscountRules,
  useCreateDiscountRule,
  useUpdateDiscountRule,
  useDeleteDiscountRule,
  useEligibleItems,
} from '@/hooks/useNegotiation';
import { MetricsDashboard } from './MetricsDashboard';
import { RecentOffersTable } from './RecentOffersTable';
import { PlannedOffersTable } from './PlannedOffersTable';
import { ConfigModal } from './ConfigModal';

const OFFERS_PAGE_SIZE = 10;

export function OffersTab() {
  const [configOpen, setConfigOpen] = useState(false);
  const [selectedListingIds, setSelectedListingIds] = useState<Set<string>>(new Set());
  const [offersPage, setOffersPage] = useState(0);
  const { toast } = useToast();

  // Data fetching
  const { data: config, isLoading: configLoading } = useNegotiationConfig();
  const { data: metrics, isLoading: metricsLoading } = useNegotiationMetrics(30);
  const { data: offersData, isLoading: offersLoading } = useNegotiationOffers({
    limit: OFFERS_PAGE_SIZE,
    offset: offersPage * OFFERS_PAGE_SIZE,
  });
  const { data: rules, isLoading: rulesLoading } = useDiscountRules();
  const {
    data: eligibleItems,
    isLoading: eligibleLoading,
    error: eligibleError,
  } = useEligibleItems();

  // Mutations
  const sendOffersMutation = useSendOffers();
  const updateConfigMutation = useUpdateNegotiationConfig();
  const createRuleMutation = useCreateDiscountRule();
  const updateRuleMutation = useUpdateDiscountRule();
  const deleteRuleMutation = useDeleteDiscountRule();

  const handleSendOffers = async () => {
    if (selectedListingIds.size === 0) {
      toast({
        title: 'No listings selected',
        description: 'Please select at least one listing to send offers.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await sendOffersMutation.mutateAsync({
        listingIds: Array.from(selectedListingIds),
      });

      if (result.offersSent === 0 && result.eligibleCount === 0) {
        toast({
          title: 'No eligible listings',
          description:
            'No listings are currently eligible for offers. Check your settings or wait for listings to meet the criteria.',
        });
      } else if (result.offersSent === 0) {
        toast({
          title: 'No offers sent',
          description: `${result.eligibleCount} eligible listings found, but no interested buyers available.`,
        });
      } else {
        toast({
          title: 'Offers sent',
          description: `${result.offersSent} offer(s) sent successfully.${
            result.offersFailed > 0 ? ` ${result.offersFailed} failed.` : ''
          }`,
          variant: result.offersFailed > 0 ? 'destructive' : 'default',
        });
        // Clear selection after successful send
        setSelectedListingIds(new Set());
      }
    } catch (error) {
      toast({
        title: 'Error sending offers',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateConfig = async (updates: Record<string, unknown>) => {
    await updateConfigMutation.mutateAsync(updates);
  };

  const handleCreateRule = async (rule: {
    minScore: number;
    maxScore: number;
    discountPercentage: number;
  }) => {
    await createRuleMutation.mutateAsync(rule);
  };

  const handleUpdateRule = async (
    id: string,
    rule: { minScore: number; maxScore: number; discountPercentage: number }
  ) => {
    await updateRuleMutation.mutateAsync({ id, ...rule });
  };

  const handleDeleteRule = async (id: string) => {
    await deleteRuleMutation.mutateAsync(id);
  };

  return (
    <div className="space-y-6" data-testid="negotiation-tab">
      {/* Header with actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Buyer Negotiation</h2>
          <p className="text-sm text-muted-foreground">
            Send targeted discount offers to interested buyers
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSendOffers}
            disabled={sendOffersMutation.isPending || selectedListingIds.size === 0}
            data-testid="send-offers-button"
          >
            {sendOffersMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {selectedListingIds.size > 0
              ? `Send ${selectedListingIds.size} Offer${selectedListingIds.size > 1 ? 's' : ''}`
              : 'Send Offers'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfigOpen(true)}
            data-testid="negotiation-settings-button"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Automation status */}
      {config && (
        <Alert variant={config.automationEnabled ? 'default' : undefined}>
          {config.automationEnabled ? (
            <>
              <Info className="h-4 w-4" />
              <AlertTitle>Automation Enabled</AlertTitle>
              <AlertDescription>
                Offers will be sent automatically at 8am, 12pm, 4pm, and 8pm UK time.
                {config.lastAutoRunAt && (
                  <> Last run: {new Date(config.lastAutoRunAt).toLocaleString('en-GB')}.</>
                )}
              </AlertDescription>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Manual Mode</AlertTitle>
              <AlertDescription>
                Automatic offer sending is disabled. Use the button above to send offers manually,
                or enable automation in settings.
              </AlertDescription>
            </>
          )}
        </Alert>
      )}

      {/* Metrics Dashboard */}
      <MetricsDashboard metrics={metrics} isLoading={metricsLoading} />

      {/* Planned Offers Table */}
      <PlannedOffersTable
        items={eligibleItems}
        isLoading={eligibleLoading}
        error={eligibleError}
        selectedIds={selectedListingIds}
        onSelectionChange={setSelectedListingIds}
      />

      {/* Recent Offers Table */}
      <RecentOffersTable
        offers={offersData?.offers}
        isLoading={offersLoading}
        total={offersData?.total}
        page={offersPage}
        pageSize={OFFERS_PAGE_SIZE}
        onPageChange={setOffersPage}
      />

      {/* Config Modal */}
      <ConfigModal
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        rules={rules}
        isLoading={configLoading || rulesLoading}
        onUpdateConfig={handleUpdateConfig}
        onCreateRule={handleCreateRule}
        onUpdateRule={handleUpdateRule}
        onDeleteRule={handleDeleteRule}
      />
    </div>
  );
}
