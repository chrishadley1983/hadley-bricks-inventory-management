'use client';

import { ExternalLink } from 'lucide-react';
import { formatPrice } from '@/lib/listing-assistant/ebay-finding.service';
import type { EbaySoldItem } from '@/lib/listing-assistant/types';

interface EbaySoldItemsDisplayProps {
  items: EbaySoldItem[];
}

export function EbaySoldItemsDisplay({ items }: EbaySoldItemsDisplayProps) {
  if (!items || items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No recent sold items found.
      </p>
    );
  }

  return (
    <div className="space-y-2 py-2">
      {items.slice(0, 5).map((item, index) => (
        <div
          key={item.itemId || index}
          className="flex items-center justify-between rounded-md border p-2 text-sm"
        >
          <div className="flex-1 min-w-0 mr-2">
            <p className="truncate font-medium">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {item.condition} &middot; Sold {item.soldDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-green-600">
              {formatPrice(item.soldPrice, item.currency)}
            </span>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
