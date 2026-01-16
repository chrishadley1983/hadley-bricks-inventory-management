'use client';

import * as React from 'react';
import { Search, Loader2 } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

interface BricksetSet {
  setNumber: string;
  setName: string;
  theme: string;
  subtheme?: string;
  yearFrom: number;
  pieces?: number;
  imageUrl?: string;
  ean?: string;
  upc?: string;
}

interface SetNumberLookupProps {
  value: string;
  onChange: (value: string) => void;
  onSetSelected: (set: BricksetSet) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Set Number lookup component with autocomplete from Brickset cache
 * Searches as user types and allows selection to populate set details
 */
export function SetNumberLookup({
  value,
  onChange,
  onSetSelected,
  disabled = false,
  placeholder = 'e.g., 75192',
  className,
}: SetNumberLookupProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isSearching, setIsSearching] = React.useState(false);
  const [isLiveSearching, setIsLiveSearching] = React.useState(false);
  const [results, setResults] = React.useState<BricksetSet[]>([]);
  const [searchedQuery, setSearchedQuery] = React.useState('');
  const [noLocalResults, setNoLocalResults] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Debounced search function for cache-only search
  const debouncedSearch = useDebouncedCallback(async (query: string) => {
    if (query.length < 2) {
      setResults([]);
      setNoLocalResults(false);
      return;
    }

    setIsSearching(true);
    setSearchedQuery(query);

    try {
      const response = await fetch(
        `/api/brickset/search?query=${encodeURIComponent(query)}&limit=10&useApi=false`
      );
      const data = await response.json();

      if (response.ok) {
        setResults(data.data || []);
        setNoLocalResults((data.data || []).length === 0);
      } else {
        setResults([]);
        setNoLocalResults(true);
      }
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
      setNoLocalResults(true);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  // Handle input change
  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      setIsOpen(true);
      debouncedSearch(newValue);
    },
    [onChange, debouncedSearch]
  );

  // Handle set selection
  const handleSelect = React.useCallback(
    (set: BricksetSet) => {
      onChange(set.setNumber);
      onSetSelected(set);
      setIsOpen(false);
      setResults([]);
    },
    [onChange, onSetSelected]
  );

  // Handle live search (calls Brickset API)
  const handleLiveSearch = React.useCallback(async () => {
    if (!value || value.length < 2) return;

    setIsLiveSearching(true);

    try {
      const response = await fetch(
        `/api/brickset/search?query=${encodeURIComponent(value)}&limit=10&useApi=true`
      );
      const data = await response.json();

      if (response.ok && data.data?.length > 0) {
        setResults(data.data);
        setNoLocalResults(false);
      } else {
        setNoLocalResults(true);
      }
    } catch (error) {
      console.error('Live search error:', error);
    } finally {
      setIsLiveSearching(false);
    }
  }, [value]);

  // Close popover when clicking outside
  const handleOpenChange = React.useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setNoLocalResults(false);
    }
  }, []);

  return (
    <Popover open={isOpen && value.length >= 2} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div className={cn('relative', className)}>
          <Input
            ref={inputRef}
            value={value}
            onChange={handleInputChange}
            onFocus={() => value.length >= 2 && setIsOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            className="pr-8"
          />
          {isSearching && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0"
        align="start"
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
      >
        <ScrollArea className="max-h-[300px]">
          {results.length > 0 ? (
            <div className="p-1">
              {results.map((set) => (
                <button
                  key={set.setNumber}
                  type="button"
                  onClick={() => handleSelect(set)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md hover:bg-accent cursor-pointer',
                    'focus:bg-accent focus:outline-none flex gap-3'
                  )}
                >
                  {set.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={set.imageUrl}
                      alt={set.setName}
                      className="w-12 h-12 object-contain flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {set.setNumber} - {set.setName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {set.theme}
                      {set.subtheme && ` / ${set.subtheme}`}
                      {' \u2022 '}
                      {set.yearFrom}
                      {set.pieces && ` \u2022 ${set.pieces} pieces`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : noLocalResults ? (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No sets found in cache for &quot;{searchedQuery}&quot;
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLiveSearch}
                disabled={isLiveSearching}
              >
                {isLiveSearching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Searching Brickset...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Search Brickset API
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {isSearching ? 'Searching...' : 'Type to search sets'}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
