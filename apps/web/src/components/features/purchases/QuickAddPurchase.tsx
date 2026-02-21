'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, AlertCircle, Check, Edit } from 'lucide-react';
import { useParsePurchase, useCreatePurchase } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrency } from '@/lib/utils';
import type { ParsedPurchase } from '@/lib/api';

interface QuickAddPurchaseProps {
  onSuccess?: () => void;
}

export function QuickAddPurchase({ onSuccess }: QuickAddPurchaseProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [parsedResult, setParsedResult] = useState<ParsedPurchase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parseMutation = useParsePurchase();
  const createMutation = useCreatePurchase();

  const handleParse = async () => {
    if (!input.trim()) return;

    setError(null);
    setParsedResult(null);

    try {
      const result = await parseMutation.mutateAsync(input);
      setParsedResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse purchase');
    }
  };

  const handleSave = async () => {
    if (!parsedResult) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const purchase = await createMutation.mutateAsync({
        purchase_date: parsedResult.purchase_date || today,
        short_description: parsedResult.short_description,
        cost: parsedResult.cost,
        source: parsedResult.source || null,
        payment_method: parsedResult.payment_method || null,
        description: parsedResult.description || null,
      });

      if (onSuccess) {
        onSuccess();
      }

      // Navigate to purchase detail or inventory creation
      if (parsedResult.set_numbers && parsedResult.set_numbers.length > 0) {
        router.push(`/inventory/new?purchaseId=${purchase.id}`);
      } else {
        router.push(`/purchases/${purchase.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save purchase');
    }
  };

  const handleEditManually = () => {
    // Pass parsed data as query params to the manual form
    if (parsedResult) {
      const params = new URLSearchParams({
        description: parsedResult.short_description,
        cost: String(parsedResult.cost),
        ...(parsedResult.source && { source: parsedResult.source }),
        ...(parsedResult.payment_method && { payment: parsedResult.payment_method }),
      });
      router.push(`/purchases/new?${params.toString()}`);
    } else {
      router.push('/purchases/new');
    }
  };

  const handleClear = () => {
    setInput('');
    setParsedResult(null);
    setError(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Quick Add Purchase
        </CardTitle>
        <CardDescription>
          Describe your purchase in natural language and let AI extract the details
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            placeholder='e.g., "Bought 3 sets from John in Leeds for £150 cash - 75192, 10294, 42143" or "eBay order £45.99 for sealed 31120"'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-h-[100px]"
            disabled={parseMutation.isPending}
          />
          <div className="flex gap-2">
            <Button onClick={handleParse} disabled={!input.trim() || parseMutation.isPending}>
              {parseMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Parsing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Parse with AI
                </>
              )}
            </Button>
            {(parsedResult || error) && (
              <Button variant="outline" onClick={handleClear}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {parsedResult && (
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Parsed Result</h4>
              <Badge variant={parsedResult.confidence > 0.7 ? 'default' : 'secondary'}>
                {Math.round(parsedResult.confidence * 100)}% confidence
              </Badge>
            </div>

            <div className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Description</span>
                <span className="font-medium">{parsedResult.short_description}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium">{formatCurrency(parsedResult.cost)}</span>
              </div>
              {parsedResult.source && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <Badge variant="outline">{parsedResult.source}</Badge>
                </div>
              )}
              {parsedResult.payment_method && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment</span>
                  <span>{parsedResult.payment_method}</span>
                </div>
              )}
              {parsedResult.purchase_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span>{parsedResult.purchase_date}</span>
                </div>
              )}
              {parsedResult.set_numbers && parsedResult.set_numbers.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Set Numbers</span>
                  <div className="flex flex-wrap gap-1">
                    {parsedResult.set_numbers.map((num) => (
                      <Badge key={num} variant="secondary">
                        {num}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Save Purchase
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleEditManually}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Manually
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
