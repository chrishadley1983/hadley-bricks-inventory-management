/**
 * Shared constants for BrickLink store deal finder UI.
 */

export const EXCLUSION_REASONS = [
  { value: 'high_minimum', label: 'High minimum order' },
  { value: 'expensive_shipping', label: 'Expensive shipping' },
  { value: 'wont_ship_uk', label: "Won't ship to UK" },
  { value: 'bad_packaging', label: 'Bad packaging' },
  { value: 'unreliable', label: 'Unreliable' },
  { value: 'other', label: 'Other' },
] as const;

export const REASON_LABELS: Record<string, string> = Object.fromEntries(
  EXCLUSION_REASONS.map((r) => [r.value, r.label])
);
