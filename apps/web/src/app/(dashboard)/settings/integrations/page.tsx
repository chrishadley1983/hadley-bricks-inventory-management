'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

interface BrickLinkCredentials {
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
}

interface BrickOwlCredentials {
  apiKey: string;
}

interface BricqerCredentials {
  tenantUrl: string;
  apiKey: string;
}

// BrickLink API functions
async function fetchBrickLinkStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/integrations/bricklink/credentials');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function saveBrickLinkCredentials(credentials: BrickLinkCredentials): Promise<void> {
  const response = await fetch('/api/integrations/bricklink/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to save credentials');
  }
}

async function deleteBrickLinkCredentials(): Promise<void> {
  const response = await fetch('/api/integrations/bricklink/credentials', {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete credentials');
  }
}

// Brick Owl API functions
async function fetchBrickOwlStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/integrations/brickowl/credentials');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function saveBrickOwlCredentials(credentials: BrickOwlCredentials): Promise<void> {
  const response = await fetch('/api/integrations/brickowl/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to save credentials');
  }
}

async function deleteBrickOwlCredentials(): Promise<void> {
  const response = await fetch('/api/integrations/brickowl/credentials', {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete credentials');
  }
}

// Bricqer API functions
async function fetchBricqerStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/integrations/bricqer/credentials');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function saveBricqerCredentials(credentials: BricqerCredentials): Promise<void> {
  const response = await fetch('/api/integrations/bricqer/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to save credentials');
  }
}

async function deleteBricqerCredentials(): Promise<void> {
  const response = await fetch('/api/integrations/bricqer/credentials', {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete credentials');
  }
}

// Sync all platforms
async function syncAllPlatforms(): Promise<{ success: boolean; data: Record<string, unknown> }> {
  const response = await fetch('/api/integrations/sync-all-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeItems: true }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to sync');
  }

  return response.json();
}

