'use client';

import { useState } from 'react';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface SetLookupFormProps {
  onLookup: (setNumber: string, forceRefresh: boolean) => void;
  isLoading: boolean;
}

export function SetLookupForm({ onLookup, isLoading }: SetLookupFormProps) {
  const [setNumber, setSetNumber] = useState('');
  const [forceRefresh, setForceRefresh] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (setNumber.trim()) {
      onLookup(setNumber.trim(), forceRefresh);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <Label htmlFor="setNumber" className="sr-only">
            Set Number
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="setNumber"
              type="text"
              placeholder="Enter set number (e.g., 75192 or 75192-1)"
              value={setNumber}
              onChange={(e) => setSetNumber(e.target.value)}
              className="pl-10"
              disabled={isLoading}
            />
          </div>
        </div>
        <Button type="submit" disabled={isLoading || !setNumber.trim()}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Looking up...
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              Look Up
            </>
          )}
        </Button>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="forceRefresh"
          checked={forceRefresh}
          onCheckedChange={(checked: boolean | 'indeterminate') => setForceRefresh(checked === true)}
          disabled={isLoading}
        />
        <Label
          htmlFor="forceRefresh"
          className="text-sm text-muted-foreground cursor-pointer"
        >
          Force refresh from Brickset API (ignores cache)
        </Label>
        {forceRefresh && (
          <RefreshCw className="h-3 w-3 text-muted-foreground" />
        )}
      </div>
    </form>
  );
}
