'use client';

import { useState } from 'react';
import { Sparkles, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { InventoryFilters as Filters } from '@/lib/api';

interface NaturalLanguageFilterProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

interface ParsedFilter {
  filters: Partial<Filters>;
  interpretation: string;
}

async function parseNaturalLanguageFilter(query: string): Promise<ParsedFilter> {
  const response = await fetch('/api/inventory/parse-filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error('Failed to parse filter');
  }

  return response.json();
}

export function NaturalLanguageFilter({ filters, onFiltersChange }: NaturalLanguageFilterProps) {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [parsedFilters, setParsedFilters] = useState<Partial<Filters> | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await parseNaturalLanguageFilter(query.trim());

      // Store the parsed filters for display
      setParsedFilters(result.filters);

      // Merge parsed filters with existing filters
      onFiltersChange({
        ...filters,
        ...result.filters,
      });

      setInterpretation(result.interpretation);
    } catch {
      setError('Could not interpret filter. Try being more specific.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const clearNaturalLanguageFilter = () => {
    setQuery('');
    setInterpretation(null);
    setParsedFilters(null);
    setShowDetails(false);
    setError(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-purple-500" />
          <Input
            placeholder='Try: "sold items over £50 profit" or "listed on Amazon last month"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9 pr-20"
            disabled={isLoading}
          />
          {query && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-12 top-1/2 -translate-y-1/2 h-6 px-2"
              onClick={clearNaturalLanguageFilter}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
            onClick={handleSubmit}
            disabled={isLoading || !query.trim()}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Apply'
            )}
          </Button>
        </div>
      </div>

      {interpretation && (
        <Collapsible open={showDetails} onOpenChange={setShowDetails}>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary" className="bg-purple-100 text-purple-700">
              <Sparkles className="h-3 w-3 mr-1" />
              AI Filter
            </Badge>
            <span className="text-muted-foreground">{interpretation}</span>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-muted-foreground hover:text-foreground"
              >
                {showDetails ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                <span className="ml-1 text-xs">Details</span>
              </Button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1"
              onClick={clearNaturalLanguageFilter}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <CollapsibleContent>
            {parsedFilters && (
              <div className="mt-2 p-2 bg-muted/50 rounded-md text-xs font-mono">
                <div className="text-muted-foreground mb-1">Generated filters:</div>
                <pre className="whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(parsedFilters, null, 2)}
                </pre>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
