'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface ScopeUpgradePromptProps {
  missingScopes: string[];
}

/**
 * Component to prompt users to reconnect eBay when OAuth scopes are missing
 */
export function ScopeUpgradePrompt({ missingScopes }: ScopeUpgradePromptProps) {
  const handleReconnect = () => {
    // Redirect to eBay OAuth reconnect flow
    window.location.href = '/api/integrations/ebay/connect?upgrade=true';
  };

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Additional Permissions Required</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-3">
          To use the Listing Refresh feature, you need to reconnect your eBay account with
          additional permissions. This will allow us to end and recreate listings on your behalf.
        </p>
        <div className="mb-4 text-sm">
          <p className="font-medium mb-1">Missing permissions:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            {missingScopes.map((scope) => (
              <li key={scope}>
                {scope.includes('sell.inventory')
                  ? 'Inventory management (create/edit listings)'
                  : scope.includes('sell.account')
                    ? 'Account settings (business policies)'
                    : scope}
              </li>
            ))}
          </ul>
        </div>
        <Button onClick={handleReconnect} variant="outline" size="sm">
          <ExternalLink className="mr-2 h-4 w-4" />
          Reconnect eBay Account
        </Button>
      </AlertDescription>
    </Alert>
  );
}