export default function IntegrationsSettingsPage() {
  const queryClient = useQueryClient();

  // BrickLink state
  const [showBrickLinkSecrets, setShowBrickLinkSecrets] = useState(false);
  const [brickLinkCredentials, setBrickLinkCredentials] = useState<BrickLinkCredentials>({
    consumerKey: '',
    consumerSecret: '',
    tokenValue: '',
    tokenSecret: '',
  });
  const [brickLinkError, setBrickLinkError] = useState<string | null>(null);
  const [brickLinkSuccess, setBrickLinkSuccess] = useState<string | null>(null);

  // Brick Owl state
  const [showBrickOwlSecret, setShowBrickOwlSecret] = useState(false);
  const [brickOwlCredentials, setBrickOwlCredentials] = useState<BrickOwlCredentials>({
    apiKey: '',
  });
  const [brickOwlError, setBrickOwlError] = useState<string | null>(null);
  const [brickOwlSuccess, setBrickOwlSuccess] = useState<string | null>(null);

  // Bricqer state
  const [showBricqerSecret, setShowBricqerSecret] = useState(false);
  const [bricqerCredentials, setBricqerCredentials] = useState<BricqerCredentials>({
    tenantUrl: '',
    apiKey: '',
  });
  const [bricqerError, setBricqerError] = useState<string | null>(null);
  const [bricqerSuccess, setBricqerSuccess] = useState<string | null>(null);

  // BrickLink queries/mutations
  const { data: brickLinkStatus, isLoading: brickLinkStatusLoading } = useQuery({
    queryKey: ['bricklink', 'status'],
    queryFn: fetchBrickLinkStatus,
    refetchInterval: 60000,
  });

  const saveBrickLinkMutation = useMutation({
    mutationFn: saveBrickLinkCredentials,
    onSuccess: () => {
      setBrickLinkSuccess('BrickLink credentials saved and verified successfully');
      setBrickLinkError(null);
      setBrickLinkCredentials({
        consumerKey: '',
        consumerSecret: '',
        tokenValue: '',
        tokenSecret: '',
      });
      queryClient.invalidateQueries({ queryKey: ['bricklink', 'status'] });
    },
    onError: (err: Error) => {
      setBrickLinkError(err.message);
      setBrickLinkSuccess(null);
    },
  });

  const deleteBrickLinkMutation = useMutation({
    mutationFn: deleteBrickLinkCredentials,
    onSuccess: () => {
      setBrickLinkSuccess('BrickLink credentials removed');
      setBrickLinkError(null);
      queryClient.invalidateQueries({ queryKey: ['bricklink', 'status'] });
    },
    onError: (err: Error) => {
      setBrickLinkError(err.message);
      setBrickLinkSuccess(null);
    },
  });

  // Brick Owl queries/mutations
  const { data: brickOwlStatus, isLoading: brickOwlStatusLoading } = useQuery({
    queryKey: ['brickowl', 'status'],
    queryFn: fetchBrickOwlStatus,
    refetchInterval: 60000,
  });

  const saveBrickOwlMutation = useMutation({
    mutationFn: saveBrickOwlCredentials,
    onSuccess: () => {
      setBrickOwlSuccess('Brick Owl credentials saved and verified successfully');
      setBrickOwlError(null);
      setBrickOwlCredentials({ apiKey: '' });
      queryClient.invalidateQueries({ queryKey: ['brickowl', 'status'] });
    },
    onError: (err: Error) => {
      setBrickOwlError(err.message);
      setBrickOwlSuccess(null);
    },
  });

  const deleteBrickOwlMutation = useMutation({
    mutationFn: deleteBrickOwlCredentials,
    onSuccess: () => {
      setBrickOwlSuccess('Brick Owl credentials removed');
      setBrickOwlError(null);
      queryClient.invalidateQueries({ queryKey: ['brickowl', 'status'] });
    },
    onError: (err: Error) => {
      setBrickOwlError(err.message);
      setBrickOwlSuccess(null);
    },
  });

  // Bricqer queries/mutations
  const { data: bricqerStatus, isLoading: bricqerStatusLoading } = useQuery({
    queryKey: ['bricqer', 'status'],
    queryFn: fetchBricqerStatus,
    refetchInterval: 60000,
  });

  const saveBricqerMutation = useMutation({
    mutationFn: saveBricqerCredentials,
    onSuccess: () => {
      setBricqerSuccess('Bricqer credentials saved and verified successfully');
      setBricqerError(null);
      setBricqerCredentials({ tenantUrl: '', apiKey: '' });
      queryClient.invalidateQueries({ queryKey: ['bricqer', 'status'] });
    },
    onError: (err: Error) => {
      setBricqerError(err.message);
      setBricqerSuccess(null);
    },
  });

  const deleteBricqerMutation = useMutation({
    mutationFn: deleteBricqerCredentials,
    onSuccess: () => {
      setBricqerSuccess('Bricqer credentials removed');
      setBricqerError(null);
      queryClient.invalidateQueries({ queryKey: ['bricqer', 'status'] });
    },
    onError: (err: Error) => {
      setBricqerError(err.message);
      setBricqerSuccess(null);
    },
  });

  // Sync all mutation
  const syncAllMutation = useMutation({
    mutationFn: syncAllPlatforms,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const handleSaveBrickLink = () => {
    setBrickLinkError(null);
    setBrickLinkSuccess(null);

    if (
      !brickLinkCredentials.consumerKey ||
      !brickLinkCredentials.consumerSecret ||
      !brickLinkCredentials.tokenValue ||
      !brickLinkCredentials.tokenSecret
    ) {
      setBrickLinkError('All fields are required');
      return;
    }

    saveBrickLinkMutation.mutate(brickLinkCredentials);
  };

  const handleDeleteBrickLink = () => {
    if (confirm('Are you sure you want to remove BrickLink credentials?')) {
      deleteBrickLinkMutation.mutate();
    }
  };

  const handleSaveBrickOwl = () => {
    setBrickOwlError(null);
    setBrickOwlSuccess(null);

    if (!brickOwlCredentials.apiKey) {
      setBrickOwlError('API Key is required');
      return;
    }

    saveBrickOwlMutation.mutate(brickOwlCredentials);
  };

  const handleDeleteBrickOwl = () => {
    if (confirm('Are you sure you want to remove Brick Owl credentials?')) {
      deleteBrickOwlMutation.mutate();
    }
  };

  const handleSaveBricqer = () => {
    setBricqerError(null);
    setBricqerSuccess(null);

    if (!bricqerCredentials.tenantUrl || !bricqerCredentials.apiKey) {
      setBricqerError('Tenant URL and API Key are required');
      return;
    }

    saveBricqerMutation.mutate(bricqerCredentials);
  };

  const handleDeleteBricqer = () => {
    if (confirm('Are you sure you want to remove Bricqer credentials?')) {
      deleteBricqerMutation.mutate();
    }
  };

  const hasConfiguredPlatforms = brickLinkStatus?.configured || brickOwlStatus?.configured || bricqerStatus?.configured;

  return (
    <>
      <Header title="Integrations" />
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Platform Integrations</h2>
            <p className="text-muted-foreground">
              Connect your selling platforms to sync orders automatically
            </p>
          </div>
          {hasConfiguredPlatforms && (
            <Button
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
            >
              {syncAllMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync All Platforms
                </>
              )}
            </Button>
          )}
        </div>

        {syncAllMutation.isSuccess && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Sync completed successfully
            </AlertDescription>
          </Alert>
        )}

        {syncAllMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {syncAllMutation.error instanceof Error
                ? syncAllMutation.error.message
                : 'Sync failed'}
            </AlertDescription>
          </Alert>
        )}

        {/* BrickLink Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-lg font-bold text-blue-700">BL</span>
                </div>
                <div>
                  <CardTitle>BrickLink</CardTitle>
                  <CardDescription>
                    Sync orders from your BrickLink store
                  </CardDescription>
                </div>
              </div>
              {brickLinkStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : brickLinkStatus?.configured ? (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-gray-50 text-gray-700">
                  <XCircle className="mr-1 h-3 w-3" />
                  Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {brickLinkError && (
              <Alert variant="destructive">
                <AlertDescription>{brickLinkError}</AlertDescription>
              </Alert>
            )}

            {brickLinkSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{brickLinkSuccess}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">How to get your BrickLink API credentials:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>
                  Go to{' '}
                  <a
                    href="https://www.bricklink.com/v2/api/register_consumer.page"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    BrickLink API Registration
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Register a new consumer key (or use existing)</li>
                <li>Copy the Consumer Key and Consumer Secret</li>
                <li>Generate Access Tokens and copy Token Value and Token Secret</li>
              </ol>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="consumerKey">Consumer Key</Label>
                <Input
                  id="consumerKey"
                  type={showBrickLinkSecrets ? 'text' : 'password'}
                  placeholder="Enter your Consumer Key"
                  value={brickLinkCredentials.consumerKey}
                  onChange={(e) =>
                    setBrickLinkCredentials({ ...brickLinkCredentials, consumerKey: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="consumerSecret">Consumer Secret</Label>
                <Input
                  id="consumerSecret"
                  type={showBrickLinkSecrets ? 'text' : 'password'}
                  placeholder="Enter your Consumer Secret"
                  value={brickLinkCredentials.consumerSecret}
                  onChange={(e) =>
                    setBrickLinkCredentials({ ...brickLinkCredentials, consumerSecret: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tokenValue">Token Value</Label>
                <Input
                  id="tokenValue"
                  type={showBrickLinkSecrets ? 'text' : 'password'}
                  placeholder="Enter your Token Value"
                  value={brickLinkCredentials.tokenValue}
                  onChange={(e) =>
                    setBrickLinkCredentials({ ...brickLinkCredentials, tokenValue: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tokenSecret">Token Secret</Label>
                <Input
                  id="tokenSecret"
                  type={showBrickLinkSecrets ? 'text' : 'password'}
                  placeholder="Enter your Token Secret"
                  value={brickLinkCredentials.tokenSecret}
                  onChange={(e) =>
                    setBrickLinkCredentials({ ...brickLinkCredentials, tokenSecret: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBrickLinkSecrets(!showBrickLinkSecrets)}
              >
                {showBrickLinkSecrets ? (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Hide Secrets
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Show Secrets
                  </>
                )}
              </Button>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={handleSaveBrickLink}
                disabled={saveBrickLinkMutation.isPending}
              >
                {saveBrickLinkMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Save & Test Connection
                  </>
                )}
              </Button>

              {brickLinkStatus?.configured && (
                <Button
                  variant="destructive"
                  onClick={handleDeleteBrickLink}
                  disabled={deleteBrickLinkMutation.isPending}
                >
                  {deleteBrickLinkMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Disconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Brick Owl Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                  <span className="text-lg font-bold text-orange-700">BO</span>
                </div>
                <div>
                  <CardTitle>Brick Owl</CardTitle>
                  <CardDescription>
                    Sync orders from your Brick Owl store
                  </CardDescription>
                </div>
              </div>
              {brickOwlStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : brickOwlStatus?.configured ? (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-gray-50 text-gray-700">
                  <XCircle className="mr-1 h-3 w-3" />
                  Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {brickOwlError && (
              <Alert variant="destructive">
                <AlertDescription>{brickOwlError}</AlertDescription>
              </Alert>
            )}

            {brickOwlSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{brickOwlSuccess}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">How to get your Brick Owl API key:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>
                  Go to{' '}
                  <a
                    href="https://www.brickowl.com/myaccount/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Brick Owl API Settings
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>If you don&apos;t have an API key, generate one</li>
                <li>Copy the API Key and paste it below</li>
              </ol>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="brickOwlApiKey">API Key</Label>
                <Input
                  id="brickOwlApiKey"
                  type={showBrickOwlSecret ? 'text' : 'password'}
                  placeholder="Enter your Brick Owl API Key"
                  value={brickOwlCredentials.apiKey}
                  onChange={(e) =>
                    setBrickOwlCredentials({ apiKey: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBrickOwlSecret(!showBrickOwlSecret)}
              >
                {showBrickOwlSecret ? (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Hide API Key
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Show API Key
                  </>
                )}
              </Button>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={handleSaveBrickOwl}
                disabled={saveBrickOwlMutation.isPending}
              >
                {saveBrickOwlMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Save & Test Connection
                  </>
                )}
              </Button>

              {brickOwlStatus?.configured && (
                <Button
                  variant="destructive"
                  onClick={handleDeleteBrickOwl}
                  disabled={deleteBrickOwlMutation.isPending}
                >
                  {deleteBrickOwlMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Disconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bricqer Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
                  <span className="text-lg font-bold text-purple-700">BQ</span>
                </div>
                <div>
                  <CardTitle>Bricqer</CardTitle>
                  <CardDescription>
                    Sync orders from your Bricqer account
                  </CardDescription>
                </div>
              </div>
              {bricqerStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : bricqerStatus?.configured ? (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-gray-50 text-gray-700">
                  <XCircle className="mr-1 h-3 w-3" />
                  Not Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {bricqerError && (
              <Alert variant="destructive">
                <AlertDescription>{bricqerError}</AlertDescription>
              </Alert>
            )}

            {bricqerSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{bricqerSuccess}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">How to get your Bricqer API credentials:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Log in to your Bricqer account</li>
                <li>Navigate to Settings &rarr; API Access</li>
                <li>Generate or copy your API Key</li>
                <li>Your tenant URL is your Bricqer store URL (e.g., yourstore.bricqer.com)</li>
              </ol>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="bricqerTenantUrl">Tenant URL</Label>
                <Input
                  id="bricqerTenantUrl"
                  type="text"
                  placeholder="yourstore.bricqer.com"
                  value={bricqerCredentials.tenantUrl}
                  onChange={(e) =>
                    setBricqerCredentials({ ...bricqerCredentials, tenantUrl: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="bricqerApiKey">API Key</Label>
                <Input
                  id="bricqerApiKey"
                  type={showBricqerSecret ? 'text' : 'password'}
                  placeholder="Enter your Bricqer API Key"
                  value={bricqerCredentials.apiKey}
                  onChange={(e) =>
                    setBricqerCredentials({ ...bricqerCredentials, apiKey: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBricqerSecret(!showBricqerSecret)}
              >
                {showBricqerSecret ? (
                  <>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Hide API Key
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-4 w-4" />
                    Show API Key
                  </>
                )}
              </Button>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={handleSaveBricqer}
                disabled={saveBricqerMutation.isPending}
              >
                {saveBricqerMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Save & Test Connection
                  </>
                )}
              </Button>

              {bricqerStatus?.configured && (
                <Button
                  variant="destructive"
                  onClick={handleDeleteBricqer}
                  disabled={deleteBricqerMutation.isPending}
                >
                  {deleteBricqerMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Disconnect
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* eBay - CSV Import Only */}
        <Card className="opacity-60">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
                  <span className="text-lg font-bold text-yellow-700">eB</span>
                </div>
                <div>
                  <CardTitle>eBay</CardTitle>
                  <CardDescription>CSV import only</CardDescription>
                </div>
              </div>
              <Badge variant="secondary">CSV Import</Badge>
            </div>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}
