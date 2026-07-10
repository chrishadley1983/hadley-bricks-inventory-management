import { blColour } from '@/lib/bricklink/bl-colours';

/**
 * Real BrickLink colour swatch + name, replacing the bare "#11" numeric-id cell.
 * Pure/presentational — no hooks, so it renders fine from both server components
 * (TupleDetail) and client components (ScreenTable) without its own 'use client'.
 * The numeric id stays available via the native `title` tooltip and a small
 * secondary "#id" label, never the primary label.
 */
export function ColourSwatch({ colourId, className }: { colourId: number; className?: string }) {
  const { name, hex } = blColour(colourId);
  const isNA = colourId <= 0 || hex === 'transparent';

  if (isNA) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ''}`}
        title="No specific colour (set/minifig-level tuple, or colour id 0)"
      >
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-[8px] leading-none">
          –
        </span>
        N/A
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`} title={`BrickLink colour #${colourId}`}>
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/15 dark:border-white/25"
        style={{ backgroundColor: hex }}
      />
      <span className="text-xs">{name}</span>
      <span className="text-[10px] text-muted-foreground">#{colourId}</span>
    </span>
  );
}
