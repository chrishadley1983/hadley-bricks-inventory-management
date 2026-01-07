'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Link2,
} from 'lucide-react';
import Link from 'next/link';
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

interface AmazonCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  sellerId: string;
}

interface EbayConnectionStatus {
  isConnected: boolean;
  ebayUsername?: string;
  marketplaceId?: string;
  expiresAt?: string;
  needsRefresh?: boolean;
}

interface MonzoConnectionStatus {
  isConnected: boolean;
  source?: string;
  accountType?: string;
  transactionCount?: number;
  lastSyncAt?: string;
}

interface MonzoSyncStatus {
  isRunning: boolean;
  lastSync?: {
    type: 'FULL' | 'INCREMENTAL';
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    startedAt: string;
    completedAt?: string;
    transactionsProcessed?: number;
    error?: string;
  };
}

interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
}

interface PayPalConnectionStatus {
  isConnected: boolean;
  sandbox?: boolean;
  transactionCount?: number;
  lastSyncAt?: string;
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

// Amazon API functions
async function fetchAmazonStatus(): Promise<{ isConfigured: boolean; totalOrders?: number; lastSyncedAt?: string }> {
  const response = await fetch('/api/integrations/amazon/credentials');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function saveAmazonCredentials(credentials: AmazonCredentials): Promise<void> {
  const response = await fetch('/api/integrations/amazon/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to save credentials');
  }
}

async function deleteAmazonCredentials(): Promise<void> {
  const response = await fetch('/api/integrations/amazon/credentials', {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete credentials');
  }
}

async function syncAmazon(): Promise<{ success: boolean; ordersProcessed?: number; ordersCreated?: number; ordersUpdated?: number; errors?: string[] }> {
  const response = await fetch('/api/integrations/amazon/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeItems: true }),
  });

  return response.json();
}

// eBay API functions
async function fetchEbayStatus(): Promise<EbayConnectionStatus> {
  const response = await fetch('/api/integrations/ebay/status');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function testEbayConnection(): Promise<{ success: boolean; message?: string; error?: string; details?: unknown }> {
  const response = await fetch('/api/integrations/ebay/test');
  return response.json();
}

async function disconnectEbay(): Promise<void> {
  const response = await fetch('/api/integrations/ebay/disconnect', {
    method: 'POST',
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to disconnect');
  }
}

async function syncEbay(type: 'orders' | 'transactions' | 'payouts' | 'all'): Promise<{ success: boolean; results?: unknown }> {
  const response = await fetch('/api/integrations/ebay/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });

  return response.json();
}

// Monzo API functions
async function fetchMonzoStatus(): Promise<{ data: { connection: MonzoConnectionStatus; sync: MonzoSyncStatus | null } }> {
  const response = await fetch('/api/integrations/monzo/status');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function syncMonzo(type: 'full' | 'incremental' = 'incremental'): Promise<{ data?: { success: boolean; transactionsProcessed?: number; transactionsCreated?: number; transactionsUpdated?: number }; error?: string }> {
  const response = await fetch('/api/integrations/monzo/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });

  return response.json();
}

// PayPal API functions
async function fetchPayPalStatus(): Promise<PayPalConnectionStatus> {
  const response = await fetch('/api/integrations/paypal/status');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function savePayPalCredentials(credentials: PayPalCredentials): Promise<void> {
  const response = await fetch('/api/integrations/paypal/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to save credentials');
  }
}

async function deletePayPalCredentials(): Promise<void> {
  const response = await fetch('/api/integrations/paypal/credentials', {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete credentials');
  }
}

async function testPayPalConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch('/api/integrations/paypal/test', {
    method: 'POST',
  });
  return response.json();
}

async function syncPayPal(fullSync: boolean = false): Promise<{ success: boolean; transactionsProcessed?: number; transactionsCreated?: number; transactionsUpdated?: number; transactionsSkipped?: number; error?: string }> {
  const response = await fetch('/api/integrations/paypal/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullSync }),
  });

  return response.json();
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
  const searchParams = useSearchParams();

  // Check for eBay OAuth callback status
  const ebaySuccess = searchParams.get('ebay_success');
  const ebayError = searchParams.get('ebay_error');

  // Monzo no longer uses OAuth - syncs from Google Sheets

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

  // Amazon state
  const [showAmazonSecrets, setShowAmazonSecrets] = useState(false);
  const [amazonCredentials, setAmazonCredentials] = useState<AmazonCredentials>({
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    sellerId: '',
  });
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [amazonSuccess, setAmazonSuccess] = useState<string | null>(null);

  // eBay state
  const [ebayMessage, setEbayMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Monzo state
  const [monzoMessage, setMonzoMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // PayPal state
  const [showPayPalSecrets, setShowPayPalSecrets] = useState(false);
  const [paypalCredentials, setPayPalCredentials] = useState<PayPalCredentials>({
    clientId: '',
    clientSecret: '',
    sandbox: false,
  });
  const [paypalError, setPayPalError] = useState<string | null>(null);
  const [paypalSuccess, setPayPalSuccess] = useState<string | null>(null);
  const [paypalMessage, setPayPalMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Handle eBay OAuth callback messages
  useEffect(() => {
    if (ebaySuccess) {
      setEbayMessage({ type: 'success', message: 'Successfully connected to eBay!' });
      // Clear the URL params
      window.history.replaceState({}, '', '/settings/integrations');
      // Refetch eBay status
      queryClient.invalidateQueries({ queryKey: ['ebay', 'status'] });
    } else if (ebayError) {
      setEbayMessage({ type: 'error', message: ebayError });
      window.history.replaceState({}, '', '/settings/integrations');
    }
  }, [ebaySuccess, ebayError, queryClient]);


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

  // Amazon queries/mutations
  const { data: amazonStatus, isLoading: amazonStatusLoading } = useQuery({
    queryKey: ['amazon', 'status'],
    queryFn: fetchAmazonStatus,
    refetchInterval: 60000,
  });

  const saveAmazonMutation = useMutation({
    mutationFn: saveAmazonCredentials,
    onSuccess: () => {
      setAmazonSuccess('Amazon credentials saved and verified successfully');
      setAmazonError(null);
      setAmazonCredentials({ clientId: '', clientSecret: '', refreshToken: '', sellerId: '' });
      queryClient.invalidateQueries({ queryKey: ['amazon', 'status'] });
    },
    onError: (err: Error) => {
      setAmazonError(err.message);
      setAmazonSuccess(null);
    },
  });

  const deleteAmazonMutation = useMutation({
    mutationFn: deleteAmazonCredentials,
    onSuccess: () => {
      setAmazonSuccess('Amazon credentials removed');
      setAmazonError(null);
      queryClient.invalidateQueries({ queryKey: ['amazon', 'status'] });
    },
    onError: (err: Error) => {
      setAmazonError(err.message);
      setAmazonSuccess(null);
    },
  });

  const syncAmazonMutation = useMutation({
    mutationFn: syncAmazon,
    onSuccess: (data) => {
      if (data.success) {
        const detail = data.ordersProcessed !== undefined
          ? ` (${data.ordersProcessed} orders processed, ${data.ordersCreated} created, ${data.ordersUpdated} updated)`
          : '';
        setAmazonSuccess(`Amazon sync completed successfully!${detail}`);
      } else {
        setAmazonError(`Sync completed with errors: ${data.errors?.join(', ') || 'Unknown error'}`);
      }
      queryClient.invalidateQueries({ queryKey: ['amazon', 'status'] });
    },
    onError: (err: Error) => {
      setAmazonError(err.message);
      setAmazonSuccess(null);
    },
  });

  // eBay queries/mutations
  const { data: ebayStatus, isLoading: ebayStatusLoading } = useQuery({
    queryKey: ['ebay', 'status'],
    queryFn: fetchEbayStatus,
    refetchInterval: 60000,
  });

  const testEbayMutation = useMutation({
    mutationFn: testEbayConnection,
    onSuccess: (data) => {
      if (data.success) {
        setEbayMessage({ type: 'success', message: data.message || 'Connection test successful!' });
      } else {
        setEbayMessage({ type: 'error', message: data.error || 'Connection test failed' });
      }
    },
    onError: (err: Error) => {
      setEbayMessage({ type: 'error', message: err.message });
    },
  });

  const disconnectEbayMutation = useMutation({
    mutationFn: disconnectEbay,
    onSuccess: () => {
      setEbayMessage({ type: 'success', message: 'eBay disconnected successfully' });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'status'] });
    },
    onError: (err: Error) => {
      setEbayMessage({ type: 'error', message: err.message });
    },
  });

  const syncEbayMutation = useMutation({
    mutationFn: (type: 'orders' | 'transactions' | 'payouts' | 'all') => syncEbay(type),
    onSuccess: (data) => {
      // Type the results properly
      const results = data.results as Record<string, {
        success?: boolean;
        ordersProcessed?: number;
        recordsProcessed?: number;
        error?: string;
      }> | undefined;

      // Collect success stats and errors
      const successParts: string[] = [];
      const errors: string[] = [];

      if (results?.orders) {
        if (results.orders.success) {
          successParts.push(`${results.orders.ordersProcessed || 0} orders`);
        } else if (results.orders.error) {
          errors.push(`Orders: ${results.orders.error}`);
        }
      }
      if (results?.transactions) {
        if (results.transactions.success) {
          successParts.push(`${results.transactions.recordsProcessed || 0} transactions`);
        } else if (results.transactions.error) {
          errors.push(`Transactions: ${results.transactions.error}`);
        }
      }
      if (results?.payouts) {
        if (results.payouts.success) {
          successParts.push(`${results.payouts.recordsProcessed || 0} payouts`);
        } else if (results.payouts.error) {
          errors.push(`Payouts: ${results.payouts.error}`);
        }
      }

      if (data.success) {
        const detail = successParts.length > 0 ? ` (${successParts.join(', ')})` : '';
        setEbayMessage({ type: 'success', message: `eBay sync completed successfully!${detail}` });
      } else if (errors.length > 0) {
        setEbayMessage({ type: 'error', message: `Sync completed with errors: ${errors.join('; ')}` });
      } else {
        setEbayMessage({ type: 'error', message: 'Sync completed with errors' });
      }
    },
    onError: (err: Error) => {
      setEbayMessage({ type: 'error', message: err.message });
    },
  });

  // Monzo queries/mutations
  const { data: monzoStatus, isLoading: monzoStatusLoading } = useQuery({
    queryKey: ['monzo', 'status'],
    queryFn: fetchMonzoStatus,
    refetchInterval: 60000,
  });

  const syncMonzoMutation = useMutation({
    mutationFn: (type: 'full' | 'incremental') => syncMonzo(type),
    onSuccess: (data) => {
      if (data.data?.success) {
        const detail = data.data.transactionsProcessed !== undefined
          ? ` (${data.data.transactionsProcessed} transactions processed, ${data.data.transactionsCreated} new, ${data.data.transactionsUpdated} updated)`
          : '';
        setMonzoMessage({ type: 'success', message: `Monzo sync completed successfully!${detail}` });
      } else {
        setMonzoMessage({ type: 'error', message: data.error || 'Sync completed with errors' });
      }
      queryClient.invalidateQueries({ queryKey: ['monzo', 'status'] });
    },
    onError: (err: Error) => {
      setMonzoMessage({ type: 'error', message: err.message });
    },
  });

  // PayPal queries/mutations
  const { data: paypalStatus, isLoading: paypalStatusLoading } = useQuery({
    queryKey: ['paypal', 'status'],
    queryFn: fetchPayPalStatus,
    refetchInterval: 60000,
  });

  const savePayPalMutation = useMutation({
    mutationFn: savePayPalCredentials,
    onSuccess: () => {
      setPayPalSuccess('PayPal credentials saved successfully');
      setPayPalError(null);
      setPayPalCredentials({ clientId: '', clientSecret: '', sandbox: false });
      queryClient.invalidateQueries({ queryKey: ['paypal', 'status'] });
    },
    onError: (err: Error) => {
      setPayPalError(err.message);
      setPayPalSuccess(null);
    },
  });

  const deletePayPalMutation = useMutation({
    mutationFn: deletePayPalCredentials,
    onSuccess: () => {
      setPayPalSuccess('PayPal credentials removed');
      setPayPalError(null);
      queryClient.invalidateQueries({ queryKey: ['paypal', 'status'] });
    },
    onError: (err: Error) => {
      setPayPalError(err.message);
      setPayPalSuccess(null);
    },
  });

  const testPayPalMutation = useMutation({
    mutationFn: testPayPalConnection,
    onSuccess: (data) => {
      if (data.success) {
        setPayPalMessage({ type: 'success', message: data.message || 'Connection test successful!' });
      } else {
        setPayPalMessage({ type: 'error', message: data.error || 'Connection test failed' });
      }
    },
    onError: (err: Error) => {
      setPayPalMessage({ type: 'error', message: err.message });
    },
  });

  const syncPayPalMutation = useMutation({
    mutationFn: (fullSync: boolean) => syncPayPal(fullSync),
    onSuccess: (data) => {
      if (data.success) {
        const detail = data.transactionsProcessed !== undefined
          ? ` (${data.transactionsProcessed} processed, ${data.transactionsCreated} new, ${data.transactionsUpdated} updated, ${data.transactionsSkipped} skipped)`
          : '';
        setPayPalMessage({ type: 'success', message: `PayPal sync completed successfully!${detail}` });
      } else {
        setPayPalMessage({ type: 'error', message: data.error || 'Sync completed with errors' });
      }
      queryClient.invalidateQueries({ queryKey: ['paypal', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['paypal', 'transactions'] });
    },
    onError: (err: Error) => {
      setPayPalMessage({ type: 'error', message: err.message });
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

  const handleConnectEbay = () => {
    // Redirect to eBay OAuth flow
    window.location.href = '/api/integrations/ebay/connect?returnUrl=/settings/integrations';
  };

  const handleDisconnectEbay = () => {
    if (confirm('Are you sure you want to disconnect eBay?')) {
      disconnectEbayMutation.mutate();
    }
  };

  const handleSaveAmazon = () => {
    setAmazonError(null);
    setAmazonSuccess(null);

    if (
      !amazonCredentials.clientId ||
      !amazonCredentials.clientSecret ||
      !amazonCredentials.refreshToken ||
      !amazonCredentials.sellerId
    ) {
      setAmazonError('All fields are required');
      return;
    }

    saveAmazonMutation.mutate(amazonCredentials);
  };

  const handleDeleteAmazon = () => {
    if (confirm('Are you sure you want to remove Amazon credentials?')) {
      deleteAmazonMutation.mutate();
    }
  };

  const handleSavePayPal = () => {
    setPayPalError(null);
    setPayPalSuccess(null);

    if (!paypalCredentials.clientId || !paypalCredentials.clientSecret) {
      setPayPalError('Client ID and Client Secret are required');
      return;
    }

    savePayPalMutation.mutate(paypalCredentials);
  };

  const handleDeletePayPal = () => {
    if (confirm('Are you sure you want to remove PayPal credentials?')) {
      deletePayPalMutation.mutate();
    }
  };

  const hasConfiguredPlatforms = brickLinkStatus?.configured || brickOwlStatus?.configured || bricqerStatus?.configured || ebayStatus?.isConnected || amazonStatus?.isConfigured || monzoStatus?.data?.connection?.isConnected || paypalStatus?.isConnected;

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

        {/* eBay Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
                  <span className="text-lg font-bold text-yellow-700">eB</span>
                </div>
                <div>
                  <CardTitle>eBay</CardTitle>
                  <CardDescription>
                    Sync orders and financial data from eBay
                  </CardDescription>
                </div>
              </div>
              {ebayStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : ebayStatus?.isConnected ? (
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
            {syncEbayMutation.isPending && (
              <Alert className="bg-blue-50 border-blue-200">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                <AlertDescription className="text-blue-800">
                  Syncing eBay data... This may take a few minutes for large datasets.
                </AlertDescription>
              </Alert>
            )}

            {ebayMessage && !syncEbayMutation.isPending && (
              <Alert className={ebayMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined} variant={ebayMessage.type === 'error' ? 'destructive' : undefined}>
                {ebayMessage.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                <AlertDescription className={ebayMessage.type === 'success' ? 'text-green-800' : undefined}>
                  {ebayMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {ebayStatus?.isConnected ? (
              <>
                <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">eBay Username:</span>
                    <span className="font-medium">{ebayStatus.ebayUsername || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Marketplace:</span>
                    <span className="font-medium">{ebayStatus.marketplaceId || 'EBAY_GB'}</span>
                  </div>
                  {ebayStatus.expiresAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Token Expires:</span>
                      <span className="font-medium">
                        {new Date(ebayStatus.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => testEbayMutation.mutate()}
                    disabled={testEbayMutation.isPending}
                  >
                    {testEbayMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Test Connection
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => syncEbayMutation.mutate('orders')}
                    disabled={syncEbayMutation.isPending}
                  >
                    {syncEbayMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sync Orders
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => syncEbayMutation.mutate('all')}
                    disabled={syncEbayMutation.isPending}
                  >
                    {syncEbayMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sync All
                  </Button>

                  <Button
                    variant="destructive"
                    onClick={handleDisconnectEbay}
                    disabled={disconnectEbayMutation.isPending}
                  >
                    {disconnectEbayMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Disconnect
                  </Button>
                </div>

                <div className="pt-4 border-t">
                  <Link href="/settings/ebay-sku-matching">
                    <Button variant="outline" className="w-full justify-start">
                      <Link2 className="mr-2 h-4 w-4" />
                      Manage SKU Mappings
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-muted p-4 text-sm">
                  <p className="font-medium mb-2">Connect your eBay account:</p>
                  <p className="text-muted-foreground mb-4">
                    Click the button below to authorize Hadley Bricks to access your eBay seller account.
                    This will allow syncing of orders, transactions, and financial data.
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Order fulfilment data for picking lists</li>
                    <li>Transaction history for reconciliation</li>
                    <li>Payout information for accounting</li>
                  </ul>
                </div>

                <div className="flex gap-2 pt-4 border-t">
                  <Button onClick={handleConnectEbay}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Connect eBay Account
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

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

        {/* Amazon Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
                  <span className="text-lg font-bold text-orange-700">Az</span>
                </div>
                <div>
                  <CardTitle>Amazon</CardTitle>
                  <CardDescription>
                    Sync orders from your Amazon Seller Central account (EU marketplaces)
                  </CardDescription>
                </div>
              </div>
              {amazonStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : amazonStatus?.isConfigured ? (
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
            {amazonError && (
              <Alert variant="destructive">
                <AlertDescription>{amazonError}</AlertDescription>
              </Alert>
            )}

            {amazonSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{amazonSuccess}</AlertDescription>
              </Alert>
            )}

            {amazonStatus?.isConfigured && (
              <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Orders:</span>
                  <span className="font-medium">{amazonStatus.totalOrders || 0}</span>
                </div>
                {amazonStatus.lastSyncedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Synced:</span>
                    <span className="font-medium">
                      {new Date(amazonStatus.lastSyncedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">How to get your Amazon SP-API credentials:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Register as a developer in Amazon Seller Central</li>
                <li>Create an SP-API application</li>
                <li>Authorize the app to access your seller account</li>
                <li>Copy the Client ID, Client Secret, and Refresh Token</li>
                <li>Find your Seller ID in Account Info</li>
              </ol>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="amazonClientId">Client ID (LWA)</Label>
                <Input
                  id="amazonClientId"
                  type={showAmazonSecrets ? 'text' : 'password'}
                  placeholder="amzn1.application-oa2-client.xxxx"
                  value={amazonCredentials.clientId}
                  onChange={(e) =>
                    setAmazonCredentials({ ...amazonCredentials, clientId: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="amazonClientSecret">Client Secret (LWA)</Label>
                <Input
                  id="amazonClientSecret"
                  type={showAmazonSecrets ? 'text' : 'password'}
                  placeholder="amzn1.oa2-cs.v1.xxxx"
                  value={amazonCredentials.clientSecret}
                  onChange={(e) =>
                    setAmazonCredentials({ ...amazonCredentials, clientSecret: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="amazonRefreshToken">Refresh Token</Label>
                <Input
                  id="amazonRefreshToken"
                  type={showAmazonSecrets ? 'text' : 'password'}
                  placeholder="Atzr|IwEBIxxxx"
                  value={amazonCredentials.refreshToken}
                  onChange={(e) =>
                    setAmazonCredentials({ ...amazonCredentials, refreshToken: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="amazonSellerId">Seller ID (Merchant Token)</Label>
                <Input
                  id="amazonSellerId"
                  type="text"
                  placeholder="A2XXXXXXXX"
                  value={amazonCredentials.sellerId}
                  onChange={(e) =>
                    setAmazonCredentials({ ...amazonCredentials, sellerId: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAmazonSecrets(!showAmazonSecrets)}
              >
                {showAmazonSecrets ? (
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
                onClick={handleSaveAmazon}
                disabled={saveAmazonMutation.isPending}
              >
                {saveAmazonMutation.isPending ? (
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

              {amazonStatus?.isConfigured && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => syncAmazonMutation.mutate()}
                    disabled={syncAmazonMutation.isPending}
                  >
                    {syncAmazonMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sync Orders
                  </Button>

                  <Button
                    variant="destructive"
                    onClick={handleDeleteAmazon}
                    disabled={deleteAmazonMutation.isPending}
                  >
                    {deleteAmazonMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Monzo Integration (via Google Sheets) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8505B]/10">
                  <span className="text-lg font-bold text-[#E8505B]">M</span>
                </div>
                <div>
                  <CardTitle>Monzo</CardTitle>
                  <CardDescription>
                    Sync bank transactions from Google Sheets (Monzo export)
                  </CardDescription>
                </div>
              </div>
              {monzoStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Google Sheets
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {monzoMessage && (
              <Alert className={monzoMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined} variant={monzoMessage.type === 'error' ? 'destructive' : undefined}>
                {monzoMessage.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                <AlertDescription className={monzoMessage.type === 'success' ? 'text-green-800' : undefined}>
                  {monzoMessage.message}
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data Source:</span>
                <span className="font-medium">{monzoStatus?.data?.connection?.accountType || 'Google Sheets'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transactions:</span>
                <span className="font-medium">{monzoStatus?.data?.connection?.transactionCount || 0}</span>
              </div>
              {monzoStatus?.data?.connection?.lastSyncAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Synced:</span>
                  <span className="font-medium">
                    {new Date(monzoStatus.data.connection.lastSyncAt).toLocaleString()}
                  </span>
                </div>
              )}
              {monzoStatus?.data?.sync?.lastSync && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Sync Status:</span>
                  <span className={`font-medium ${monzoStatus.data.sync.lastSync.status === 'COMPLETED' ? 'text-green-600' : monzoStatus.data.sync.lastSync.status === 'FAILED' ? 'text-red-600' : 'text-blue-600'}`}>
                    {monzoStatus.data.sync.lastSync.status}
                  </span>
                </div>
              )}
              {monzoStatus?.data?.sync?.isRunning && (
                <div className="flex items-center gap-2 text-blue-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sync in progress...</span>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm">
              <p className="text-blue-800">
                Monzo transactions are synced from the &quot;Monzo Transactions&quot; sheet in your Lego Planning spreadsheet.
                This sheet is live-connected to your Monzo account.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => syncMonzoMutation.mutate('incremental')}
                disabled={syncMonzoMutation.isPending || monzoStatus?.data?.sync?.isRunning}
              >
                {syncMonzoMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sync New Transactions
              </Button>

              <Button
                variant="outline"
                onClick={() => syncMonzoMutation.mutate('full')}
                disabled={syncMonzoMutation.isPending || monzoStatus?.data?.sync?.isRunning}
              >
                {syncMonzoMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Full Sync
              </Button>

              <Link href="/transactions">
                <Button variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Transactions
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* PayPal Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <span className="text-lg font-bold text-blue-700">PP</span>
                </div>
                <div>
                  <CardTitle>PayPal</CardTitle>
                  <CardDescription>
                    Sync fee transactions from PayPal
                  </CardDescription>
                </div>
              </div>
              {paypalStatusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : paypalStatus?.isConnected ? (
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected{paypalStatus.sandbox ? ' (Sandbox)' : ''}
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
            {paypalError && (
              <Alert variant="destructive">
                <AlertDescription>{paypalError}</AlertDescription>
              </Alert>
            )}

            {paypalSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{paypalSuccess}</AlertDescription>
              </Alert>
            )}

            {paypalMessage && (
              <Alert className={paypalMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined} variant={paypalMessage.type === 'error' ? 'destructive' : undefined}>
                {paypalMessage.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                <AlertDescription className={paypalMessage.type === 'success' ? 'text-green-800' : undefined}>
                  {paypalMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {paypalStatus?.isConnected && (
              <div className="rounded-lg bg-muted p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Environment:</span>
                  <span className="font-medium">{paypalStatus.sandbox ? 'Sandbox' : 'Production'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fee Transactions:</span>
                  <span className="font-medium">{paypalStatus.transactionCount || 0}</span>
                </div>
                {paypalStatus.lastSyncAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Synced:</span>
                    <span className="font-medium">
                      {new Date(paypalStatus.lastSyncAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">How to get your PayPal API credentials:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>
                  Go to{' '}
                  <a
                    href="https://developer.paypal.com/dashboard/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    PayPal Developer Dashboard
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Log in with your PayPal Business account</li>
                <li>Go to Apps &amp; Credentials &rarr; Create App (or use existing)</li>
                <li>Enable &quot;Transaction Search&quot; in App Feature Options</li>
                <li>Copy the Client ID and Secret (toggle to Live for production)</li>
              </ol>
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 p-2 rounded">
                Note: Transaction Search permission may take up to 9 hours to activate.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="paypalClientId">Client ID</Label>
                <Input
                  id="paypalClientId"
                  type={showPayPalSecrets ? 'text' : 'password'}
                  placeholder="Enter your PayPal Client ID"
                  value={paypalCredentials.clientId}
                  onChange={(e) =>
                    setPayPalCredentials({ ...paypalCredentials, clientId: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="paypalClientSecret">Client Secret</Label>
                <Input
                  id="paypalClientSecret"
                  type={showPayPalSecrets ? 'text' : 'password'}
                  placeholder="Enter your PayPal Client Secret"
                  value={paypalCredentials.clientSecret}
                  onChange={(e) =>
                    setPayPalCredentials({ ...paypalCredentials, clientSecret: e.target.value })
                  }
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="paypalSandbox"
                  checked={paypalCredentials.sandbox}
                  onChange={(e) =>
                    setPayPalCredentials({ ...paypalCredentials, sandbox: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="paypalSandbox" className="text-sm font-normal cursor-pointer">
                  Use Sandbox environment (for testing)
                </Label>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPayPalSecrets(!showPayPalSecrets)}
              >
                {showPayPalSecrets ? (
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

            <div className="flex flex-wrap gap-2 pt-4 border-t">
              <Button
                onClick={handleSavePayPal}
                disabled={savePayPalMutation.isPending}
              >
                {savePayPalMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Save Credentials
                  </>
                )}
              </Button>

              {paypalStatus?.isConnected && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => testPayPalMutation.mutate()}
                    disabled={testPayPalMutation.isPending}
                  >
                    {testPayPalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Test Connection
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => syncPayPalMutation.mutate(false)}
                    disabled={syncPayPalMutation.isPending}
                  >
                    {syncPayPalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sync
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => syncPayPalMutation.mutate(true)}
                    disabled={syncPayPalMutation.isPending}
                  >
                    {syncPayPalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Full Sync
                  </Button>

                  <Link href="/transactions">
                    <Button variant="outline">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View Transactions
                    </Button>
                  </Link>

                  <Button
                    variant="destructive"
                    onClick={handleDeletePayPal}
                    disabled={deletePayPalMutation.isPending}
                  >
                    {deletePayPalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
