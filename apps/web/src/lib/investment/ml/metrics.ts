/**
 * Pure evaluation metrics for the investment models.
 */

/** Mean absolute error. NaN on empty/mismatched input. */
export function meanAbsoluteError(actual: number[], predicted: number[]): number {
  if (actual.length === 0 || predicted.length !== actual.length) return Number.NaN;
  const sum = actual.reduce((acc, a, i) => acc + Math.abs(a - predicted[i]), 0);
  return Math.round((sum / actual.length) * 100) / 100;
}

/** Coefficient of determination. 0 on degenerate input. */
export function rSquared(actual: number[], predicted: number[]): number {
  if (actual.length === 0 || predicted.length !== actual.length) return 0;
  const mean = actual.reduce((sum, v) => sum + v, 0) / actual.length;
  const ssRes = actual.reduce((sum, a, i) => sum + (a - predicted[i]) ** 2, 0);
  const ssTot = actual.reduce((sum, a) => sum + (a - mean) ** 2, 0);

  if (ssTot === 0) return 0;
  return Math.round((1 - ssRes / ssTot) * 10000) / 10000;
}

/**
 * Spearman rank correlation (average ranks for ties).
 * The key metric for buying decisions: does the model ORDER sets correctly?
 */
export function spearman(a: number[], b: number[]): number {
  if (a.length < 2 || a.length !== b.length) return 0;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return 0;
  return Math.round((num / Math.sqrt(da * db)) * 10000) / 10000;
}

/** 1-based ranks with ties assigned their average rank. */
export function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((x, y) => x.v - y.v);
  const out = new Array(values.length).fill(0);
  let pos = 0;
  while (pos < indexed.length) {
    let end = pos;
    while (end + 1 < indexed.length && indexed[end + 1].v === indexed[pos].v) end++;
    const avgRank = (pos + end) / 2 + 1;
    for (let k = pos; k <= end; k++) out[indexed[k].i] = avgRank;
    pos = end + 1;
  }
  return out;
}
