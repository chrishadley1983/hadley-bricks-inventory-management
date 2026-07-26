'use client';

/**
 * Shared sorting affordance for the assessment's tables.
 *
 * Extracted from LotTable when the sets table needed the same behaviour: one header
 * component and one comparator, so "click a column to sort" means the same thing and
 * looks the same everywhere on the screen.
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/** A sortable column: how it reads, how it orders, how it renders. */
export interface SortCol<T> {
  key: string;
  label: string;
  title?: string;
  align: 'l' | 'r';
  /** Sort value; omitted for columns that carry no order (item cells, flags). */
  sort?: (row: T) => number | null;
  /** Direction applied when this column is first clicked. */
  desc?: boolean;
  cell: (row: T) => React.ReactNode;
  hideOnMobile?: boolean;
}

/**
 * Sort state + the sorted rows.
 *
 * Nulls always sink, in both directions. A lot with no STR is not the best-selling lot in
 * the store, and it is not the worst either — it is unmeasured, and either extreme would
 * be a claim the data does not support.
 */
export function useTableSort<T>(
  rows: T[],
  cols: Record<string, SortCol<T>>,
  initialKey: string,
  initialDesc: boolean
) {
  const [sortKey, setSortKey] = useState(initialKey);
  const [desc, setDesc] = useState(initialDesc);

  const sorted = useMemo(() => {
    const col = cols[sortKey];
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sort!(a);
      const bv = col.sort!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return desc ? bv - av : av - bv;
    });
  }, [rows, cols, sortKey, desc]);

  const toggle = (col: SortCol<T>) => {
    if (!col.sort) return;
    if (col.key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(col.key);
      setDesc(col.desc ?? true);
    }
  };

  return { sorted, sortKey, desc, toggle };
}

export function thClass(align: 'l' | 'r', hideOnMobile?: boolean) {
  return [
    'py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground',
    align === 'r' ? 'text-right' : 'text-left',
    hideOnMobile ? 'hidden md:table-cell' : '',
  ].join(' ');
}

/**
 * Sortable header. The active column shows a solid arrow and is emphasised, everything
 * else stays muted — the same affordance the part-out table uses, and the same reason:
 * a table that always renders one neutral glyph never says what it is ordered by.
 */
export function SortHeader<T>({
  col,
  active,
  desc,
  onClick,
}: {
  col: SortCol<T>;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'font-semibold text-foreground' : ''}`}
    >
      {col.label}
      <Icon className={`h-3 w-3 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
    </button>
  );
}

/** The `<thead>` row every sortable table on this screen renders. */
export function SortableHead<T>({
  cols,
  firstLabel,
  sortKey,
  desc,
  toggle,
}: {
  cols: SortCol<T>[];
  firstLabel: string;
  sortKey: string;
  desc: boolean;
  toggle: (col: SortCol<T>) => void;
}) {
  return (
    <thead>
      <tr className="border-b border-border">
        <th className={`${thClass('l')} sticky left-0 z-10 bg-background`}>{firstLabel}</th>
        {cols.map((c) => (
          <th
            key={c.key}
            className={`${thClass(c.align, c.hideOnMobile)} pl-3`}
            title={c.title}
            // aria-sort belongs on the column header, not the button inside it —
            // screen readers announce it as a property of the column.
            aria-sort={
              c.sort && sortKey === c.key ? (desc ? 'descending' : 'ascending') : undefined
            }
          >
            {c.sort ? (
              <SortHeader
                col={c}
                active={sortKey === c.key}
                desc={desc}
                onClick={() => toggle(c)}
              />
            ) : (
              c.label
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}
