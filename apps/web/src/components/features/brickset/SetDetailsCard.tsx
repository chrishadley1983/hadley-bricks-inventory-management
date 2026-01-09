'use client';

import Image from 'next/image';
import type { BricksetSet } from '@/lib/brickset';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SetDetailsCardProps {
  set: BricksetSet;
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '-';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(price);
}

function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function SetDetailsCard({ set }: SetDetailsCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-6">
          {/* Set Image */}
          <div className="relative h-48 w-48 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
            {set.imageUrl ? (
              <Image
                src={set.imageUrl}
                alt={set.setName}
                fill
                sizes="192px"
                className="object-contain"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-400">
                No Image
              </div>
            )}
          </div>

          {/* Basic Info */}
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl">{set.setName}</CardTitle>
                <CardDescription className="text-lg mt-1">
                  {set.setNumber}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {set.released && (
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    Released
                  </Badge>
                )}
                {set.availability && (
                  <Badge variant="outline">{set.availability}</Badge>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Theme:</span>{' '}
                <span className="font-medium">{set.theme || '-'}</span>
                {set.subtheme && (
                  <span className="text-muted-foreground"> / {set.subtheme}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Year:</span>{' '}
                <span className="font-medium">{set.yearFrom || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Pieces:</span>{' '}
                <span className="font-medium">{set.pieces?.toLocaleString() || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Minifigs:</span>{' '}
                <span className="font-medium">{set.minifigs || '-'}</span>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Retail Prices */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Retail Prices</h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">UK</div>
              <div className="text-lg font-semibold">
                {formatPrice(set.ukRetailPrice, 'GBP')}
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">US</div>
              <div className="text-lg font-semibold">
                {formatPrice(set.usRetailPrice, 'USD')}
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">CA</div>
              <div className="text-lg font-semibold">
                {formatPrice(set.caRetailPrice, 'CAD')}
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">DE</div>
              <div className="text-lg font-semibold">
                {formatPrice(set.deRetailPrice, 'EUR')}
              </div>
            </div>
          </div>
        </div>

        {/* BrickLink Prices */}
        {(set.bricklinkSoldPriceNew || set.bricklinkSoldPriceUsed) && (
          <div>
            <h3 className="text-sm font-semibold mb-3">BrickLink Price Guide</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-blue-50 p-3">
                <div className="text-xs text-blue-600">Sold (New)</div>
                <div className="text-lg font-semibold text-blue-700">
                  {formatPrice(set.bricklinkSoldPriceNew, 'GBP')}
                </div>
              </div>
              <div className="rounded-lg bg-orange-50 p-3">
                <div className="text-xs text-orange-600">Sold (Used)</div>
                <div className="text-lg font-semibold text-orange-700">
                  {formatPrice(set.bricklinkSoldPriceUsed, 'GBP')}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Physical Specs */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold mb-3">Dimensions</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Width:</span>
                <span>{set.width ? `${set.width} cm` : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Height:</span>
                <span>{set.height ? `${set.height} cm` : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Depth:</span>
                <span>{set.depth ? `${set.depth} cm` : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Weight:</span>
                <span>{set.weight ? `${set.weight} g` : '-'}</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3">Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Age Range:</span>
                <span>
                  {set.ageMin && set.ageMax
                    ? `${set.ageMin}-${set.ageMax}+`
                    : set.ageMin
                      ? `${set.ageMin}+`
                      : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Packaging:</span>
                <span>{set.packagingType || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Instructions:</span>
                <span>{set.instructionsCount || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Images:</span>
                <span>{set.additionalImageCount || '-'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Item Numbers & Barcodes */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Item Numbers & Barcodes</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">US Item #:</span>
              <span className="font-mono">{set.usItemNumber || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">EU Item #:</span>
              <span className="font-mono">{set.euItemNumber || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">EAN:</span>
              <span className="font-mono">{set.ean || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">UPC:</span>
              <span className="font-mono">{set.upc || '-'}</span>
            </div>
          </div>
        </div>

        {/* Community Stats */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Community Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="rounded-lg bg-muted p-3 text-center">
              <div className="text-2xl font-bold">{set.rating || '-'}</div>
              <div className="text-xs text-muted-foreground">Rating</div>
            </div>
            <div className="rounded-lg bg-muted p-3 text-center">
              <div className="text-2xl font-bold">
                {set.ownCount?.toLocaleString() || '-'}
              </div>
              <div className="text-xs text-muted-foreground">Own It</div>
            </div>
            <div className="rounded-lg bg-muted p-3 text-center">
              <div className="text-2xl font-bold">
                {set.wantCount?.toLocaleString() || '-'}
              </div>
              <div className="text-xs text-muted-foreground">Want It</div>
            </div>
          </div>
        </div>

        {/* Availability Dates */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Availability</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Launch Date:</span>
              <span>{formatDate(set.launchDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Exit Date:</span>
              <span>{formatDate(set.exitDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">US Date Added:</span>
              <span>{formatDate(set.usDateAdded)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">US Date Removed:</span>
              <span>{formatDate(set.usDateRemoved)}</span>
            </div>
          </div>
        </div>

        {/* Designers */}
        {set.designers && set.designers.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Designers</h3>
            <div className="flex flex-wrap gap-2">
              {set.designers.map((designer) => (
                <Badge key={designer} variant="secondary">
                  {designer}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Cache Info */}
        <div className="pt-4 border-t text-xs text-muted-foreground">
          Last updated: {formatDate(set.lastFetchedAt)}
        </div>
      </CardContent>
    </Card>
  );
}
