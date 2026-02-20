'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import {
  Check,
  X,
  RefreshCw,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Pencil,
  Loader2,
} from 'lucide-react';
import type { MinifigSyncItem } from '@/lib/minifig-sync/types';

interface SourcedImage {
  url: string;
  source: string;
  type: string;
}

interface QualityIssue {
  passed: boolean;
  reasons: string[];
}

interface ReviewCardProps {
  item: MinifigSyncItem;
  onPublish: (id: string) => void;
  onReject: (id: string) => void;
  onRefreshPricing: (id: string) => void;
  onUpdate: (id: string, data: { title?: string; description?: string; price?: number }) => void;
  isPublishing?: boolean;
  isRejecting?: boolean;
  isRefreshing?: boolean;
  isUpdating?: boolean;
}

function getQualityCheck(item: MinifigSyncItem): QualityIssue {
  const reasons: string[] = [];
  const images = item.images as SourcedImage[] | null;

  if (!images || images.length < 2) {
    reasons.push('At least 2 images required');
  }
  if (!item.recommended_price || Number(item.recommended_price) <= 0) {
    reasons.push('Price must be greater than £0');
  }
  if (!item.name || item.name.length < 3) {
    reasons.push('Title is required');
  }
  if (!item.ebay_sku) {
    reasons.push('eBay SKU is required');
  }
  if (!item.ebay_offer_id) {
    reasons.push('eBay offer ID is required');
  }

  return { passed: reasons.length === 0, reasons };
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return `£${num.toFixed(2)}`;
}

function sanitizeHtml(html: string): string {
  // Allowlist-based sanitizer: only permit safe tags and attributes (M11)
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'b', 'i', 'u', 'em', 'strong', 'span', 'div',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr',
  ]);
  const ALLOWED_ATTRS = new Set(['href', 'class']);

  // Parse via DOMParser (safe — no script execution in parsed doc)
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode(true);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // Replace disallowed tag with its children
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(el.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned) fragment.appendChild(cleaned);
      }
      return fragment;
    }

    const cleanEl = document.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      if (ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
        // Only allow http(s) URLs in href values
        if (attr.name === 'href') {
          const trimmed = attr.value.trim().toLowerCase();
          if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) continue;
        }
        cleanEl.setAttribute(attr.name, attr.value);
      }
    }
    for (const child of Array.from(el.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) cleanEl.appendChild(cleaned);
    }
    return cleanEl;
  }

  const fragment = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) fragment.appendChild(cleaned);
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'google': return 'Google';
    case 'rebrickable': return 'Rebrickable';
    case 'bricklink': return 'BrickLink';
    case 'bricqer': return 'Bricqer';
    default: return source;
  }
}

function getSourceBadgeVariant(source: string): 'default' | 'secondary' | 'outline' {
  switch (source) {
    case 'google': return 'default';
    case 'rebrickable': return 'secondary';
    default: return 'outline';
  }
}

