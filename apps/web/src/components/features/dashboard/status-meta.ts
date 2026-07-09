/**
 * Canonical inventory-status display metadata for dashboard widgets.
 *
 * Every widget renders statuses from the API response THROUGH this map, with
 * unknown keys folded into OTHER — so a rogue status value can never again be
 * silently dropped from rows while still being counted in totals (the
 * 'Not Yet Received' mixed-case bug, fixed 2026-07-09).
 *
 * Hexes are a CVD-validated categorical set (dataviz six-checks, light surface).
 */

export interface StatusMeta {
  key: string;
  label: string;
  /** Chart mark colour (validated palette) */
  hex: string;
  /** Tailwind text class for the label/dot */
  textClass: string;
  /** True when the API hides listing value for this bucket (unvalued backlog) */
  hideValue?: boolean;
}

/** Display order = pipeline order. Keys match InventoryService.getSummary valueByStatus. */
export const STATUS_META: StatusMeta[] = [
  {
    key: 'NOT YET RECEIVED',
    label: 'Not Received',
    hex: '#b45309',
    textClass: 'text-amber-700',
  },
  {
    key: 'BACKLOG_VALUED',
    label: 'Backlog · valued',
    hex: '#2563eb',
    textClass: 'text-blue-600',
  },
  {
    key: 'BACKLOG_UNVALUED',
    label: 'Backlog · unvalued',
    hex: '#93c5fd',
    textClass: 'text-blue-400',
    hideValue: true,
  },
  {
    key: 'LISTED',
    label: 'Listed',
    hex: '#0d9488',
    textClass: 'text-teal-600',
  },
  {
    key: 'SOLD',
    label: 'Sold',
    hex: '#7c3aed',
    textClass: 'text-violet-600',
  },
  {
    key: 'RETURNED',
    label: 'Returned',
    hex: '#e11d48',
    textClass: 'text-rose-600',
  },
];

/** Catch-all for any status key the map doesn't know. */
export const OTHER_META: StatusMeta = {
  key: 'OTHER',
  label: 'Other',
  hex: '#64748b',
  textClass: 'text-slate-500',
};

/** Count-by-status keys (byStatus uses raw statuses, without the valued/unvalued split). */
export const COUNT_STATUS_META: StatusMeta[] = [
  STATUS_META[0],
  { key: 'BACKLOG', label: 'Backlog', hex: '#2563eb', textClass: 'text-blue-600' },
  ...STATUS_META.filter(
    (m) => !['NOT YET RECEIVED', 'BACKLOG_VALUED', 'BACKLOG_UNVALUED'].includes(m.key)
  ),
];
