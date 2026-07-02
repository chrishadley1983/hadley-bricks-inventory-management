/**
 * Closed-form ridge regression.
 *
 * Solves (X'X + lambda*I) w = X'y via Gaussian elimination with partial
 * pivoting. A bias column is prepended internally and left unregularized.
 *
 * With ~2k samples and ~35 standardized features this is exact, deterministic
 * and instant — no gradient descent required.
 */

export interface RidgeModel {
  /** weights[0] is the bias term, weights[1..] align with the feature vector. */
  weights: number[];
  lambda: number;
}

/**
 * Fit ridge regression. X rows are feature vectors (already normalised),
 * y is the target. Throws if inputs are empty or ragged.
 */
export function fitRidge(X: number[][], y: number[], lambda = 1.0): RidgeModel {
  const n = X.length;
  if (n === 0 || y.length !== n) {
    throw new Error(`fitRidge: bad input shapes (n=${n}, y=${y.length})`);
  }
  const d = X[0].length + 1; // +1 bias

  // A = X'X + lambda*I (bias unregularized), b = X'y, with bias column of 1s
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b: number[] = new Array(d).fill(0);

  for (let r = 0; r < n; r++) {
    const row = X[r];
    if (row.length !== d - 1) {
      throw new Error(`fitRidge: ragged row ${r} (${row.length} != ${d - 1})`);
    }
    for (let i = 0; i < d; i++) {
      const xi = i === 0 ? 1 : row[i - 1];
      b[i] += xi * y[r];
      for (let j = i; j < d; j++) {
        const xj = j === 0 ? 1 : row[j - 1];
        A[i][j] += xi * xj;
      }
    }
  }

  // Mirror the upper triangle and add the ridge penalty (skip bias at 0,0)
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < i; j++) {
      A[i][j] = A[j][i];
    }
    if (i > 0) A[i][i] += lambda;
  }

  const weights = solveLinearSystem(A, b);
  return { weights, lambda };
}

/** Predict a single target value from a feature vector. */
export function predictRidge(model: RidgeModel, x: number[]): number {
  let out = model.weights[0];
  for (let i = 0; i < x.length; i++) {
    out += model.weights[i + 1] * x[i];
  }
  return out;
}

/**
 * Solve A x = b via Gaussian elimination with partial pivoting.
 * Mutates copies, not the inputs.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const d = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < d; col++) {
    // Partial pivot
    let pivotRow = col;
    for (let r = col + 1; r < d; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-12) {
      // Singular column (e.g. a constant feature) — leave weight at 0
      continue;
    }
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let r = col + 1; r < d; r++) {
      const factor = M[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= d; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  // Back-substitution
  const x = new Array(d).fill(0);
  for (let r = d - 1; r >= 0; r--) {
    if (Math.abs(M[r][r]) < 1e-12) {
      x[r] = 0;
      continue;
    }
    let sum = M[r][d];
    for (let c = r + 1; c < d; c++) {
      sum -= M[r][c] * x[c];
    }
    x[r] = sum / M[r][r];
  }

  return x;
}
