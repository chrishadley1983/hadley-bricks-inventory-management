'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  Loader2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MONZO_CATEGORY_LABELS, type MonzoCategory } from '@/lib/monzo/types';
import { useEbaySync } from '@/hooks/use-ebay-sync';
import { usePayPalSync } from '@/hooks/use-paypal-sync';
import { useBrickLinkTransactionSync } from '@/hooks/use-bricklink-transaction-sync';
import { useBrickOwlTransactionSync } from '@/hooks/use-brickowl-transaction-sync';
import { useAmazonTransactionSync } from '@/hooks/use-amazon-transaction-sync';
import { BRICKLINK_STATUS_LABELS } from '@/lib/bricklink';
import { BRICKOWL_STATUS_LABELS } from '@/lib/brickowl';
import { AMAZON_TRANSACTION_TYPE_LABELS, AMAZON_MARKETPLACE_LABELS } from '@/lib/amazon/types';
import { usePerfPage } from '@/hooks/use-perf';

const Header = dynamic(
  () => import('@/components/layout').then((mod) => ({ default: mod.Header })),
  { ssr: false }
);

// ============================================================================
// Monzo Types
// ============================================================================

interface MonzoTransaction {
  id: string;
  monzo_transaction_id: string;
  amount: number;
  currency: string;
  description: string;
  merchant_name: string | null;
  category: string;
  local_category: string | null;
  user_notes: string | null;
  tags: string[];
  created: string;
  settled: string | null;
  is_load: boolean;
}

interface TransactionsResponse {
  data: {
    transactions: MonzoTransaction[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
    summary: {
      totalIncome: number;
      totalExpenses: number;
    };
    categories: string[];
  };
}

interface MonzoStatus {
  data: {
    connection: {
      isConnected: boolean;
      transactionCount?: number;
      lastSyncAt?: string;
    };
    sync: {
      isRunning: boolean;
    } | null;
  };
}

// ============================================================================
// eBay Types
// ============================================================================

interface EbayTransaction {
  id: string;
  ebay_transaction_id: string;
  transaction_type: string;
  transaction_status: string;
  transaction_date: string;
  amount: number;
  currency: string;
  booking_entry: string;
  payout_id: string | null;
  ebay_order_id: string | null;
  buyer_username: string | null;
  item_title: string | null;
  custom_label: string | null;
  sale_amount: number | null;
  total_fee_amount: number | null;
  final_value_fee_fixed: number | null;
  final_value_fee_variable: number | null;
  international_fee: number | null;
  regulatory_operating_fee: number | null;
  transaction_memo: string | null;
  created_at: string;
}

interface EbayTransactionsResponse {
  transactions: EbayTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalSales: number;
    totalFees: number;
    totalRefunds: number;
    netRevenue: number;
  };
}

// ============================================================================
// PayPal Types
// ============================================================================

interface PayPalTransaction {
  id: string;
  paypal_transaction_id: string;
  transaction_date: string;
  transaction_type: string | null;
  transaction_status: string | null;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  balance_amount: number | null;
  currency: string;
  description: string | null;
  from_email: string | null;
  payer_name: string | null;
  invoice_id: string | null;
  created_at: string;
}

interface PayPalTransactionsResponse {
  transactions: PayPalTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalFees: number;
    transactionCount: number;
  };
}

// ============================================================================
// BrickLink Types
// ============================================================================

interface BrickLinkTransaction {
  id: string;
  bricklink_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  base_currency: string;
  shipping: number;
  insurance: number;
  add_charge_1: number;
  add_charge_2: number;
  credit: number;
  coupon_credit: number;
  order_total: number;
  tax: number;
  base_grand_total: number;
  total_lots: number;
  total_items: number;
  order_status: string;
  payment_status: string | null;
  payment_method: string | null;
  payment_date: string | null;
  tracking_number: string | null;
  buyer_location: string | null;
  order_note: string | null;
}

interface BrickLinkTransactionsResponse {
  transactions: BrickLinkTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalSales: number;
    totalShipping: number;
    totalTax: number;
    totalGrandTotal: number;
    transactionCount: number;
  };
}

// ============================================================================
// BrickOwl Types
// ============================================================================

interface BrickOwlTransaction {
  id: string;
  brickowl_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  buyer_username: string | null;
  base_currency: string;
  order_total: number;
  shipping: number;
  tax: number;
  coupon_discount: number;
  combined_shipping_discount: number;
  base_grand_total: number;
  total_lots: number;
  total_items: number;
  order_status: string;
  payment_status: string | null;
  payment_method: string | null;
  tracking_number: string | null;
  shipping_method: string | null;
  buyer_location: string | null;
  buyer_note: string | null;
  seller_note: string | null;
  public_note: string | null;
}

interface BrickOwlTransactionsResponse {
  transactions: BrickOwlTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalSales: number;
    totalShipping: number;
    totalTax: number;
    totalGrandTotal: number;
    transactionCount: number;
  };
}

// ============================================================================
// Amazon Types
// ============================================================================

interface AmazonTransaction {
  id: string;
  amazon_transaction_id: string;
  amazon_order_id: string | null;
  seller_order_id: string | null;
  marketplace_id: string | null;
  transaction_type: string;
  transaction_status: string | null;
  posted_date: string;
  description: string | null;
  total_amount: number;
  currency: string;
  referral_fee: number | null;
  fba_fulfillment_fee: number | null;
  fba_per_unit_fee: number | null;
  fba_weight_fee: number | null;
  total_fees: number | null;
  net_amount: number | null;
  gross_sales_amount: number | null;
  item_title: string | null;
  asin: string | null;
  seller_sku: string | null;
  quantity: number | null;
  fulfillment_channel: string | null;
  store_name: string | null;
  created_at: string;
  // Enriched from platform_orders and order_items
  purchase_date: string | null;
  product_name: string | null;
  order_asin: string | null;
}

interface AmazonTransactionsResponse {
  transactions: AmazonTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalSales: number;
    totalFees: number;
    totalRefunds: number;
    netRevenue: number;
  };
}

// ============================================================================
// Shared Types
// ============================================================================

type MonzoSortField = 'created' | 'merchant_name' | 'description' | 'amount' | 'local_category' | 'user_notes';
type EbaySortField = 'transaction_date' | 'amount' | 'item_title';
type PayPalSortField = 'transaction_date' | 'fee_amount' | 'gross_amount' | 'payer_name';
type BrickLinkSortField = 'order_date' | 'buyer_name' | 'order_status' | 'base_grand_total' | 'shipping';
type BrickOwlSortField = 'order_date' | 'buyer_name' | 'order_status' | 'base_grand_total' | 'shipping';
type AmazonSortField = 'purchase_date' | 'posted_date' | 'total_amount' | 'asin';
type SortDirection = 'asc' | 'desc';

type DateRangeKey = '__all__' | 'this_month' | 'last_month' | 'last_quarter' | 'last_year';

interface DateRange {
  label: string;
  getRange: () => { start: Date; end: Date } | null;
}

const DATE_RANGES: Record<DateRangeKey, DateRange> = {
  __all__: {
    label: 'All Time',
    getRange: () => null,
  },
  this_month: {
    label: 'This Month',
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    },
  },
  last_month: {
    label: 'Last Month',
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end };
    },
  },
  last_quarter: {
    label: 'Last Quarter',
    getRange: () => {
      const now = new Date();
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
      const end = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59, 999);
      return { start, end };
    },
  },
  last_year: {
    label: 'Last Year',
    getRange: () => {
      const now = new Date();
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      return { start, end };
    },
  },
};

// ============================================================================
// API Functions - Monzo
// ============================================================================

async function fetchMonzoTransactions(params: {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  localCategory?: string;
  startDate?: string;
  endDate?: string;
  sortField?: MonzoSortField;
  sortDirection?: SortDirection;
}): Promise<TransactionsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) searchParams.set('search', params.search);
  if (params.category) searchParams.set('category', params.category);
  if (params.localCategory) searchParams.set('localCategory', params.localCategory);
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.sortField) searchParams.set('sortField', params.sortField);
  if (params.sortDirection) searchParams.set('sortDirection', params.sortDirection);

  const response = await fetch(`/api/transactions?${searchParams.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch transactions');
  return response.json();
}

async function fetchMonzoStatus(): Promise<MonzoStatus> {
  const response = await fetch('/api/integrations/monzo/status');
  if (!response.ok) throw new Error('Failed to fetch status');
  return response.json();
}

async function syncMonzo(): Promise<{ data?: { success: boolean; transactionsProcessed?: number }; error?: string }> {
  const response = await fetch('/api/integrations/monzo/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'incremental' }),
  });
  return response.json();
}

async function updateMonzoTransaction(
  id: string,
  data: { user_notes?: string; local_category?: string | null; tags?: string[] }
): Promise<{ data: MonzoTransaction }> {
  const response = await fetch(`/api/transactions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update transaction');
  return response.json();
}

// ============================================================================
// API Functions - eBay
// ============================================================================

async function fetchEbayTransactions(params: {
  page: number;
  pageSize: number;
  search?: string;
  transactionType?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: EbaySortField;
  sortOrder?: SortDirection;
}): Promise<EbayTransactionsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) searchParams.set('search', params.search);
  if (params.transactionType) searchParams.set('transactionType', params.transactionType);
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/ebay/transactions?${searchParams.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch eBay transactions');
  return response.json();
}

// ============================================================================
// API Functions - PayPal
// ============================================================================

async function fetchPayPalTransactions(params: {
  page: number;
  pageSize: number;
  search?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: PayPalSortField;
  sortOrder?: SortDirection;
}): Promise<PayPalTransactionsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) searchParams.set('search', params.search);
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/paypal/transactions?${searchParams.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch PayPal transactions');
  return response.json();
}

// ============================================================================
// API Functions - BrickLink
// ============================================================================

async function fetchBrickLinkTransactions(params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: BrickLinkSortField;
  sortOrder?: SortDirection;
}): Promise<BrickLinkTransactionsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) searchParams.set('search', params.search);
  if (params.status) searchParams.set('status', params.status);
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/bricklink/transactions?${searchParams.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch BrickLink transactions');
  return response.json();
}

// ============================================================================
// API Functions - BrickOwl
// ============================================================================

async function fetchBrickOwlTransactions(params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: BrickOwlSortField;
  sortOrder?: SortDirection;
}): Promise<BrickOwlTransactionsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) searchParams.set('search', params.search);
  if (params.status) searchParams.set('status', params.status);
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/brickowl/transactions?${searchParams.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch BrickOwl transactions');
  return response.json();
}

// ============================================================================
// API Functions - Amazon
// ============================================================================

