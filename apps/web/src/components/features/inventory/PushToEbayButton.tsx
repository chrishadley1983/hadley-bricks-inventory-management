'use client';

import { useRouter } from 'next/navigation';
import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PushToEbayButtonProps {
  item: {
    id: string;
    listing_platform?: string | null;
    status?: string | null;
  };
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Button to push an inventory item to the Listing Assistant
 *
 * Only shows for items where:
 * - listing_platform is 'ebay'
 * - status is 'Backlog'
 */
export function PushToEbayButton({
  item,
  variant = 'outline',
  size = 'sm',
}: PushToEbayButtonProps) {
  const router = useRouter();

  // Only show for eBay backlog items
  const isEbayBacklog =
    item.listing_platform?.toLowerCase() === 'ebay' && item.status?.toLowerCase() === 'backlog';

  if (!isEbayBacklog) {
    return null;
  }

  const handleClick = () => {
    router.push(`/listing-assistant?inventoryId=${item.id}`);
  };

  return (
    <Button variant={variant} size={size} onClick={handleClick}>
      <PenLine className="mr-2 h-4 w-4" />
      Create Listing
    </Button>
  );
}
