'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import type { ReviewQueueItem } from '@/lib/api/review-queue';

export const REVIEW_COLUMN_DISPLAY_NAMES: Record<string, string> = {
  source: 'Source',
  item_name: 'Item Name',
  cost: 'Cost',
  seller_username: 'Seller',
  email_date: 'Email Date',
  email_subject: 'Subject',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '-';
  return `\u00a3${Number(amount).toFixed(2)}`;
}

export function getReviewQueueColumns(): ColumnDef<ReviewQueueItem>[] {
  return [
    {
      accessorKey: 'source',
      header: 'Source',
      cell: ({ row }) => {
        const source = row.getValue('source') as string;
        return <Badge variant={source === 'Vinted' ? 'default' : 'secondary'}>{source}</Badge>;
      },
      size: 80,
    },
    {
      accessorKey: 'item_name',
      header: 'Item Name',
      cell: ({ row }) => {
        const name = row.getValue('item_name') as string | null;
        const emailId = row.original.email_id;
        return (
          <div className="max-w-[300px]">
            <span className="line-clamp-2 text-sm">{name || 'Unknown item'}</span>
            {emailId && (
              <a
                href={`https://mail.google.com/mail/u/0/#all/${emailId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:underline"
              >
                View email
              </a>
            )}
          </div>
        );
      },
      size: 300,
    },
    {
      accessorKey: 'cost',
      header: 'Cost',
      cell: ({ row }) => formatCurrency(row.getValue('cost')),
      size: 80,
    },
    {
      accessorKey: 'seller_username',
      header: 'Seller',
      cell: ({ row }) => (
        <span className="text-sm">{(row.getValue('seller_username') as string) || '-'}</span>
      ),
      size: 120,
    },
    {
      accessorKey: 'email_date',
      header: 'Email Date',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.getValue('email_date'))}
        </span>
      ),
      size: 110,
    },
  ];
}
