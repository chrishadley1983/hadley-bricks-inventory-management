'use client';

import { Eye, Heart, ShoppingCart, Package, Calendar, Tag, TrendingUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import type { EligibleListing } from '@/lib/ebay/listing-refresh.types';

interface EngagementPopoverProps {
  listing: EligibleListing;
  children: React.ReactNode;
}

/**
 * Calculate engagement score based on watchers, views, sold, and age
 * Score helps prioritize which listings are worth refreshing
 */
function calculateEngagementScore(listing: EligibleListing): {
  score: number;
  level: 'high' | 'medium' | 'low';
} {
  // Formula: (watchers × 10) + (views × 0.5) + (sold × 20) - (age × 0.1)
  const watcherScore = listing.watchers * 10;
  const viewScore = (listing.views ?? 0) * 0.5;
  const soldScore = listing.quantitySold * 20;
  const agePenalty = listing.listingAge * 0.1;

  const score = Math.max(0, watcherScore + viewScore + soldScore - agePenalty);

  // Determine level
  let level: 'high' | 'medium' | 'low';
  if (score >= 50) {
    level = 'high';
  } else if (score >= 20) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { score: Math.round(score), level };
}

/**
 * Get badge color based on engagement level
 */
function getEngagementBadgeVariant(level: 'high' | 'medium' | 'low') {
  switch (level) {
    case 'high':
      return 'default'; // green-ish
    case 'medium':
      return 'secondary'; // amber-ish
    case 'low':
      return 'outline'; // muted
  }
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(amount);
}

/**
 * Format date for display
 */
function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

/**
 * Popover showing detailed engagement stats for a listing
 */
export function EngagementPopover({ listing, children }: EngagementPopoverProps) {
  const { score, level } = calculateEngagementScore(listing);
  const totalValue = listing.price * listing.quantityAvailable;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-3">
          {/* Header with Score */}
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Engagement Details</h4>
            <Badge variant={getEngagementBadgeVariant(level)} className="text-xs">
              <TrendingUp className="h-3 w-3 mr-1" />
              Score: {score}
            </Badge>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            {/* Watchers */}
            <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
              <Heart className="h-4 w-4 text-red-400" />
              <div>
                <p className="font-medium">{listing.watchers}</p>
                <p className="text-xs text-muted-foreground">Watchers</p>
              </div>
            </div>

            {/* Views */}
            <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
              <Eye className="h-4 w-4 text-blue-400" />
              <div>
                <p className="font-medium">{listing.views ?? '--'}</p>
                <p className="text-xs text-muted-foreground">Views</p>
              </div>
            </div>

            {/* Sold */}
            <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
              <ShoppingCart className="h-4 w-4 text-green-400" />
              <div>
                <p className="font-medium">{listing.quantitySold}</p>
                <p className="text-xs text-muted-foreground">Sold</p>
              </div>
            </div>

            {/* Available */}
            <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
              <Package className="h-4 w-4 text-purple-400" />
              <div>
                <p className="font-medium">{listing.quantityAvailable}</p>
                <p className="text-xs text-muted-foreground">Available</p>
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="space-y-1 text-sm border-t pt-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" /> Total Value
              </span>
              <span className="font-medium">{formatCurrency(totalValue, listing.currency)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Listed
              </span>
              <span>{formatDate(listing.listingStartDate)}</span>
            </div>
            {listing.condition && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Condition</span>
                <Badge variant="outline" className="text-xs">
                  {listing.condition}
                </Badge>
              </div>
            )}
            {listing.bestOfferEnabled && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Best Offer</span>
                <Badge variant="secondary" className="text-xs">
                  Enabled
                </Badge>
              </div>
            )}
          </div>

          {/* Score Explanation */}
          <div className="text-xs text-muted-foreground border-t pt-2">
            <p>
              {level === 'high' && 'High engagement - good candidate for refresh'}
              {level === 'medium' && 'Moderate engagement - may benefit from refresh'}
              {level === 'low' && 'Low engagement - consider repricing instead'}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compact engagement display for table cells
 */
export function EngagementBadge({ listing }: { listing: EligibleListing }) {
  const { score, level } = calculateEngagementScore(listing);

  return (
    <EngagementPopover listing={listing}>
      <button className="flex items-center gap-2 hover:bg-muted/50 rounded px-2 py-1 transition-colors cursor-pointer">
        {/* Watchers - always show */}
        <div className="flex items-center gap-1">
          <Heart
            className={`h-4 w-4 ${listing.watchers > 0 ? 'text-red-400 fill-red-400' : 'text-muted-foreground'}`}
          />
          <span className="text-sm tabular-nums">{listing.watchers}</span>
        </div>

        {/* Views - show if available */}
        {listing.views !== null && (
          <div className="flex items-center gap-1">
            <Eye className="h-4 w-4 text-blue-400" />
            <span className="text-sm tabular-nums">{listing.views}</span>
          </div>
        )}

        {/* Sold - show if > 0 */}
        {listing.quantitySold > 0 && (
          <div className="flex items-center gap-1">
            <ShoppingCart className="h-4 w-4 text-green-400" />
            <span className="text-sm tabular-nums">{listing.quantitySold}</span>
          </div>
        )}

        {/* Score Badge */}
        <Badge variant={getEngagementBadgeVariant(level)} className="text-xs ml-1 h-5">
          {score}
        </Badge>
      </button>
    </EngagementPopover>
  );
}
