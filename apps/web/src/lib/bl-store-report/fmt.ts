/** bl-store-report — the ONE formatter set every renderer shares. */

export const gbp = (n: number | null | undefined, dp = 2): string =>
  n == null ? '—' : `£${n.toFixed(dp)}`;

export const pct = (n: number | null | undefined, dp = 0): string =>
  n == null ? '—' : `${(n * 100).toFixed(dp)}%`;

export const num = (n: number | null | undefined, dp = 2): string =>
  n == null ? '—' : n.toFixed(dp);

export const padL = (s: string | number, w: number): string => String(s).padStart(w);
export const padR = (s: string | number, w: number): string => String(s).padEnd(w);

/** Benchmark with provenance marker: † = worldwide fallback (+11% UK calibration). */
export const benchMark = (provenance: 'uk' | 'world' | 'none'): string =>
  provenance === 'world' ? '†' : provenance === 'none' ? '?' : '';

export const OVERLAP_SHORT: Record<string, string> = {
  NEW: 'NEW', RESTOCK_OUT: 'R-OUT', RESTOCK_THIN: 'R-THIN', DUPLICATE: 'DUP',
};

export const ts = (iso: string): string => iso.slice(0, 16).replace('T', ' ');