export function ReviewCard({
  item,
  onPublish,
  onReject,
  onRefreshPricing,
  onUpdate,
  isPublishing,
  isRejecting,
  isRefreshing,
  isUpdating,
}: ReviewCardProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [showFullDesc, setShowFullDesc] = useState(false);

  const images = (item.images as SourcedImage[] | null) ?? [];
  const quality = getQualityCheck(item);
  const isActioning = isPublishing || isRejecting || isRefreshing || isUpdating;

  const handleSaveTitle = () => {
    if (editTitle.trim()) {
      onUpdate(item.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleSaveDesc = () => {
    onUpdate(item.id, { description: editDesc });
    setIsEditingDesc(false);
  };

  const handleSavePrice = () => {
    const price = parseFloat(editPrice);
    if (!isNaN(price) && price > 0) {
      onUpdate(item.id, { price });
    }
    setIsEditingPrice(false);
  };

  const displayTitle = item.ebay_title || `LEGO ${item.name || item.bricklink_id} Minifigure - Used`;
  const displayDesc = item.ebay_description || '';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  className="h-8 text-sm font-semibold"
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleSaveTitle}>
                  <Check className="h-3.5 w-3.5 text-green-600" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setIsEditingTitle(false)}>
                  <X className="h-3.5 w-3.5 text-red-600" />
                </Button>
              </div>
            ) : (
              <div
                className="group flex items-center gap-1 cursor-pointer"
                onClick={() => { setEditTitle(displayTitle); setIsEditingTitle(true); }}
              >
                <h3 className="text-sm font-semibold leading-tight truncate">{displayTitle}</h3>
                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 shrink-0" />
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs font-mono">
                {item.bricklink_id}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {item.ebay_sku}
              </Badge>
            </div>
          </div>

          {!quality.passed && (
            <div className="shrink-0" title={quality.reasons.join('\n')}>
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-3">
        {/* Images with source labels (F41) */}
        <div className="flex gap-2 overflow-x-auto">
          {images.length > 0 ? (
            images.map((img, i) => (
              <div key={i} className="relative shrink-0">
                <div className="w-24 h-24 rounded-md overflow-hidden border bg-muted">
                  <Image
                    src={img.url}
                    alt={`${item.name} - image ${i + 1}`}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                </div>
                <Badge
                  variant={getSourceBadgeVariant(img.source)}
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] px-1 py-0"
                >
                  {getSourceLabel(img.source)}
                </Badge>
              </div>
            ))
          ) : (
            <div className="w-24 h-24 rounded-md border bg-muted flex items-center justify-center text-xs text-muted-foreground">
              No images
            </div>
          )}
        </div>

        {/* Description (F41 editable) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Description</span>
            {!isEditingDesc && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs"
                onClick={() => { setEditDesc(displayDesc); setIsEditingDesc(true); }}
              >
                <Pencil className="h-3 w-3 mr-1" /> Edit
              </Button>
            )}
          </div>
          {isEditingDesc ? (
            <div className="space-y-1">
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="text-xs min-h-[80px]"
                autoFocus
              />
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleSaveDesc}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setIsEditingDesc(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : displayDesc ? (
            <div>
              <div
                className={`text-xs text-muted-foreground ${!showFullDesc ? 'line-clamp-3' : ''}`}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayDesc) }}
              />
              {displayDesc.length > 200 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-0 text-xs mt-0.5"
                  onClick={() => setShowFullDesc(!showFullDesc)}
                >
                  {showFullDesc ? (
                    <><ChevronUp className="h-3 w-3 mr-0.5" /> Less</>
                  ) : (
                    <><ChevronDown className="h-3 w-3 mr-0.5" /> More</>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No description generated</p>
          )}
        </div>

        <Separator />

        {/* Pricing comparison (F41) */}
        <div>
          <span className="text-xs font-medium text-muted-foreground">Pricing</span>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Recommended</p>
              {isEditingPrice ? (
                <div className="flex items-center gap-0.5">
                  <span className="text-xs">£</span>
                  <Input
                    type="number"
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePrice();
                      if (e.key === 'Escape') setIsEditingPrice(false);
                    }}
                    className="h-6 w-16 text-xs text-center"
                    autoFocus
                  />
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleSavePrice}>
                    <Check className="h-3 w-3 text-green-600" />
                  </Button>
                </div>
              ) : (
                <p
                  className="text-sm font-bold text-green-600 cursor-pointer hover:underline"
                  onClick={() => {
                    setEditPrice(String(item.recommended_price ?? ''));
                    setIsEditingPrice(true);
                  }}
                >
                  {formatCurrency(item.recommended_price)}
                </p>
              )}
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Bricqer</p>
              <p className="text-sm font-medium">{formatCurrency(item.bricqer_price)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Avg Sold</p>
              <p className="text-sm font-medium">{formatCurrency(item.ebay_avg_sold_price)}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Best Offer Accept</p>
              <p className="text-xs">{formatCurrency(item.best_offer_auto_accept)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Best Offer Decline</p>
              <p className="text-xs">{formatCurrency(item.best_offer_auto_decline)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Price Range</p>
              <p className="text-xs">
                {formatCurrency(item.ebay_min_sold_price)} - {formatCurrency(item.ebay_max_sold_price)}
              </p>
            </div>
          </div>
        </div>

        {/* Market data (F41) */}
        <div className="flex gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Sold:</span>{' '}
            <span className="font-medium">{item.ebay_sold_count ?? '-'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Sell-through:</span>{' '}
            <span className="font-medium">
              {item.ebay_sell_through_rate != null
                ? `${Number(item.ebay_sell_through_rate).toFixed(0)}%`
                : '-'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Active:</span>{' '}
            <span className="font-medium">{item.ebay_active_count ?? '-'}</span>
          </div>
        </div>

        {/* Quality warnings */}
        {!quality.passed && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-2">
            <p className="text-xs font-medium text-amber-800 mb-1">Quality issues:</p>
            <ul className="text-xs text-amber-700 list-disc list-inside">
              {quality.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-2 pt-0">
        {/* Publish (F42) */}
        <Button
          size="sm"
          className="flex-1"
          disabled={isActioning || !quality.passed}
          onClick={() => onPublish(item.id)}
        >
          {isPublishing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-1" />
          )}
          Publish
        </Button>

        {/* Reject (F43) */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" className="flex-1" disabled={isActioning}>
              {isRejecting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              Reject
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this listing?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete the eBay inventory item and offer for &quot;{item.name}&quot; and reset it to NOT_LISTED.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onReject(item.id)}>
                Reject
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Refresh Pricing (F47) */}
        <Button
          size="sm"
          variant="outline"
          disabled={isActioning}
          onClick={() => onRefreshPricing(item.id)}
          title="Refresh pricing data"
        >
          {isRefreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
