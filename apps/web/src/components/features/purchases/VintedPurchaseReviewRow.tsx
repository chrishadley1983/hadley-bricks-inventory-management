'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle2, HelpCircle, Calendar } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { VintedPurchaseExtracted } from '@/lib/ai/prompts/parse-vinted-screenshot';
import type { MonzoMatchResult } from '@/app/api/purchases/match-monzo/route';
import type { DuplicateCheckResult } from '@/app/api/purchases/check-duplicates/route';

export interface VintedPurchaseReviewData extends VintedPurchaseExtracted {
  index: number;
  selected: boolean;
  purchaseDate: string; // Editable date (YYYY-MM-DD format)
  monzoMatch?: MonzoMatchResult;
  duplicateCheck?: DuplicateCheckResult;
}

interface VintedPurchaseReviewRowProps {
  purchase: VintedPurchaseReviewData;
  onSelectionChange: (index: number, selected: boolean) => void;
  onDateChange: (index: number, date: string) => void;
}

/**
 * Row component for the purchase review step
 */
export function VintedPurchaseReviewRow({
  purchase,
  onSelectionChange,
  onDateChange,
}: VintedPurchaseReviewRowProps) {
  const {
    index,
    title,
    price,
    status,
    setNumber,
    confidence,
    selected,
    purchaseDate,
    monzoMatch,
    duplicateCheck,
  } = purchase;

  const hasDuplicateWarning =
    duplicateCheck?.duplicateType === 'exact' ||
    duplicateCheck?.duplicateType === 'likely' ||
    duplicateCheck?.duplicateType === 'possible';

  const isExactDuplicate = duplicateCheck?.duplicateType === 'exact';
  const hasMonzoMatch = monzoMatch?.matchConfidence === 'exact';

  return (
    <div
      className={`border rounded-lg p-4 ${
        isExactDuplicate
          ? 'border-destructive/50 bg-destructive/5'
          : selected
            ? 'border-primary/50 bg-primary/5'
            : 'border-border'
      }`}
    >
      <div className="flex items-start gap-4">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked: boolean) => onSelectionChange(index, checked)}
          disabled={isExactDuplicate}
          className="mt-1"
        />

        {/* Main content - horizontal layout */}
        <div className="flex-1 grid grid-cols-[1fr_auto_auto] gap-4 items-start">
          {/* Title and metadata */}
          <div className="min-w-0">
            <h4 className="font-medium">{title}</h4>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {status}
              </Badge>
              {setNumber && (
                <Badge variant="outline" className="text-xs">
                  Set: {setNumber}
                </Badge>
              )}
              {confidence < 0.8 && (
                <span className="flex items-center gap-1 text-xs text-yellow-600">
                  <HelpCircle className="h-3 w-3" />
                  Low confidence
                </span>
              )}
            </div>
            {/* Duplicate warning */}
            {hasDuplicateWarning && (
              <div className="mt-2 flex items-start gap-2 text-sm">
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 ${
                    isExactDuplicate ? 'text-destructive' : 'text-yellow-600'
                  }`}
                />
                <span className={isExactDuplicate ? 'text-destructive' : 'text-yellow-700'}>
                  {duplicateCheck?.reason}
                  {isExactDuplicate && ' - Cannot import duplicate.'}
                </span>
              </div>
            )}
          </div>

          {/* Date input */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Purchase Date
              {hasMonzoMatch && <CheckCircle2 className="h-3 w-3 text-green-600 ml-1" />}
            </Label>
            <Input
              type="date"
              value={purchaseDate}
              onChange={(e) => onDateChange(index, e.target.value)}
              disabled={isExactDuplicate}
              className="w-[140px] h-8 text-sm"
            />
            {hasMonzoMatch && <p className="text-xs text-green-600">Matched from Monzo</p>}
            {!hasMonzoMatch && <p className="text-xs text-muted-foreground">No Monzo match</p>}
          </div>

          {/* Price */}
          <div className="text-right">
            <span className="font-semibold text-primary text-lg">{formatCurrency(price)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