async function fetchAmazonTransactions(params: {
  page: number;
  pageSize: number;
  search?: string;
  transactionType?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: AmazonSortField;
  sortOrder?: SortDirection;
}): Promise<AmazonTransactionsResponse> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) searchParams.set('search', params.search);
  if (params.transactionType) searchParams.set('transactionType', params.transactionType);
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(`/api/amazon/transactions?${searchParams.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch Amazon transactions');
  return response.json();
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatAmount(amountInPence: number, currency: string = 'GBP'): string {
  const amount = amountInPence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

function formatEbayAmount(amount: number, currency: string = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// eBay Transaction Type Labels
// ============================================================================

const EBAY_TRANSACTION_TYPE_LABELS: Record<string, string> = {
  SALE: 'Sale',
  REFUND: 'Refund',
  CREDIT: 'Credit',
  DISPUTE: 'Dispute',
  NON_SALE_CHARGE: 'Fee',
  SHIPPING_LABEL: 'Shipping Label',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
  PAYOUT: 'Payout',
};

const EBAY_TRANSACTION_TYPES = Object.keys(EBAY_TRANSACTION_TYPE_LABELS);

// ============================================================================
// Main Component
// ============================================================================

export default function TransactionsPage() {
  usePerfPage('TransactionsPage');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'monzo' | 'ebay' | 'paypal' | 'bricklink' | 'brickowl' | 'amazon'>('monzo');

  // ============================================================================
  // Monzo State
  // ============================================================================
  const [monzoPage, setMonzoPage] = useState(1);
  const [monzoPageSize] = useState(50);
  const [monzoSearch, setMonzoSearch] = useState('');
  const [monzoDebouncedSearch, setMonzoDebouncedSearch] = useState('');
  const [monzoLocalCategoryFilter, setMonzoLocalCategoryFilter] = useState<string>('');
  const [monzoDateRangeKey, setMonzoDateRangeKey] = useState<DateRangeKey>('__all__');
  const [monzoSortField, setMonzoSortField] = useState<MonzoSortField>('created');
  const [monzoSortDirection, setMonzoSortDirection] = useState<SortDirection>('desc');
  const [selectedMonzoTransaction, setSelectedMonzoTransaction] = useState<MonzoTransaction | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editLocalCategory, setEditLocalCategory] = useState<string>('');
  const [monzoMessage, setMonzoMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ============================================================================
  // eBay State
  // ============================================================================
  const [ebayPage, setEbayPage] = useState(1);
  const [ebayPageSize] = useState(50);
  const [ebaySearch, setEbaySearch] = useState('');
  const [ebayDebouncedSearch, setEbayDebouncedSearch] = useState('');
  const [ebayTransactionTypeFilter, setEbayTransactionTypeFilter] = useState<string>('');
  const [ebayDateRangeKey, setEbayDateRangeKey] = useState<DateRangeKey>('__all__');
  const [ebaySortField, setEbaySortField] = useState<EbaySortField>('transaction_date');
  const [ebaySortDirection, setEbaySortDirection] = useState<SortDirection>('desc');
  const [ebayMessage, setEbayMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedEbayTransaction, setSelectedEbayTransaction] = useState<EbayTransaction | null>(null);

  // ============================================================================
  // PayPal State
  // ============================================================================
  const [paypalPage, setPayPalPage] = useState(1);
  const [paypalPageSize] = useState(50);
  const [paypalSearch, setPayPalSearch] = useState('');
  const [paypalDebouncedSearch, setPayPalDebouncedSearch] = useState('');
  const [paypalDateRangeKey, setPayPalDateRangeKey] = useState<DateRangeKey>('__all__');
  const [paypalSortField, setPayPalSortField] = useState<PayPalSortField>('transaction_date');
  const [paypalSortDirection, setPayPalSortDirection] = useState<SortDirection>('desc');
  const [paypalMessage, setPayPalMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedPayPalTransaction, setSelectedPayPalTransaction] = useState<PayPalTransaction | null>(null);

  // eBay Sync Hook
  const {
    isConnected: ebayIsConnected,
    isRunning: ebayIsSyncing,
    isSyncing: ebayIsManualSyncing,
    triggerSync: triggerEbaySync,
    lastSyncTime: ebayLastSyncTime,
    syncResult: ebaySyncResult,
    syncError: ebaySyncError,
  } = useEbaySync({ enabled: activeTab === 'ebay' });

  // PayPal Sync Hook
  const {
    isConnected: paypalIsConnected,
    isRunning: paypalIsRunning,
    isSyncing: paypalIsSyncing,
    triggerSync: triggerPayPalSync,
    lastSyncTime: paypalLastSyncTime,
    syncResult: paypalSyncResult,
    syncError: paypalSyncError,
    transactionCount: paypalTransactionCount,
  } = usePayPalSync({ enabled: activeTab === 'paypal' });

  // ============================================================================
  // BrickLink State
  // ============================================================================
  const [bricklinkPage, setBrickLinkPage] = useState(1);
  const [bricklinkPageSize] = useState(50);
  const [bricklinkSearch, setBrickLinkSearch] = useState('');
  const [bricklinkDebouncedSearch, setBrickLinkDebouncedSearch] = useState('');
  const [bricklinkStatusFilter, setBrickLinkStatusFilter] = useState<string>('');
  const [bricklinkDateRangeKey, setBrickLinkDateRangeKey] = useState<DateRangeKey>('__all__');
  const [bricklinkSortField, setBrickLinkSortField] = useState<BrickLinkSortField>('order_date');
  const [bricklinkSortDirection, setBrickLinkSortDirection] = useState<SortDirection>('desc');
  const [bricklinkMessage, setBrickLinkMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedBrickLinkTransaction, setSelectedBrickLinkTransaction] = useState<BrickLinkTransaction | null>(null);

  // BrickLink Sync Hook
  const {
    isConnected: bricklinkIsConnected,
    isRunning: bricklinkIsRunning,
    isSyncing: bricklinkIsSyncing,
    triggerSync: triggerBrickLinkSync,
    triggerResetAndSync: triggerBrickLinkResetAndSync,
    lastSyncTime: bricklinkLastSyncTime,
    syncResult: bricklinkSyncResult,
    syncError: bricklinkSyncError,
    transactionCount: bricklinkTransactionCount,
  } = useBrickLinkTransactionSync({ enabled: activeTab === 'bricklink' });

  // ============================================================================
  // BrickOwl State
  // ============================================================================
  const [brickowlPage, setBrickOwlPage] = useState(1);
  const [brickowlPageSize] = useState(50);
  const [brickowlSearch, setBrickOwlSearch] = useState('');
  const [brickowlDebouncedSearch, setBrickOwlDebouncedSearch] = useState('');
  const [brickowlStatusFilter, setBrickOwlStatusFilter] = useState<string>('');
  const [brickowlDateRangeKey, setBrickOwlDateRangeKey] = useState<DateRangeKey>('__all__');
  const [brickowlSortField, setBrickOwlSortField] = useState<BrickOwlSortField>('order_date');
  const [brickowlSortDirection, setBrickOwlSortDirection] = useState<SortDirection>('desc');
  const [brickowlMessage, setBrickOwlMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedBrickOwlTransaction, setSelectedBrickOwlTransaction] = useState<BrickOwlTransaction | null>(null);

  // BrickOwl Sync Hook
  const {
    isConnected: brickowlIsConnected,
    isRunning: brickowlIsRunning,
    isSyncing: brickowlIsSyncing,
    triggerSync: triggerBrickOwlSync,
    lastSyncTime: brickowlLastSyncTime,
    syncResult: brickowlSyncResult,
    syncError: brickowlSyncError,
    transactionCount: brickowlTransactionCount,
  } = useBrickOwlTransactionSync({ enabled: activeTab === 'brickowl' });

  // ============================================================================
  // Amazon State
  // ============================================================================
  const [amazonPage, setAmazonPage] = useState(1);
  const [amazonPageSize] = useState(50);
  const [amazonSearch, setAmazonSearch] = useState('');
  const [amazonDebouncedSearch, setAmazonDebouncedSearch] = useState('');
  const [amazonTransactionTypeFilter, setAmazonTransactionTypeFilter] = useState<string>('');
  const [amazonDateRangeKey, setAmazonDateRangeKey] = useState<DateRangeKey>('__all__');
  const [amazonSortField, setAmazonSortField] = useState<AmazonSortField>('purchase_date');
  const [amazonSortDirection, setAmazonSortDirection] = useState<SortDirection>('desc');
  const [amazonMessage, setAmazonMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedAmazonTransaction, setSelectedAmazonTransaction] = useState<AmazonTransaction | null>(null);
  const [amazonSyncMode, setAmazonSyncMode] = useState<'incremental' | 'full'>('incremental');

  // Amazon Sync Hook
  const {
    isConnected: amazonIsConnected,
    isRunning: amazonIsRunning,
    isSyncing: amazonIsSyncing,
    triggerSync: triggerAmazonSync,
    lastSyncTime: amazonLastSyncTime,
    syncResult: amazonSyncResult,
    syncError: amazonSyncError,
  } = useAmazonTransactionSync({ enabled: activeTab === 'amazon' });

  // Get date ranges
  const monzoDateRange = useMemo(() => {
    return DATE_RANGES[monzoDateRangeKey].getRange();
  }, [monzoDateRangeKey]);

  const ebayDateRange = useMemo(() => {
    return DATE_RANGES[ebayDateRangeKey].getRange();
  }, [ebayDateRangeKey]);

  const paypalDateRange = useMemo(() => {
    return DATE_RANGES[paypalDateRangeKey].getRange();
  }, [paypalDateRangeKey]);

  const bricklinkDateRange = useMemo(() => {
    return DATE_RANGES[bricklinkDateRangeKey].getRange();
  }, [bricklinkDateRangeKey]);

  const brickowlDateRange = useMemo(() => {
    return DATE_RANGES[brickowlDateRangeKey].getRange();
  }, [brickowlDateRangeKey]);

  const amazonDateRange = useMemo(() => {
    return DATE_RANGES[amazonDateRangeKey].getRange();
  }, [amazonDateRangeKey]);

  // Debounce Monzo search
  useEffect(() => {
    const timer = setTimeout(() => {
      setMonzoDebouncedSearch(monzoSearch);
      setMonzoPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [monzoSearch]);

  // Debounce eBay search
  useEffect(() => {
    const timer = setTimeout(() => {
      setEbayDebouncedSearch(ebaySearch);
      setEbayPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [ebaySearch]);

  // Debounce PayPal search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPayPalDebouncedSearch(paypalSearch);
      setPayPalPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [paypalSearch]);

  // Show eBay sync messages
  useEffect(() => {
    if (ebaySyncResult?.success) {
      setEbayMessage({
        type: 'success',
        message: `Sync completed! ${ebaySyncResult.results?.orders?.ordersProcessed || 0} orders, ${ebaySyncResult.results?.transactions?.recordsProcessed || 0} transactions processed.`,
      });
    }
  }, [ebaySyncResult]);

  useEffect(() => {
    if (ebaySyncError) {
      setEbayMessage({ type: 'error', message: ebaySyncError.message });
    }
  }, [ebaySyncError]);

  // Show PayPal sync messages
  useEffect(() => {
    if (paypalSyncResult?.success) {
      const detail = paypalSyncResult.transactionsProcessed !== undefined
        ? ` (${paypalSyncResult.transactionsProcessed} processed, ${paypalSyncResult.transactionsCreated} new)`
        : '';
      setPayPalMessage({
        type: 'success',
        message: `Sync completed!${detail}`,
      });
    }
  }, [paypalSyncResult]);

  useEffect(() => {
    if (paypalSyncError) {
      setPayPalMessage({ type: 'error', message: paypalSyncError.message });
    }
  }, [paypalSyncError]);

  // Debounce BrickLink search
  useEffect(() => {
    const timer = setTimeout(() => {
      setBrickLinkDebouncedSearch(bricklinkSearch);
      setBrickLinkPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [bricklinkSearch]);

  // Show BrickLink sync messages
  useEffect(() => {
    if (bricklinkSyncResult?.success) {
      const detail = bricklinkSyncResult.ordersProcessed !== undefined
        ? ` (${bricklinkSyncResult.ordersProcessed} processed, ${bricklinkSyncResult.ordersCreated} new)`
        : '';
      setBrickLinkMessage({
        type: 'success',
        message: `Sync completed!${detail}`,
      });
    }
  }, [bricklinkSyncResult]);

  useEffect(() => {
    if (bricklinkSyncError) {
      setBrickLinkMessage({ type: 'error', message: bricklinkSyncError.message });
    }
  }, [bricklinkSyncError]);

  // Debounce BrickOwl search
  useEffect(() => {
    const timer = setTimeout(() => {
      setBrickOwlDebouncedSearch(brickowlSearch);
      setBrickOwlPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [brickowlSearch]);

  // Show BrickOwl sync messages
  useEffect(() => {
    if (brickowlSyncResult?.success) {
      const detail = brickowlSyncResult.ordersProcessed !== undefined
        ? ` (${brickowlSyncResult.ordersProcessed} processed, ${brickowlSyncResult.ordersCreated} new)`
        : '';
      setBrickOwlMessage({
        type: 'success',
        message: `Sync completed!${detail}`,
      });
    }
  }, [brickowlSyncResult]);

  useEffect(() => {
    if (brickowlSyncError) {
      setBrickOwlMessage({ type: 'error', message: brickowlSyncError.message });
    }
  }, [brickowlSyncError]);

  // Debounce Amazon search
  useEffect(() => {
    const timer = setTimeout(() => {
      setAmazonDebouncedSearch(amazonSearch);
      setAmazonPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [amazonSearch]);

  // Show Amazon sync messages
  useEffect(() => {
    if (amazonSyncResult?.success) {
      const result = amazonSyncResult.result;
      const detail = result?.recordsProcessed !== undefined
        ? ` (${result.recordsProcessed} processed, ${result.recordsCreated} new)`
        : '';
      setAmazonMessage({
        type: 'success',
        message: `Sync completed!${detail}`,
      });
    }
  }, [amazonSyncResult]);

  useEffect(() => {
    if (amazonSyncError) {
      setAmazonMessage({ type: 'error', message: amazonSyncError.message });
    }
  }, [amazonSyncError]);

  // ============================================================================
  // Monzo Queries
  // ============================================================================

  const { data: monzoStatus, isLoading: monzoStatusLoading } = useQuery({
    queryKey: ['monzo', 'status'],
    queryFn: fetchMonzoStatus,
    refetchInterval: 30000,
  });

  const { data: monzoTransactionsData, isLoading: monzoTransactionsLoading } = useQuery({
    queryKey: ['transactions', monzoPage, monzoPageSize, monzoDebouncedSearch, monzoLocalCategoryFilter, monzoDateRangeKey, monzoSortField, monzoSortDirection],
    queryFn: () =>
      fetchMonzoTransactions({
        page: monzoPage,
        pageSize: monzoPageSize,
        search: monzoDebouncedSearch || undefined,
        localCategory: monzoLocalCategoryFilter || undefined,
        startDate: monzoDateRange?.start.toISOString(),
        endDate: monzoDateRange?.end.toISOString(),
        sortField: monzoSortField,
        sortDirection: monzoSortDirection,
      }),
    enabled: monzoStatus?.data?.connection?.isConnected && activeTab === 'monzo',
  });

  // ============================================================================
  // eBay Queries
  // ============================================================================

  const { data: ebayTransactionsData, isLoading: ebayTransactionsLoading } = useQuery({
    queryKey: ['ebay', 'transactions', ebayPage, ebayPageSize, ebayDebouncedSearch, ebayTransactionTypeFilter, ebayDateRangeKey, ebaySortField, ebaySortDirection],
    queryFn: () =>
      fetchEbayTransactions({
        page: ebayPage,
        pageSize: ebayPageSize,
        search: ebayDebouncedSearch || undefined,
        transactionType: ebayTransactionTypeFilter || undefined,
        fromDate: ebayDateRange?.start.toISOString(),
        toDate: ebayDateRange?.end.toISOString(),
        sortBy: ebaySortField,
        sortOrder: ebaySortDirection,
      }),
    enabled: ebayIsConnected && activeTab === 'ebay',
  });

  // ============================================================================
  // PayPal Queries
  // ============================================================================

  const { data: paypalTransactionsData, isLoading: paypalTransactionsLoading } = useQuery({
    queryKey: ['paypal', 'transactions', paypalPage, paypalPageSize, paypalDebouncedSearch, paypalDateRangeKey, paypalSortField, paypalSortDirection],
    queryFn: () =>
      fetchPayPalTransactions({
        page: paypalPage,
        pageSize: paypalPageSize,
        search: paypalDebouncedSearch || undefined,
        fromDate: paypalDateRange?.start.toISOString(),
        toDate: paypalDateRange?.end.toISOString(),
        sortBy: paypalSortField,
        sortOrder: paypalSortDirection,
      }),
    enabled: paypalIsConnected && activeTab === 'paypal',
  });

  // ============================================================================
  // BrickLink Queries
  // ============================================================================

  const { data: bricklinkTransactionsData, isLoading: bricklinkTransactionsLoading } = useQuery({
    queryKey: ['bricklink', 'transactions', bricklinkPage, bricklinkPageSize, bricklinkDebouncedSearch, bricklinkStatusFilter, bricklinkDateRangeKey, bricklinkSortField, bricklinkSortDirection],
    queryFn: () =>
      fetchBrickLinkTransactions({
        page: bricklinkPage,
        pageSize: bricklinkPageSize,
        search: bricklinkDebouncedSearch || undefined,
        status: bricklinkStatusFilter || undefined,
        fromDate: bricklinkDateRange?.start.toISOString(),
        toDate: bricklinkDateRange?.end.toISOString(),
        sortBy: bricklinkSortField,
        sortOrder: bricklinkSortDirection,
      }),
    enabled: bricklinkIsConnected && activeTab === 'bricklink',
  });

  // ============================================================================
  // BrickOwl Queries
  // ============================================================================

  const { data: brickowlTransactionsData, isLoading: brickowlTransactionsLoading } = useQuery({
    queryKey: ['brickowl', 'transactions', brickowlPage, brickowlPageSize, brickowlDebouncedSearch, brickowlStatusFilter, brickowlDateRangeKey, brickowlSortField, brickowlSortDirection],
    queryFn: () =>
      fetchBrickOwlTransactions({
        page: brickowlPage,
        pageSize: brickowlPageSize,
        search: brickowlDebouncedSearch || undefined,
        status: brickowlStatusFilter || undefined,
        fromDate: brickowlDateRange?.start.toISOString(),
        toDate: brickowlDateRange?.end.toISOString(),
        sortBy: brickowlSortField,
        sortOrder: brickowlSortDirection,
      }),
    enabled: brickowlIsConnected && activeTab === 'brickowl',
  });

  // ============================================================================
  // Amazon Queries
  // ============================================================================

  const { data: amazonTransactionsData, isLoading: amazonTransactionsLoading } = useQuery({
    queryKey: ['amazon', 'transactions', amazonPage, amazonPageSize, amazonDebouncedSearch, amazonTransactionTypeFilter, amazonDateRangeKey, amazonSortField, amazonSortDirection],
    queryFn: () =>
      fetchAmazonTransactions({
        page: amazonPage,
        pageSize: amazonPageSize,
        search: amazonDebouncedSearch || undefined,
        transactionType: amazonTransactionTypeFilter || undefined,
        fromDate: amazonDateRange?.start.toISOString(),
        toDate: amazonDateRange?.end.toISOString(),
        sortBy: amazonSortField,
        sortOrder: amazonSortDirection,
      }),
    enabled: amazonIsConnected && activeTab === 'amazon',
  });

  // ============================================================================
  // Monzo Mutations
  // ============================================================================

  const monzoSyncMutation = useMutation({
    mutationFn: syncMonzo,
    onSuccess: (data) => {
      if (data.data?.success) {
        setMonzoMessage({
          type: 'success',
          message: `Sync completed! ${data.data.transactionsProcessed || 0} transactions processed.`,
        });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['monzo', 'status'] });
      } else {
        setMonzoMessage({ type: 'error', message: data.error || 'Sync failed' });
      }
    },
    onError: (err: Error) => {
      setMonzoMessage({ type: 'error', message: err.message });
    },
  });

  const monzoUpdateMutation = useMutation({
    mutationFn: (data: { id: string; user_notes?: string; local_category?: string | null }) =>
      updateMonzoTransaction(data.id, {
        user_notes: data.user_notes,
        local_category: data.local_category,
      }),
    onSuccess: () => {
      setMonzoMessage({ type: 'success', message: 'Transaction updated successfully' });
      setSelectedMonzoTransaction(null);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: Error) => {
      setMonzoMessage({ type: 'error', message: err.message });
    },
  });

  // ============================================================================
  // Monzo Handlers
  // ============================================================================

  const handleEditMonzoTransaction = (transaction: MonzoTransaction) => {
    setSelectedMonzoTransaction(transaction);
    setEditNotes(transaction.user_notes || '');
    setEditLocalCategory(transaction.local_category || '');
  };

  const handleSaveMonzoTransaction = () => {
    if (!selectedMonzoTransaction) return;
    monzoUpdateMutation.mutate({
      id: selectedMonzoTransaction.id,
      user_notes: editNotes,
      local_category: editLocalCategory || null,
    });
  };

  const handleMonzoSort = (field: MonzoSortField) => {
    if (monzoSortField === field) {
      setMonzoSortDirection(monzoSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setMonzoSortField(field);
      setMonzoSortDirection('desc');
    }
    setMonzoPage(1);
  };

  // ============================================================================
  // eBay Handlers
  // ============================================================================

  const handleEbaySort = (field: EbaySortField) => {
    if (ebaySortField === field) {
      setEbaySortDirection(ebaySortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setEbaySortField(field);
      setEbaySortDirection('desc');
    }
    setEbayPage(1);
  };

  const handleEbaySync = () => {
    triggerEbaySync('all', false);
  };

  // ============================================================================
  // PayPal Handlers
  // ============================================================================

  const handlePayPalSort = (field: PayPalSortField) => {
    if (paypalSortField === field) {
      setPayPalSortDirection(paypalSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setPayPalSortField(field);
      setPayPalSortDirection('desc');
    }
    setPayPalPage(1);
  };

  const handlePayPalSync = () => {
    triggerPayPalSync(false);
  };

  // ============================================================================
  // BrickLink Handlers
  // ============================================================================

  const handleBrickLinkSort = (field: BrickLinkSortField) => {
    if (bricklinkSortField === field) {
      setBrickLinkSortDirection(bricklinkSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setBrickLinkSortField(field);
      setBrickLinkSortDirection('desc');
    }
    setBrickLinkPage(1);
  };

  const handleBrickLinkSync = () => {
    triggerBrickLinkSync(false);
  };

  const handleBrickLinkResetAndSync = () => {
    if (confirm('This will clear all existing BrickLink transactions and re-sync from scratch. Continue?')) {
      triggerBrickLinkResetAndSync();
    }
  };

  // ============================================================================
  // BrickOwl Handlers
  // ============================================================================

  const handleBrickOwlSort = (field: BrickOwlSortField) => {
    if (brickowlSortField === field) {
      setBrickOwlSortDirection(brickowlSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setBrickOwlSortField(field);
      setBrickOwlSortDirection('desc');
    }
    setBrickOwlPage(1);
  };

  const handleBrickOwlSync = () => {
    // Always do full sync for BrickOwl - simpler and more reliable
    triggerBrickOwlSync(true);
  };

  // ============================================================================
  // Amazon Handlers
  // ============================================================================

  const handleAmazonSort = (field: AmazonSortField) => {
    if (amazonSortField === field) {
      setAmazonSortDirection(amazonSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setAmazonSortField(field);
      setAmazonSortDirection('desc');
    }
    setAmazonPage(1);
  };

  const handleAmazonSync = () => {
    triggerAmazonSync(amazonSyncMode === 'full');
  };

  // ============================================================================
  // Sort Icons
  // ============================================================================

  const MonzoSortIcon = ({ field }: { field: MonzoSortField }) => {
    if (monzoSortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return monzoSortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  const EbaySortIcon = ({ field }: { field: EbaySortField }) => {
    if (ebaySortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return ebaySortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  const PayPalSortIcon = ({ field }: { field: PayPalSortField }) => {
    if (paypalSortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return paypalSortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  const BrickLinkSortIcon = ({ field }: { field: BrickLinkSortField }) => {
    if (bricklinkSortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return bricklinkSortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  const BrickOwlSortIcon = ({ field }: { field: BrickOwlSortField }) => {
    if (brickowlSortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return brickowlSortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  const AmazonSortIcon = ({ field }: { field: AmazonSortField }) => {
    if (amazonSortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return amazonSortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  // ============================================================================
  // Computed Values
  // ============================================================================

  const monzoTotalIncome = monzoTransactionsData?.data?.summary?.totalIncome || 0;
  const monzoTotalExpenses = monzoTransactionsData?.data?.summary?.totalExpenses || 0;
  const monzoDateRangeLabel = DATE_RANGES[monzoDateRangeKey].label;
  const monzoIsConnected = monzoStatus?.data?.connection?.isConnected;
  const monzoIsSyncing = monzoStatus?.data?.sync?.isRunning || monzoSyncMutation.isPending;

  // Use summary from API (calculated from ALL matching transactions, not just current page)
  const ebaySummary = ebayTransactionsData?.summary || {
    totalSales: 0,
    totalFees: 0,
    totalRefunds: 0,
    netRevenue: 0,
  };

  const ebayDateRangeLabel = DATE_RANGES[ebayDateRangeKey].label;

  // PayPal summary from API
  const paypalSummary = paypalTransactionsData?.summary || {
    totalFees: 0,
    transactionCount: 0,
  };
  const paypalDateRangeLabel = DATE_RANGES[paypalDateRangeKey].label;

  // BrickLink summary from API
  const bricklinkSummary = bricklinkTransactionsData?.summary || {
    totalSales: 0,
    totalShipping: 0,
    totalTax: 0,
    totalGrandTotal: 0,
    transactionCount: 0,
  };
  const bricklinkDateRangeLabel = DATE_RANGES[bricklinkDateRangeKey].label;

  // BrickOwl summary from API
  const brickowlSummary = brickowlTransactionsData?.summary || {
    totalSales: 0,
    totalShipping: 0,
    totalTax: 0,
    totalGrandTotal: 0,
    transactionCount: 0,
  };
  const brickowlDateRangeLabel = DATE_RANGES[brickowlDateRangeKey].label;

  // Amazon summary from API
  const amazonSummary = amazonTransactionsData?.summary || {
    totalSales: 0,
    totalFees: 0,
    totalRefunds: 0,
    netRevenue: 0,
  };
  const amazonDateRangeLabel = DATE_RANGES[amazonDateRangeKey].label;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <>
      <Header title="Transactions" />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Transactions</h2>
            <p className="text-muted-foreground">
              View and manage your financial transactions
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'monzo' | 'ebay' | 'paypal' | 'bricklink' | 'brickowl' | 'amazon')}>
          <TabsList>
            <TabsTrigger value="monzo">Monzo</TabsTrigger>
            <TabsTrigger value="ebay">eBay</TabsTrigger>
            <TabsTrigger value="paypal">PayPal</TabsTrigger>
            <TabsTrigger value="bricklink">BrickLink</TabsTrigger>
            <TabsTrigger value="brickowl">BrickOwl</TabsTrigger>
            <TabsTrigger value="amazon">Amazon</TabsTrigger>
          </TabsList>

          {/* ============================================================================ */}
          {/* Monzo Tab */}
          {/* ============================================================================ */}
          <TabsContent value="monzo" className="space-y-6">
            {/* Monzo Sync Button */}
            {monzoIsConnected && (
              <div className="flex justify-end">
                <Button
                  onClick={() => monzoSyncMutation.mutate()}
                  disabled={monzoIsSyncing}
                >
                  {monzoIsSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Transactions
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Monzo Messages */}
            {monzoMessage && (
              <Alert
                className={monzoMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
                variant={monzoMessage.type === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription
                  className={monzoMessage.type === 'success' ? 'text-green-800' : undefined}
                >
                  {monzoMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Not connected message */}
            {!monzoStatusLoading && !monzoIsConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect Monzo</CardTitle>
                  <CardDescription>
                    Connect your Monzo account to view and manage your transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <a href="/settings/integrations">Go to Integrations</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Monzo Summary Cards */}
            {monzoIsConnected && (
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Income</CardTitle>
                    <span className="text-xs text-muted-foreground">{monzoDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatAmount(monzoTotalIncome)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Expenses</CardTitle>
                    <span className="text-xs text-muted-foreground">{monzoDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {formatAmount(monzoTotalExpenses)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
                    <span className="text-xs text-muted-foreground">All time</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {monzoStatus?.data?.connection?.transactionCount || 0}
                    </div>
                    {monzoStatus?.data?.connection?.lastSyncAt && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {formatDateTime(monzoStatus.data.connection.lastSyncAt)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Monzo Filters */}
            {monzoIsConnected && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Search merchant or description..."
                    value={monzoSearch}
                    onChange={(e) => setMonzoSearch(e.target.value)}
                  />
                </div>
                <Select value={monzoDateRangeKey} onValueChange={(v: string) => { setMonzoDateRangeKey(v as DateRangeKey); setMonzoPage(1); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {DATE_RANGES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={monzoLocalCategoryFilter || '__all__'} onValueChange={(v: string) => setMonzoLocalCategoryFilter(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="My Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Categories</SelectItem>
                    {(monzoTransactionsData?.data?.categories || []).map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {MONZO_CATEGORY_LABELS[cat as MonzoCategory] || cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Monzo Transactions Table */}
            {monzoIsConnected && (
              <Card>
                <CardContent className="p-0">
                  {monzoTransactionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleMonzoSort('created')}
                              >
                                Date
                                <MonzoSortIcon field="created" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleMonzoSort('merchant_name')}
                              >
                                Merchant
                                <MonzoSortIcon field="merchant_name" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleMonzoSort('description')}
                              >
                                Description
                                <MonzoSortIcon field="description" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleMonzoSort('amount')}
                              >
                                Amount
                                <MonzoSortIcon field="amount" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleMonzoSort('local_category')}
                              >
                                My Category
                                <MonzoSortIcon field="local_category" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleMonzoSort('user_notes')}
                              >
                                Notes
                                <MonzoSortIcon field="user_notes" />
                              </Button>
                            </TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {monzoTransactionsData?.data?.transactions?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                No transactions found
                              </TableCell>
                            </TableRow>
                          ) : (
                            monzoTransactionsData?.data?.transactions?.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(transaction.created)}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {transaction.merchant_name || '-'}
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate">
                                  {transaction.description}
                                </TableCell>
                                <TableCell
                                  className={`text-right font-medium whitespace-nowrap ${
                                    transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                                  }`}
                                >
                                  {transaction.amount > 0 ? '+' : ''}
                                  {formatAmount(transaction.amount, transaction.currency)}
                                </TableCell>
                                <TableCell>
                                  {transaction.local_category ? (
                                    <Badge variant="secondary" className="text-xs">
                                      {MONZO_CATEGORY_LABELS[transaction.local_category as MonzoCategory] ||
                                        transaction.local_category}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                                  {transaction.user_notes || '-'}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleEditMonzoTransaction(transaction)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>

                      {/* Monzo Pagination */}
                      {monzoTransactionsData?.data?.pagination && (
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {((monzoPage - 1) * monzoPageSize) + 1} to{' '}
                            {Math.min(monzoPage * monzoPageSize, monzoTransactionsData.data.pagination.total)} of{' '}
                            {monzoTransactionsData.data.pagination.total} transactions
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMonzoPage((p) => Math.max(1, p - 1))}
                              disabled={monzoPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <span className="text-sm text-muted-foreground">
                              Page {monzoPage} of {monzoTransactionsData.data.pagination.totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setMonzoPage((p) => p + 1)}
                              disabled={monzoPage >= monzoTransactionsData.data.pagination.totalPages}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================================ */}
          {/* eBay Tab */}
          {/* ============================================================================ */}
          <TabsContent value="ebay" className="space-y-6">
            {/* eBay Sync Button */}
            {ebayIsConnected && (
              <div className="flex justify-end">
                <Button
                  onClick={handleEbaySync}
                  disabled={ebayIsSyncing || ebayIsManualSyncing}
                >
                  {ebayIsSyncing || ebayIsManualSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Transactions
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* eBay Messages */}
            {ebayMessage && (
              <Alert
                className={ebayMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
                variant={ebayMessage.type === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription
                  className={ebayMessage.type === 'success' ? 'text-green-800' : undefined}
                >
                  {ebayMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Not connected message */}
            {!ebayIsConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect eBay</CardTitle>
                  <CardDescription>
                    Connect your eBay account to view and manage your sales transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <a href="/settings/integrations">Go to Integrations</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* eBay Summary Cards */}
            {ebayIsConnected && (
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Sales</CardTitle>
                    <span className="text-xs text-muted-foreground">{ebayDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEbayAmount(ebaySummary.totalSales)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Fees</CardTitle>
                    <span className="text-xs text-muted-foreground">{ebayDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEbayAmount(ebaySummary.totalFees)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Refunds</CardTitle>
                    <span className="text-xs text-muted-foreground">{ebayDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {formatEbayAmount(ebaySummary.totalRefunds)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Transactions</CardTitle>
                    <span className="text-xs text-muted-foreground">{ebayDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {ebayTransactionsData?.pagination?.total || 0}
                    </div>
                    {ebayLastSyncTime && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {formatDateTime(ebayLastSyncTime)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* eBay Filters */}
            {ebayIsConnected && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Search item, order ID, or buyer..."
                    value={ebaySearch}
                    onChange={(e) => setEbaySearch(e.target.value)}
                  />
                </div>
                <Select value={ebayDateRangeKey} onValueChange={(v: string) => { setEbayDateRangeKey(v as DateRangeKey); setEbayPage(1); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {DATE_RANGES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={ebayTransactionTypeFilter || '__all__'} onValueChange={(v: string) => setEbayTransactionTypeFilter(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Transaction Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Types</SelectItem>
                    {EBAY_TRANSACTION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {EBAY_TRANSACTION_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* eBay Transactions Table */}
            {ebayIsConnected && (
              <Card>
                <CardContent className="p-0">
                  {ebayTransactionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleEbaySort('transaction_date')}
                              >
                                Date
                                <EbaySortIcon field="transaction_date" />
                              </Button>
                            </TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleEbaySort('item_title')}
                              >
                                Item
                                <EbaySortIcon field="item_title" />
                              </Button>
                            </TableHead>
                            <TableHead>Order ID</TableHead>
                            <TableHead>Buyer</TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleEbaySort('amount')}
                              >
                                Amount
                                <EbaySortIcon field="amount" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">Fees</TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ebayTransactionsData?.transactions?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                No transactions found. Click &quot;Sync Transactions&quot; to import your eBay data.
                              </TableCell>
                            </TableRow>
                          ) : (
                            ebayTransactionsData?.transactions?.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(transaction.transaction_date)}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      transaction.transaction_type === 'SALE'
                                        ? 'default'
                                        : transaction.transaction_type === 'REFUND'
                                        ? 'destructive'
                                        : 'secondary'
                                    }
                                    className="text-xs"
                                  >
                                    {EBAY_TRANSACTION_TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate">
                                  <div className="flex flex-col">
                                    <span className="truncate">
                                      {transaction.item_title || transaction.transaction_memo || '-'}
                                    </span>
                                    {transaction.custom_label && (
                                      <span className="text-xs text-muted-foreground truncate">
                                        SKU: {transaction.custom_label}
                                      </span>
                                    )}
                                    {!transaction.item_title && transaction.transaction_memo && (
                                      <span className="text-xs text-muted-foreground truncate">
                                        {EBAY_TRANSACTION_TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {transaction.ebay_order_id || '-'}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {transaction.buyer_username || '-'}
                                </TableCell>
                                <TableCell
                                  className={`text-right font-medium whitespace-nowrap ${
                                    transaction.transaction_type === 'NON_SALE_CHARGE' || transaction.transaction_type === 'REFUND'
                                      ? 'text-red-600'
                                      : transaction.amount > 0
                                        ? 'text-green-600'
                                        : 'text-red-600'
                                  }`}
                                >
                                  {transaction.transaction_type === 'NON_SALE_CHARGE' || transaction.transaction_type === 'REFUND'
                                    ? '-'
                                    : transaction.amount > 0
                                      ? '+'
                                      : ''}
                                  {formatEbayAmount(Math.abs(transaction.amount), transaction.currency)}
                                </TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">
                                  {transaction.total_fee_amount
                                    ? formatEbayAmount(Math.abs(transaction.total_fee_amount), transaction.currency)
                                    : '-'}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedEbayTransaction(transaction)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>

                      {/* eBay Pagination */}
                      {ebayTransactionsData?.pagination && (
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {((ebayPage - 1) * ebayPageSize) + 1} to{' '}
                            {Math.min(ebayPage * ebayPageSize, ebayTransactionsData.pagination.total)} of{' '}
                            {ebayTransactionsData.pagination.total} transactions
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEbayPage((p) => Math.max(1, p - 1))}
                              disabled={ebayPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <span className="text-sm text-muted-foreground">
                              Page {ebayPage} of {ebayTransactionsData.pagination.totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEbayPage((p) => p + 1)}
                              disabled={ebayPage >= ebayTransactionsData.pagination.totalPages}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================================ */}
          {/* PayPal Tab */}
          {/* ============================================================================ */}
          <TabsContent value="paypal" className="space-y-6">
            {/* PayPal Sync Button */}
            {paypalIsConnected && (
              <div className="flex justify-end">
                <Button
                  onClick={handlePayPalSync}
                  disabled={paypalIsRunning || paypalIsSyncing}
                >
                  {paypalIsRunning || paypalIsSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Transactions
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* PayPal Messages */}
            {paypalMessage && (
              <Alert
                className={paypalMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
                variant={paypalMessage.type === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription
                  className={paypalMessage.type === 'success' ? 'text-green-800' : undefined}
                >
                  {paypalMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Not connected message */}
            {!paypalIsConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect PayPal</CardTitle>
                  <CardDescription>
                    Connect your PayPal account to view and manage your fee transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <a href="/settings/integrations">Go to Integrations</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* PayPal Summary Cards */}
            {paypalIsConnected && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Fees</CardTitle>
                    <span className="text-xs text-muted-foreground">{paypalDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEbayAmount(paypalSummary.totalFees)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Fee Transactions</CardTitle>
                    <span className="text-xs text-muted-foreground">All time</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {paypalTransactionCount || paypalTransactionsData?.pagination?.total || 0}
                    </div>
                    {paypalLastSyncTime && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {formatDateTime(paypalLastSyncTime)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* PayPal Filters */}
            {paypalIsConnected && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Search payer, email, or description..."
                    value={paypalSearch}
                    onChange={(e) => setPayPalSearch(e.target.value)}
                  />
                </div>
                <Select value={paypalDateRangeKey} onValueChange={(v: string) => { setPayPalDateRangeKey(v as DateRangeKey); setPayPalPage(1); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {DATE_RANGES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* PayPal Transactions Table */}
            {paypalIsConnected && (
              <Card>
                <CardContent className="p-0">
                  {paypalTransactionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handlePayPalSort('transaction_date')}
                              >
                                Date
                                <PayPalSortIcon field="transaction_date" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handlePayPalSort('payer_name')}
                              >
                                Payer
                                <PayPalSortIcon field="payer_name" />
                              </Button>
                            </TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handlePayPalSort('gross_amount')}
                              >
                                Gross
                                <PayPalSortIcon field="gross_amount" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handlePayPalSort('fee_amount')}
                              >
                                Fee
                                <PayPalSortIcon field="fee_amount" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paypalTransactionsData?.transactions?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                No fee transactions found. Click &quot;Sync Transactions&quot; to import your PayPal data.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paypalTransactionsData?.transactions?.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(transaction.transaction_date)}
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span>{transaction.payer_name || '-'}</span>
                                    {transaction.from_email && (
                                      <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                                        {transaction.from_email}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate">
                                  {transaction.description || transaction.transaction_type || '-'}
                                </TableCell>
                                <TableCell className="text-right font-medium whitespace-nowrap text-green-600">
                                  +{formatEbayAmount(transaction.gross_amount, transaction.currency)}
                                </TableCell>
                                <TableCell className="text-right font-medium whitespace-nowrap text-orange-600">
                                  -{formatEbayAmount(Math.abs(transaction.fee_amount), transaction.currency)}
                                </TableCell>
                                <TableCell className="text-right font-medium whitespace-nowrap">
                                  {formatEbayAmount(transaction.net_amount, transaction.currency)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedPayPalTransaction(transaction)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>

                      {/* PayPal Pagination */}
                      {paypalTransactionsData?.pagination && (
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {((paypalPage - 1) * paypalPageSize) + 1} to{' '}
                            {Math.min(paypalPage * paypalPageSize, paypalTransactionsData.pagination.total)} of{' '}
                            {paypalTransactionsData.pagination.total} transactions
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPayPalPage((p) => Math.max(1, p - 1))}
                              disabled={paypalPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <span className="text-sm text-muted-foreground">
                              Page {paypalPage} of {paypalTransactionsData.pagination.totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPayPalPage((p) => p + 1)}
                              disabled={paypalPage >= paypalTransactionsData.pagination.totalPages}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================================ */}
          {/* BrickLink Tab */}
          {/* ============================================================================ */}
          <TabsContent value="bricklink" className="space-y-6">
            {/* BrickLink Sync Buttons */}
            {bricklinkIsConnected && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={handleBrickLinkResetAndSync}
                  disabled={bricklinkIsRunning || bricklinkIsSyncing}
                >
                  {bricklinkIsRunning || bricklinkIsSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reset & Resync
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleBrickLinkSync}
                  disabled={bricklinkIsRunning || bricklinkIsSyncing}
                >
                  {bricklinkIsRunning || bricklinkIsSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Orders
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* BrickLink Messages */}
            {bricklinkMessage && (
              <Alert
                className={bricklinkMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
                variant={bricklinkMessage.type === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription
                  className={bricklinkMessage.type === 'success' ? 'text-green-800' : undefined}
                >
                  {bricklinkMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Not connected message */}
            {!bricklinkIsConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect BrickLink</CardTitle>
                  <CardDescription>
                    Connect your BrickLink account to view and manage your order transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <a href="/settings/integrations">Go to Integrations</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* BrickLink Summary Cards */}
            {bricklinkIsConnected && (
              <div className="grid gap-4 md:grid-cols-5">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Order Total</CardTitle>
                    <span className="text-xs text-muted-foreground">{bricklinkDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEbayAmount(bricklinkSummary.totalSales)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Shipping</CardTitle>
                    <span className="text-xs text-muted-foreground">{bricklinkDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatEbayAmount(bricklinkSummary.totalShipping)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Tax</CardTitle>
                    <span className="text-xs text-muted-foreground">{bricklinkDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEbayAmount(bricklinkSummary.totalTax)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Grand Total</CardTitle>
                    <span className="text-xs text-muted-foreground">{bricklinkDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatEbayAmount(bricklinkSummary.totalGrandTotal)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Orders</CardTitle>
                    <span className="text-xs text-muted-foreground">All time</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {bricklinkTransactionCount || bricklinkTransactionsData?.pagination?.total || 0}
                    </div>
                    {bricklinkLastSyncTime && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {formatDateTime(bricklinkLastSyncTime)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* BrickLink Filters */}
            {bricklinkIsConnected && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Search buyer, order ID..."
                    value={bricklinkSearch}
                    onChange={(e) => setBrickLinkSearch(e.target.value)}
                  />
                </div>
                <Select value={bricklinkDateRangeKey} onValueChange={(v: string) => { setBrickLinkDateRangeKey(v as DateRangeKey); setBrickLinkPage(1); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {DATE_RANGES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={bricklinkStatusFilter || '__all__'} onValueChange={(v: string) => setBrickLinkStatusFilter(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Order Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Statuses</SelectItem>
                    {Object.entries(BRICKLINK_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* BrickLink Transactions Table */}
            {bricklinkIsConnected && (
              <Card>
                <CardContent className="p-0">
                  {bricklinkTransactionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleBrickLinkSort('order_date')}
                              >
                                Date
                                <BrickLinkSortIcon field="order_date" />
                              </Button>
                            </TableHead>
                            <TableHead>Order ID</TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleBrickLinkSort('buyer_name')}
                              >
                                Buyer
                                <BrickLinkSortIcon field="buyer_name" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleBrickLinkSort('order_status')}
                              >
                                Status
                                <BrickLinkSortIcon field="order_status" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">Items</TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleBrickLinkSort('shipping')}
                              >
                                Shipping
                                <BrickLinkSortIcon field="shipping" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleBrickLinkSort('base_grand_total')}
                              >
                                Total
                                <BrickLinkSortIcon field="base_grand_total" />
                              </Button>
                            </TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bricklinkTransactionsData?.transactions?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                No orders found. Click &quot;Sync Orders&quot; to import your BrickLink data.
                              </TableCell>
                            </TableRow>
                          ) : (
                            bricklinkTransactionsData?.transactions?.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(transaction.order_date)}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {transaction.bricklink_order_id}
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span>{transaction.buyer_name}</span>
                                    {transaction.buyer_location && (
                                      <span className="text-xs text-muted-foreground">
                                        {transaction.buyer_location}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      transaction.order_status === 'COMPLETED' || transaction.order_status === 'RECEIVED'
                                        ? 'default'
                                        : transaction.order_status === 'CANCELLED' || transaction.order_status === 'NPB'
                                        ? 'destructive'
                                        : 'secondary'
                                    }
                                    className="text-xs"
                                  >
                                    {BRICKLINK_STATUS_LABELS[transaction.order_status] || transaction.order_status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  <div className="flex flex-col items-end">
                                    <span>{transaction.total_items}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {transaction.total_lots} lots
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">
                                  {formatEbayAmount(transaction.shipping, transaction.base_currency)}
                                </TableCell>
                                <TableCell className="text-right font-medium whitespace-nowrap text-green-600">
                                  {formatEbayAmount(transaction.base_grand_total, transaction.base_currency)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedBrickLinkTransaction(transaction)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>

                      {/* BrickLink Pagination */}
                      {bricklinkTransactionsData?.pagination && (
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {((bricklinkPage - 1) * bricklinkPageSize) + 1} to{' '}
                            {Math.min(bricklinkPage * bricklinkPageSize, bricklinkTransactionsData.pagination.total)} of{' '}
                            {bricklinkTransactionsData.pagination.total} orders
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setBrickLinkPage((p) => Math.max(1, p - 1))}
                              disabled={bricklinkPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <span className="text-sm text-muted-foreground">
                              Page {bricklinkPage} of {bricklinkTransactionsData.pagination.totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setBrickLinkPage((p) => p + 1)}
                              disabled={bricklinkPage >= bricklinkTransactionsData.pagination.totalPages}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================================ */}
          {/* BrickOwl Tab */}
          {/* ============================================================================ */}
          <TabsContent value="brickowl" className="space-y-6">
            {/* BrickOwl Sync Button */}
            {brickowlIsConnected && (
              <div className="flex justify-end">
                <Button
                  onClick={handleBrickOwlSync}
                  disabled={brickowlIsRunning || brickowlIsSyncing}
                >
                  {brickowlIsRunning || brickowlIsSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Orders
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* BrickOwl Messages */}
            {brickowlMessage && (
              <Alert
                className={brickowlMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
                variant={brickowlMessage.type === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription
                  className={brickowlMessage.type === 'success' ? 'text-green-800' : undefined}
                >
                  {brickowlMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Not connected message */}
            {!brickowlIsConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect BrickOwl</CardTitle>
                  <CardDescription>
                    Connect your BrickOwl account to view and manage your order transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <a href="/settings/integrations">Go to Integrations</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* BrickOwl Summary Cards */}
            {brickowlIsConnected && (
              <div className="grid gap-4 md:grid-cols-5">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Order Total</CardTitle>
                    <span className="text-xs text-muted-foreground">{brickowlDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEbayAmount(brickowlSummary.totalSales)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Shipping</CardTitle>
                    <span className="text-xs text-muted-foreground">{brickowlDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatEbayAmount(brickowlSummary.totalShipping)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Tax</CardTitle>
                    <span className="text-xs text-muted-foreground">{brickowlDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEbayAmount(brickowlSummary.totalTax)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Grand Total</CardTitle>
                    <span className="text-xs text-muted-foreground">{brickowlDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatEbayAmount(brickowlSummary.totalGrandTotal)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Orders</CardTitle>
                    <span className="text-xs text-muted-foreground">All time</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {brickowlTransactionCount || brickowlTransactionsData?.pagination?.total || 0}
                    </div>
                    {brickowlLastSyncTime && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {formatDateTime(brickowlLastSyncTime)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* BrickOwl Filters */}
            {brickowlIsConnected && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Search buyer, order ID..."
                    value={brickowlSearch}
                    onChange={(e) => setBrickOwlSearch(e.target.value)}
                  />
                </div>
                <Select value={brickowlDateRangeKey} onValueChange={(v: string) => { setBrickOwlDateRangeKey(v as DateRangeKey); setBrickOwlPage(1); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {DATE_RANGES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={brickowlStatusFilter || '__all__'} onValueChange={(v: string) => setBrickOwlStatusFilter(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Order Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Statuses</SelectItem>
                    {Object.entries(BRICKOWL_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* BrickOwl Transactions Table */}
            {brickowlIsConnected && (
              <Card>
                <CardContent className="p-0">
                  {brickowlTransactionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleBrickOwlSort('order_date')}
                              >
                                Date
                                <BrickOwlSortIcon field="order_date" />
                              </Button>
                            </TableHead>
                            <TableHead>Order ID</TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleBrickOwlSort('buyer_name')}
                              >
                                Buyer
                                <BrickOwlSortIcon field="buyer_name" />
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleBrickOwlSort('order_status')}
                              >
                                Status
                                <BrickOwlSortIcon field="order_status" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">Items</TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleBrickOwlSort('shipping')}
                              >
                                Shipping
                                <BrickOwlSortIcon field="shipping" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleBrickOwlSort('base_grand_total')}
                              >
                                Total
                                <BrickOwlSortIcon field="base_grand_total" />
                              </Button>
                            </TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {brickowlTransactionsData?.transactions?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                No orders found. Click &quot;Sync Orders&quot; to import your BrickOwl data.
                              </TableCell>
                            </TableRow>
                          ) : (
                            brickowlTransactionsData?.transactions?.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(transaction.order_date)}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {transaction.brickowl_order_id}
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex flex-col">
                                    <span>{transaction.buyer_name}</span>
                                    {transaction.buyer_location && (
                                      <span className="text-xs text-muted-foreground">
                                        {transaction.buyer_location}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      transaction.order_status === 'Shipped' || transaction.order_status === 'Received'
                                        ? 'default'
                                        : transaction.order_status === 'Cancelled'
                                        ? 'destructive'
                                        : 'secondary'
                                    }
                                    className="text-xs"
                                  >
                                    {BRICKOWL_STATUS_LABELS[transaction.order_status] || transaction.order_status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  <div className="flex flex-col items-end">
                                    <span>{transaction.total_items}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {transaction.total_lots} lots
                                    </span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">
                                  {formatEbayAmount(transaction.shipping, transaction.base_currency)}
                                </TableCell>
                                <TableCell className="text-right font-medium whitespace-nowrap text-green-600">
                                  {formatEbayAmount(transaction.base_grand_total, transaction.base_currency)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setSelectedBrickOwlTransaction(transaction)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>

                      {/* BrickOwl Pagination */}
                      {brickowlTransactionsData?.pagination && (
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {((brickowlPage - 1) * brickowlPageSize) + 1} to{' '}
                            {Math.min(brickowlPage * brickowlPageSize, brickowlTransactionsData.pagination.total)} of{' '}
                            {brickowlTransactionsData.pagination.total} orders
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setBrickOwlPage((p) => Math.max(1, p - 1))}
                              disabled={brickowlPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <span className="text-sm text-muted-foreground">
                              Page {brickowlPage} of {brickowlTransactionsData.pagination.totalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setBrickOwlPage((p) => p + 1)}
                              disabled={brickowlPage >= brickowlTransactionsData.pagination.totalPages}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================================ */}
          {/* Amazon Tab */}
          {/* ============================================================================ */}
          <TabsContent value="amazon" className="space-y-6">
            {/* Amazon Sync Controls */}
            {amazonIsConnected && (
              <div className="flex items-center justify-end gap-3">
                <Select
                  value={amazonSyncMode}
                  onValueChange={(value: 'incremental' | 'full') => setAmazonSyncMode(value)}
                  disabled={amazonIsSyncing || amazonIsRunning}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="incremental">Incremental Sync</SelectItem>
                    <SelectItem value="full">Full Sync (from 2025)</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAmazonSync}
                  disabled={amazonIsSyncing || amazonIsRunning}
                >
                  {amazonIsSyncing || amazonIsRunning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync Transactions
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Amazon Messages */}
            {amazonMessage && (
              <Alert
                className={amazonMessage.type === 'success' ? 'bg-green-50 border-green-200' : undefined}
                variant={amazonMessage.type === 'error' ? 'destructive' : undefined}
              >
                <AlertDescription
                  className={amazonMessage.type === 'success' ? 'text-green-800' : undefined}
                >
                  {amazonMessage.message}
                </AlertDescription>
              </Alert>
            )}

            {/* Not connected message */}
            {!amazonIsConnected && (
              <Card>
                <CardHeader>
                  <CardTitle>Connect Amazon</CardTitle>
                  <CardDescription>
                    Connect your Amazon Seller account to view and manage your sales transactions.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <a href="/settings/integrations">Go to Integrations</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Amazon Summary Cards */}
            {amazonIsConnected && (
              <div className="grid gap-4 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Sales</CardTitle>
                    <span className="text-xs text-muted-foreground">{amazonDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">
                      {formatEbayAmount(amazonSummary.totalSales)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Fees</CardTitle>
                    <span className="text-xs text-muted-foreground">{amazonDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-orange-600">
                      {formatEbayAmount(amazonSummary.totalFees)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Refunds</CardTitle>
                    <span className="text-xs text-muted-foreground">{amazonDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {formatEbayAmount(amazonSummary.totalRefunds)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Transactions</CardTitle>
                    <span className="text-xs text-muted-foreground">{amazonDateRangeLabel}</span>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {amazonTransactionsData?.pagination?.total || 0}
                    </div>
                    {amazonLastSyncTime && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {formatDateTime(amazonLastSyncTime)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Amazon Filters */}
            {amazonIsConnected && (
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Input
                    placeholder="Search item, order ID, or ASIN..."
                    value={amazonSearch}
                    onChange={(e) => setAmazonSearch(e.target.value)}
                  />
                </div>
                <Select value={amazonDateRangeKey} onValueChange={(v: string) => { setAmazonDateRangeKey(v as DateRangeKey); setAmazonPage(1); }}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_RANGES) as DateRangeKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {DATE_RANGES[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={amazonTransactionTypeFilter || '__all__'} onValueChange={(v: string) => setAmazonTransactionTypeFilter(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Transaction Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Types</SelectItem>
                    {Object.entries(AMAZON_TRANSACTION_TYPE_LABELS).map(([type, label]) => (
                      <SelectItem key={type} value={type}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Amazon Transactions Table */}
            {amazonIsConnected && (
              <Card>
                <CardContent className="p-0">
                  {amazonTransactionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent"
                                onClick={() => handleAmazonSort('purchase_date')}
                              >
                                Purchase Date
                                <AmazonSortIcon field="purchase_date" />
                              </Button>
                            </TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Product Name</TableHead>
                            <TableHead>ASIN</TableHead>
                            <TableHead>Order ID</TableHead>
                            <TableHead>Marketplace</TableHead>
                            <TableHead className="text-right">
                              <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium hover:bg-transparent ml-auto"
                                onClick={() => handleAmazonSort('total_amount')}
                              >
                                Amount
                                <AmazonSortIcon field="total_amount" />
                              </Button>
                            </TableHead>
                            <TableHead className="text-right">Fees</TableHead>
                            <TableHead className="w-[60px]"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {amazonTransactionsData?.transactions?.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={9} className="h-24 text-center">
                                No transactions found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            amazonTransactionsData?.transactions?.map((tx) => (
                              <TableRow
                                key={tx.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => setSelectedAmazonTransaction(tx)}
                              >
                                <TableCell className="whitespace-nowrap">
                                  {formatDate(tx.purchase_date || tx.posted_date)}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      tx.transaction_type === 'Shipment'
                                        ? 'default'
                                        : tx.transaction_type === 'Refund'
                                        ? 'destructive'
                                        : 'secondary'
                                    }
                                  >
                                    {AMAZON_TRANSACTION_TYPE_LABELS[tx.transaction_type] || tx.transaction_type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate">
                                  {tx.product_name || tx.item_title || '-'}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {tx.order_asin || tx.asin || '-'}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {tx.amazon_order_id || '-'}
                                </TableCell>
                                <TableCell>
                                  {tx.marketplace_id ? (AMAZON_MARKETPLACE_LABELS[tx.marketplace_id] || tx.marketplace_id) : '-'}
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                  <span
                                    className={
                                      (tx.gross_sales_amount ?? tx.total_amount) > 0
                                        ? 'text-green-600'
                                        : (tx.gross_sales_amount ?? tx.total_amount) < 0
                                        ? 'text-red-600'
                                        : ''
                                    }
                                  >
                                    {/* Show gross amount for sales, otherwise net */}
                                    {formatEbayAmount(
                                      tx.transaction_type === 'Shipment' && tx.gross_sales_amount
                                        ? tx.gross_sales_amount
                                        : tx.total_amount,
                                      tx.currency
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap text-orange-600">
                                  {tx.total_fees ? formatEbayAmount(Math.abs(tx.total_fees), tx.currency) : '-'}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedAmazonTransaction(tx);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>

                      {/* Pagination */}
                      {amazonTransactionsData && amazonTransactionsData.pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-4 border-t">
                          <p className="text-sm text-muted-foreground">
                            Showing {((amazonPage - 1) * amazonPageSize) + 1} to{' '}
                            {Math.min(amazonPage * amazonPageSize, amazonTransactionsData.pagination.total)} of{' '}
                            {amazonTransactionsData.pagination.total} transactions
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAmazonPage((p) => Math.max(1, p - 1))}
                              disabled={amazonPage === 1}
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAmazonPage((p) => p + 1)}
                              disabled={amazonPage >= amazonTransactionsData.pagination.totalPages}
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* ============================================================================ */}
        {/* Monzo Edit Sheet */}
        {/* ============================================================================ */}
        <Sheet open={!!selectedMonzoTransaction} onOpenChange={() => setSelectedMonzoTransaction(null)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Edit Transaction</SheetTitle>
              <SheetDescription>
                Add notes and categorize this transaction for your records.
              </SheetDescription>
            </SheetHeader>
            {selectedMonzoTransaction && (
              <div className="mt-6 space-y-6">
                {/* Read-only info */}
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span className="font-medium">{formatDateTime(selectedMonzoTransaction.created)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Merchant</span>
                    <span className="font-medium">{selectedMonzoTransaction.merchant_name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span
                      className={`font-medium ${
                        selectedMonzoTransaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {selectedMonzoTransaction.amount > 0 ? '+' : ''}
                      {formatAmount(selectedMonzoTransaction.amount, selectedMonzoTransaction.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Original Category</span>
                    <Badge variant="outline">
                      {MONZO_CATEGORY_LABELS[selectedMonzoTransaction.category as MonzoCategory] ||
                        selectedMonzoTransaction.category}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Description</span>
                    <p className="mt-1 text-sm">{selectedMonzoTransaction.description}</p>
                  </div>
                </div>

                {/* Editable fields */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="localCategory">My Category</Label>
                    <Select value={editLocalCategory || '__none__'} onValueChange={(v: string) => setEditLocalCategory(v === '__none__' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {(monzoTransactionsData?.data?.categories || []).map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {MONZO_CATEGORY_LABELS[cat as MonzoCategory] || cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Override the original category for your own tracking
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      placeholder="Add notes about this transaction..."
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={4}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button
                    className="flex-1"
                    onClick={handleSaveMonzoTransaction}
                    disabled={monzoUpdateMutation.isPending}
                  >
                    {monzoUpdateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelectedMonzoTransaction(null)}
                    disabled={monzoUpdateMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* ============================================================================ */}
        {/* eBay Detail Sheet */}
        {/* ============================================================================ */}
        <Sheet open={!!selectedEbayTransaction} onOpenChange={() => setSelectedEbayTransaction(null)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Transaction Details</SheetTitle>
              <SheetDescription>
                View eBay transaction details and fee breakdown.
              </SheetDescription>
            </SheetHeader>
            {selectedEbayTransaction && (
              <div className="mt-6 space-y-6">
                {/* Transaction Info */}
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span className="font-medium">{formatDateTime(selectedEbayTransaction.transaction_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <Badge
                      variant={
                        selectedEbayTransaction.transaction_type === 'SALE'
                          ? 'default'
                          : selectedEbayTransaction.transaction_type === 'REFUND'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {EBAY_TRANSACTION_TYPE_LABELS[selectedEbayTransaction.transaction_type] || selectedEbayTransaction.transaction_type}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span
                      className={`font-medium ${
                        selectedEbayTransaction.transaction_type === 'NON_SALE_CHARGE' || selectedEbayTransaction.transaction_type === 'REFUND'
                          ? 'text-red-600'
                          : selectedEbayTransaction.amount > 0
                            ? 'text-green-600'
                            : 'text-red-600'
                      }`}
                    >
                      {selectedEbayTransaction.transaction_type === 'NON_SALE_CHARGE' || selectedEbayTransaction.transaction_type === 'REFUND'
                        ? '-'
                        : selectedEbayTransaction.amount > 0
                          ? '+'
                          : ''}
                      {formatEbayAmount(Math.abs(selectedEbayTransaction.amount), selectedEbayTransaction.currency)}
                    </span>
                  </div>
                  {selectedEbayTransaction.item_title && (
                    <div>
                      <span className="text-muted-foreground">Item</span>
                      <p className="mt-1 text-sm font-medium">{selectedEbayTransaction.item_title}</p>
                    </div>
                  )}
                  {!selectedEbayTransaction.item_title && selectedEbayTransaction.transaction_memo && (
                    <div>
                      <span className="text-muted-foreground">Description</span>
                      <p className="mt-1 text-sm font-medium">{selectedEbayTransaction.transaction_memo}</p>
                    </div>
                  )}
                  {selectedEbayTransaction.custom_label && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SKU</span>
                      <span className="font-mono text-sm">{selectedEbayTransaction.custom_label}</span>
                    </div>
                  )}
                  {selectedEbayTransaction.ebay_order_id && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Order ID</span>
                      <span className="font-mono text-xs">{selectedEbayTransaction.ebay_order_id}</span>
                    </div>
                  )}
                  {selectedEbayTransaction.buyer_username && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Buyer</span>
                      <span className="text-sm">{selectedEbayTransaction.buyer_username}</span>
                    </div>
                  )}
                </div>

                {/* Fee Breakdown - for sales with fees */}
                {selectedEbayTransaction.transaction_type === 'SALE' && (selectedEbayTransaction.total_fee_amount || 0) > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium">Fee Breakdown</h4>
                    <div className="rounded-lg border p-4 space-y-2">
                      {selectedEbayTransaction.final_value_fee_fixed && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Final Value Fee (Fixed)</span>
                          <span>{formatEbayAmount(selectedEbayTransaction.final_value_fee_fixed, selectedEbayTransaction.currency)}</span>
                        </div>
                      )}
                      {selectedEbayTransaction.final_value_fee_variable && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Final Value Fee (Variable)</span>
                          <span>{formatEbayAmount(selectedEbayTransaction.final_value_fee_variable, selectedEbayTransaction.currency)}</span>
                        </div>
                      )}
                      {selectedEbayTransaction.international_fee && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">International Fee</span>
                          <span>{formatEbayAmount(selectedEbayTransaction.international_fee, selectedEbayTransaction.currency)}</span>
                        </div>
                      )}
                      {selectedEbayTransaction.regulatory_operating_fee && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Regulatory Operating Fee</span>
                          <span>{formatEbayAmount(selectedEbayTransaction.regulatory_operating_fee, selectedEbayTransaction.currency)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-medium pt-2 border-t">
                        <span>Total Fees</span>
                        <span className="text-orange-600">
                          {formatEbayAmount(Math.abs(selectedEbayTransaction.total_fee_amount || 0), selectedEbayTransaction.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fee Info - for standalone fee transactions */}
                {selectedEbayTransaction.transaction_type === 'NON_SALE_CHARGE' && (
                  <div className="space-y-3">
                    <h4 className="font-medium">Fee Details</h4>
                    <div className="rounded-lg border p-4 space-y-2">
                      <div className="flex justify-between text-sm font-medium">
                        <span>{selectedEbayTransaction.transaction_memo || 'Fee'}</span>
                        <span className="text-orange-600">
                          {formatEbayAmount(Math.abs(selectedEbayTransaction.amount), selectedEbayTransaction.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSelectedEbayTransaction(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* ============================================================================ */}
        {/* PayPal Detail Sheet */}
        {/* ============================================================================ */}
        <Sheet open={!!selectedPayPalTransaction} onOpenChange={() => setSelectedPayPalTransaction(null)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Transaction Details</SheetTitle>
              <SheetDescription>
                View PayPal fee transaction details.
              </SheetDescription>
            </SheetHeader>
            {selectedPayPalTransaction && (
              <div className="mt-6 space-y-6">
                {/* Transaction Info */}
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span className="font-medium">{formatDateTime(selectedPayPalTransaction.transaction_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transaction ID</span>
                    <span className="font-mono text-xs">{selectedPayPalTransaction.paypal_transaction_id}</span>
                  </div>
                  {selectedPayPalTransaction.transaction_type && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <Badge variant="secondary">{selectedPayPalTransaction.transaction_type}</Badge>
                    </div>
                  )}
                  {selectedPayPalTransaction.transaction_status && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium">{selectedPayPalTransaction.transaction_status}</span>
                    </div>
                  )}
                  {selectedPayPalTransaction.payer_name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payer</span>
                      <span className="font-medium">{selectedPayPalTransaction.payer_name}</span>
                    </div>
                  )}
                  {selectedPayPalTransaction.from_email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="text-sm">{selectedPayPalTransaction.from_email}</span>
                    </div>
                  )}
                  {selectedPayPalTransaction.description && (
                    <div>
                      <span className="text-muted-foreground">Description</span>
                      <p className="mt-1 text-sm">{selectedPayPalTransaction.description}</p>
                    </div>
                  )}
                  {selectedPayPalTransaction.invoice_id && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Invoice ID</span>
                      <span className="font-mono text-sm">{selectedPayPalTransaction.invoice_id}</span>
                    </div>
                  )}
                </div>

                {/* Amount Breakdown */}
                <div className="space-y-3">
                  <h4 className="font-medium">Amount Breakdown</h4>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Gross Amount</span>
                      <span className="font-medium text-green-600">
                        +{formatEbayAmount(selectedPayPalTransaction.gross_amount, selectedPayPalTransaction.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Fee</span>
                      <span className="font-medium text-orange-600">
                        -{formatEbayAmount(Math.abs(selectedPayPalTransaction.fee_amount), selectedPayPalTransaction.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-medium pt-2 border-t">
                      <span>Net Amount</span>
                      <span>
                        {formatEbayAmount(selectedPayPalTransaction.net_amount, selectedPayPalTransaction.currency)}
                      </span>
                    </div>
                    {selectedPayPalTransaction.balance_amount !== null && (
                      <div className="flex justify-between text-sm text-muted-foreground pt-2 border-t">
                        <span>Balance After</span>
                        <span>
                          {formatEbayAmount(selectedPayPalTransaction.balance_amount, selectedPayPalTransaction.currency)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSelectedPayPalTransaction(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* ============================================================================ */}
        {/* BrickLink Detail Sheet */}
        {/* ============================================================================ */}
        <Sheet open={!!selectedBrickLinkTransaction} onOpenChange={() => setSelectedBrickLinkTransaction(null)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Order Details</SheetTitle>
              <SheetDescription>
                View BrickLink order details and financial breakdown.
              </SheetDescription>
            </SheetHeader>
            {selectedBrickLinkTransaction && (
              <div className="mt-6 space-y-6">
                {/* Order Info */}
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Date</span>
                    <span className="font-medium">{formatDateTime(selectedBrickLinkTransaction.order_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order ID</span>
                    <span className="font-mono text-sm">{selectedBrickLinkTransaction.bricklink_order_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant={
                        selectedBrickLinkTransaction.order_status === 'COMPLETED' || selectedBrickLinkTransaction.order_status === 'RECEIVED'
                          ? 'default'
                          : selectedBrickLinkTransaction.order_status === 'CANCELLED' || selectedBrickLinkTransaction.order_status === 'NPB'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {BRICKLINK_STATUS_LABELS[selectedBrickLinkTransaction.order_status] || selectedBrickLinkTransaction.order_status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Buyer</span>
                    <span className="font-medium">{selectedBrickLinkTransaction.buyer_name}</span>
                  </div>
                  {selectedBrickLinkTransaction.buyer_email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="text-sm">{selectedBrickLinkTransaction.buyer_email}</span>
                    </div>
                  )}
                  {selectedBrickLinkTransaction.buyer_location && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Location</span>
                      <span className="text-sm">{selectedBrickLinkTransaction.buyer_location}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items</span>
                    <span className="text-sm">{selectedBrickLinkTransaction.total_items} items ({selectedBrickLinkTransaction.total_lots} lots)</span>
                  </div>
                  {selectedBrickLinkTransaction.payment_method && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Method</span>
                      <span className="text-sm">{selectedBrickLinkTransaction.payment_method}</span>
                    </div>
                  )}
                  {selectedBrickLinkTransaction.payment_date && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Date</span>
                      <span className="text-sm">{formatDateTime(selectedBrickLinkTransaction.payment_date)}</span>
                    </div>
                  )}
                  {selectedBrickLinkTransaction.tracking_number && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tracking</span>
                      <span className="font-mono text-xs">{selectedBrickLinkTransaction.tracking_number}</span>
                    </div>
                  )}
                </div>

                {/* Financial Breakdown */}
                <div className="space-y-3">
                  <h4 className="font-medium">Financial Breakdown</h4>
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Order Total</span>
                      <span className="font-medium">
                        {formatEbayAmount(selectedBrickLinkTransaction.order_total, selectedBrickLinkTransaction.base_currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Shipping</span>
                      <span>
                        {formatEbayAmount(selectedBrickLinkTransaction.shipping, selectedBrickLinkTransaction.base_currency)}
                      </span>
                    </div>
                    {selectedBrickLinkTransaction.insurance > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Insurance</span>
                        <span>
                          {formatEbayAmount(selectedBrickLinkTransaction.insurance, selectedBrickLinkTransaction.base_currency)}
                        </span>
                      </div>
                    )}
                    {selectedBrickLinkTransaction.add_charge_1 > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Additional Charge 1</span>
                        <span>
                          {formatEbayAmount(selectedBrickLinkTransaction.add_charge_1, selectedBrickLinkTransaction.base_currency)}
                        </span>
                      </div>
                    )}
                    {selectedBrickLinkTransaction.add_charge_2 > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Additional Charge 2</span>
                        <span>
                          {formatEbayAmount(selectedBrickLinkTransaction.add_charge_2, selectedBrickLinkTransaction.base_currency)}
                        </span>
                      </div>
                    )}
                    {selectedBrickLinkTransaction.credit > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Credit</span>
                        <span className="text-red-600">
                          -{formatEbayAmount(selectedBrickLinkTransaction.credit, selectedBrickLinkTransaction.base_currency)}
                        </span>
                      </div>
                    )}
                    {selectedBrickLinkTransaction.coupon_credit > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Coupon Credit</span>
                        <span className="text-red-600">
                          -{formatEbayAmount(selectedBrickLinkTransaction.coupon_credit, selectedBrickLinkTransaction.base_currency)}
                        </span>
                      </div>
                    )}
                    {selectedBrickLinkTransaction.tax > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tax</span>
                        <span>
                          {formatEbayAmount(selectedBrickLinkTransaction.tax, selectedBrickLinkTransaction.base_currency)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-medium pt-2 border-t">
                      <span>Grand Total</span>
                      <span className="text-green-600">
                        {formatEbayAmount(selectedBrickLinkTransaction.base_grand_total, selectedBrickLinkTransaction.base_currency)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {selectedBrickLinkTransaction.order_note && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Order Note</h4>
                    <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                      {selectedBrickLinkTransaction.order_note}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSelectedBrickLinkTransaction(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* ============================================================================ */}
        {/* BrickOwl Detail Sheet */}
        {/* ============================================================================ */}
        <Sheet open={!!selectedBrickOwlTransaction} onOpenChange={() => setSelectedBrickOwlTransaction(null)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Order Details</SheetTitle>
              <SheetDescription>
                View BrickOwl order details and financial breakdown.
              </SheetDescription>
            </SheetHeader>
            {selectedBrickOwlTransaction && (
              <div className="mt-6 space-y-6">
                {/* Order Info */}
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Date</span>
                    <span className="font-medium">{formatDateTime(selectedBrickOwlTransaction.order_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order ID</span>
                    <span className="font-mono text-sm">{selectedBrickOwlTransaction.brickowl_order_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant={
                        selectedBrickOwlTransaction.order_status === 'Shipped' || selectedBrickOwlTransaction.order_status === 'Received'
                          ? 'default'
                          : selectedBrickOwlTransaction.order_status === 'Cancelled'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {selectedBrickOwlTransaction.order_status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Buyer</span>
                    <span className="font-medium">{selectedBrickOwlTransaction.buyer_name}</span>
                  </div>
                  {selectedBrickOwlTransaction.buyer_email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="text-sm">{selectedBrickOwlTransaction.buyer_email}</span>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.buyer_username && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Username</span>
                      <span className="text-sm">{selectedBrickOwlTransaction.buyer_username}</span>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.buyer_location && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Location</span>
                      <span className="text-sm">{selectedBrickOwlTransaction.buyer_location}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items</span>
                    <span className="text-sm">{selectedBrickOwlTransaction.total_items} items ({selectedBrickOwlTransaction.total_lots} lots)</span>
                  </div>
                  {selectedBrickOwlTransaction.payment_method && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Method</span>
                      <span className="text-sm">{selectedBrickOwlTransaction.payment_method}</span>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.payment_status && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Payment Status</span>
                      <Badge variant="outline">{selectedBrickOwlTransaction.payment_status}</Badge>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.tracking_number && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tracking</span>
                      <span className="font-mono text-xs">{selectedBrickOwlTransaction.tracking_number}</span>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.shipping_method && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Shipping Method</span>
                      <span className="text-sm">{selectedBrickOwlTransaction.shipping_method}</span>
                    </div>
                  )}
                </div>

                {/* Financial Breakdown */}
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-medium">Financial Breakdown</h4>
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span>{formatEbayAmount(selectedBrickOwlTransaction.order_total, selectedBrickOwlTransaction.base_currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Shipping</span>
                    <span>{formatEbayAmount(selectedBrickOwlTransaction.shipping, selectedBrickOwlTransaction.base_currency)}</span>
                  </div>
                  {selectedBrickOwlTransaction.tax > 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Tax</span>
                      <span>{formatEbayAmount(selectedBrickOwlTransaction.tax, selectedBrickOwlTransaction.base_currency)}</span>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.coupon_discount > 0 && (
                    <div className="flex justify-between text-sm text-red-500">
                      <span>Coupon Discount</span>
                      <span>-{formatEbayAmount(selectedBrickOwlTransaction.coupon_discount, selectedBrickOwlTransaction.base_currency)}</span>
                    </div>
                  )}
                  {selectedBrickOwlTransaction.combined_shipping_discount > 0 && (
                    <div className="flex justify-between text-sm text-red-500">
                      <span>Combined Shipping Discount</span>
                      <span>-{formatEbayAmount(selectedBrickOwlTransaction.combined_shipping_discount, selectedBrickOwlTransaction.base_currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-medium pt-2 border-t">
                    <span>Grand Total</span>
                    <span className="text-green-600">
                      {formatEbayAmount(selectedBrickOwlTransaction.base_grand_total, selectedBrickOwlTransaction.base_currency)}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                {(selectedBrickOwlTransaction.buyer_note || selectedBrickOwlTransaction.seller_note || selectedBrickOwlTransaction.public_note) && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <h4 className="font-medium">Notes</h4>
                    {selectedBrickOwlTransaction.buyer_note && (
                      <div>
                        <span className="text-xs text-muted-foreground">Buyer Note</span>
                        <p className="text-sm">{selectedBrickOwlTransaction.buyer_note}</p>
                      </div>
                    )}
                    {selectedBrickOwlTransaction.seller_note && (
                      <div>
                        <span className="text-xs text-muted-foreground">Seller Note</span>
                        <p className="text-sm">{selectedBrickOwlTransaction.seller_note}</p>
                      </div>
                    )}
                    {selectedBrickOwlTransaction.public_note && (
                      <div>
                        <span className="text-xs text-muted-foreground">Public Note</span>
                        <p className="text-sm">{selectedBrickOwlTransaction.public_note}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSelectedBrickOwlTransaction(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* ============================================================================ */}
        {/* Amazon Transaction Details Sheet */}
        {/* ============================================================================ */}
        <Sheet open={!!selectedAmazonTransaction} onOpenChange={() => setSelectedAmazonTransaction(null)}>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Amazon Transaction Details</SheetTitle>
              <SheetDescription>
                View details of this Amazon financial transaction.
              </SheetDescription>
            </SheetHeader>
            {selectedAmazonTransaction && (
              <div className="mt-6 space-y-6">
                {/* Basic Info */}
                <div className="rounded-lg bg-muted p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <Badge
                      variant={
                        selectedAmazonTransaction.transaction_type === 'Shipment'
                          ? 'default'
                          : selectedAmazonTransaction.transaction_type === 'Refund'
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {AMAZON_TRANSACTION_TYPE_LABELS[selectedAmazonTransaction.transaction_type] || selectedAmazonTransaction.transaction_type}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Posted Date</span>
                    <span className="text-sm font-medium">{formatDateTime(selectedAmazonTransaction.posted_date)}</span>
                  </div>
                  {selectedAmazonTransaction.marketplace_id && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Marketplace</span>
                      <span className="text-sm font-medium">
                        {AMAZON_MARKETPLACE_LABELS[selectedAmazonTransaction.marketplace_id] || selectedAmazonTransaction.marketplace_id}
                      </span>
                    </div>
                  )}
                  {selectedAmazonTransaction.amazon_order_id && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Order ID</span>
                      <span className="text-sm font-mono">{selectedAmazonTransaction.amazon_order_id}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.transaction_status && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <span className="text-sm font-medium">{selectedAmazonTransaction.transaction_status}</span>
                    </div>
                  )}
                </div>

                {/* Item Info */}
                {(selectedAmazonTransaction.item_title || selectedAmazonTransaction.asin || selectedAmazonTransaction.seller_sku) && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <h4 className="font-medium">Item Information</h4>
                    {selectedAmazonTransaction.item_title && (
                      <div>
                        <span className="text-xs text-muted-foreground">Title</span>
                        <p className="text-sm">{selectedAmazonTransaction.item_title}</p>
                      </div>
                    )}
                    {selectedAmazonTransaction.asin && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">ASIN</span>
                        <span className="text-sm font-mono">{selectedAmazonTransaction.asin}</span>
                      </div>
                    )}
                    {selectedAmazonTransaction.seller_sku && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">SKU</span>
                        <span className="text-sm font-mono">{selectedAmazonTransaction.seller_sku}</span>
                      </div>
                    )}
                    {selectedAmazonTransaction.quantity && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Quantity</span>
                        <span className="text-sm font-medium">{selectedAmazonTransaction.quantity}</span>
                      </div>
                    )}
                    {selectedAmazonTransaction.fulfillment_channel && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Fulfillment</span>
                        <span className="text-sm font-medium">{selectedAmazonTransaction.fulfillment_channel}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Financial Breakdown */}
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-medium">Financial Breakdown</h4>
                  <div className="flex justify-between text-sm">
                    <span>Total Amount</span>
                    <span className={selectedAmazonTransaction.total_amount > 0 ? 'text-green-600 font-medium' : selectedAmazonTransaction.total_amount < 0 ? 'text-red-600 font-medium' : ''}>
                      {formatEbayAmount(selectedAmazonTransaction.total_amount, selectedAmazonTransaction.currency)}
                    </span>
                  </div>
                  {selectedAmazonTransaction.gross_sales_amount && selectedAmazonTransaction.gross_sales_amount !== 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Gross Sales</span>
                      <span>{formatEbayAmount(selectedAmazonTransaction.gross_sales_amount, selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.referral_fee && selectedAmazonTransaction.referral_fee !== 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Referral Fee</span>
                      <span className="text-orange-600">{formatEbayAmount(Math.abs(selectedAmazonTransaction.referral_fee), selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.fba_fulfillment_fee && selectedAmazonTransaction.fba_fulfillment_fee !== 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>FBA Fulfillment Fee</span>
                      <span className="text-orange-600">{formatEbayAmount(Math.abs(selectedAmazonTransaction.fba_fulfillment_fee), selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.fba_per_unit_fee && selectedAmazonTransaction.fba_per_unit_fee !== 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>FBA Per-Unit Fee</span>
                      <span className="text-orange-600">{formatEbayAmount(Math.abs(selectedAmazonTransaction.fba_per_unit_fee), selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.fba_weight_fee && selectedAmazonTransaction.fba_weight_fee !== 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>FBA Weight Fee</span>
                      <span className="text-orange-600">{formatEbayAmount(Math.abs(selectedAmazonTransaction.fba_weight_fee), selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.total_fees && selectedAmazonTransaction.total_fees !== 0 && (
                    <div className="flex justify-between text-sm font-medium pt-2 border-t">
                      <span>Total Fees</span>
                      <span className="text-orange-600">{formatEbayAmount(Math.abs(selectedAmazonTransaction.total_fees), selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                  {selectedAmazonTransaction.net_amount && selectedAmazonTransaction.net_amount !== 0 && (
                    <div className="flex justify-between text-sm font-medium pt-2 border-t">
                      <span>Net Amount</span>
                      <span className="text-green-600">{formatEbayAmount(selectedAmazonTransaction.net_amount, selectedAmazonTransaction.currency)}</span>
                    </div>
                  )}
                </div>

                {/* Description */}
                {selectedAmazonTransaction.description && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <h4 className="font-medium">Description</h4>
                    <p className="text-sm text-muted-foreground">{selectedAmazonTransaction.description}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setSelectedAmazonTransaction(null)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
