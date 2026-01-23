'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, Copy, Check, ExternalLink } from 'lucide-react';
import { usePerfPage } from '@/hooks/use-perf';

interface TestEndpoint {
  name: string;
  description: string;
  path: string;
  method: 'GET' | 'POST';
  params: {
    name: string;
    label: string;
    placeholder: string;
    defaultValue?: string;
    required?: boolean;
  }[];
}

const TEST_ENDPOINTS: TestEndpoint[] = [
  {
    name: 'Amazon Offers',
    description: 'Get item offers from Amazon SP-API (up to 20 active offers)',
    path: '/api/test/amazon-offers',
    method: 'GET',
    params: [
      { name: 'asin', label: 'ASIN', placeholder: 'B09RGQ6BWL', required: true },
      { name: 'condition', label: 'Condition', placeholder: 'New', defaultValue: 'New' },
    ],
  },
  {
    name: 'Amazon Competitive Summary',
    description: 'Get competitive pricing summary including WasPrice and featured offer',
    path: '/api/test/amazon-competitive-summary',
    method: 'GET',
    params: [{ name: 'asin', label: 'ASIN', placeholder: 'B09RGQ6BWL', required: true }],
  },
  {
    name: 'Amazon Pricing Debug',
    description: 'Check stored Amazon pricing data for an ASIN',
    path: '/api/test/amazon-pricing-debug',
    method: 'GET',
    params: [{ name: 'asin', label: 'ASIN', placeholder: 'B09RGQ6BWL', required: true }],
  },
  {
    name: 'Arbitrage Stats',
    description: 'Get breakdown of arbitrage data distribution',
    path: '/api/test/arbitrage-stats',
    method: 'GET',
    params: [],
  },
  {
    name: 'eBay Browse',
    description: 'Test eBay Browse API access with a sample LEGO search',
    path: '/api/test/ebay-browse',
    method: 'GET',
    params: [],
  },
  {
    name: 'eBay Filter Debug',
    description: 'Understand eBay listing filter behavior for a set number',
    path: '/api/test/ebay-filter-debug',
    method: 'GET',
    params: [{ name: 'set', label: 'Set Number', placeholder: '75192-1', defaultValue: '75192-1' }],
  },
  {
    name: 'BrickLink Debug',
    description: 'Inspect raw BrickLink API response for price guide data',
    path: '/api/test/bricklink-debug',
    method: 'GET',
    params: [{ name: 'asin', label: 'ASIN', placeholder: 'B0BBSB69YX', defaultValue: 'B0BBSB69YX' }],
  },
  {
    name: 'BrickLink Sync Single',
    description: 'Sync a single ASIN\'s BrickLink pricing data',
    path: '/api/test/bricklink-sync-single',
    method: 'GET',
    params: [{ name: 'asin', label: 'ASIN', placeholder: 'B0BBSB69YX', defaultValue: 'B0BBSB69YX' }],
  },
];

function EndpointCard({ endpoint }: { endpoint: TestEndpoint }) {
  const [params, setParams] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    endpoint.params.forEach((p) => {
      initial[p.name] = p.defaultValue ?? '';
    });
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const buildUrl = () => {
    const url = new URL(endpoint.path, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  };

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const url = buildUrl();
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || `HTTP ${response.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(buildUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInNewTab = () => {
    window.open(buildUrl(), '_blank');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{endpoint.name}</CardTitle>
            <CardDescription className="text-xs mt-1">{endpoint.description}</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {endpoint.method}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Parameters */}
        {endpoint.params.length > 0 && (
          <div className="grid gap-2">
            {endpoint.params.map((param) => (
              <div key={param.name} className="flex items-center gap-2">
                <Label htmlFor={`${endpoint.path}-${param.name}`} className="w-24 text-xs">
                  {param.label}
                  {param.required && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id={`${endpoint.path}-${param.name}`}
                  value={params[param.name]}
                  onChange={(e) => setParams({ ...params, [param.name]: e.target.value })}
                  placeholder={param.placeholder}
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </div>
        )}

        {/* URL Preview */}
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-muted px-2 py-1 rounded truncate">
            {buildUrl()}
          </code>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyUrl}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleOpenInNewTab}>
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleRun} disabled={loading} size="sm" className="flex-1">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Run
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 text-destructive text-xs p-2 rounded">
            {error}
          </div>
        )}

        {/* Result */}
        {result !== null && (
          <div className="bg-muted rounded overflow-hidden">
            <pre className="text-xs p-2 overflow-auto max-h-64">
              {JSON.stringify(result, null, 2) as string}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DevTestPage() {
  usePerfPage('DevTestPage');
  return (
    <div className="container py-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dev Test Endpoints</h1>
        <p className="text-muted-foreground text-sm">
          Debug and test API endpoints. For development use only.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {TEST_ENDPOINTS.map((endpoint) => (
          <EndpointCard key={endpoint.path} endpoint={endpoint} />
        ))}
      </div>
    </div>
  );
}
