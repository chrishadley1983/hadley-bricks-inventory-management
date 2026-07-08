'use client';

import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Small "ⓘ" rollover — the deeper, plain-English explanation for a stat tile or
 * section header. Deliberately its own `'use client'` island (radix Tooltip needs
 * a client boundary) rather than putting `'use client'` on the server-rendered
 * section components themselves, so HealthCards/QueueFreshness/etc. can stay
 * server components reading straight off Supabase.
 *
 * Doesn't replace the existing sub-label text under each tile — this is the
 * *extra* explanation, shown on hover/focus only.
 */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              className
            )}
            aria-label="More info"
            onClick={(e) => e.preventDefault()}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs font-normal leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
