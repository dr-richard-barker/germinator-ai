/**
 * math-utils.js — NumPy-equivalent math utilities for the browser.
 *
 * Every core module in Germinator-NG's Python implementation relies on NumPy
 * for median, MAD, argmax, bincount, etc. This module provides faithful
 * equivalents using typed arrays for performance, with no external dependencies.
 *
 * All functions operate on plain arrays or Float64Array and return primitive
 * values or new typed arrays — never mutating inputs.
 */

// ─── Array creation ─────────────────────────────────────────────────────────

/**
 * Create a Float64Array filled with a value.
 * @param {number} n
 * @param {number} [fill=0]
 * @returns {Float64Array}
 */
export function zeros(n, fill = 0) {
  const a = new Float64Array(n);
  if (fill !== 0) a.fill(fill);
  return a;
}

/**
 * Create a Float64Array filled with Infinity.
 * @param {number} n
 * @returns {Float64Array}
 */
export function full(n, value) {
  const a = new Float64Array(n);
  a.fill(value);
  return a;
}

/**
 * Create an Int32Array filled with a value.
 * @param {number} n
 * @param {number} [fill=0]
 * @returns {Int32Array}
 */
export function zerosInt32(n, fill = 0) {
  const a = new Int32Array(n);
  if (fill !== 0) a.fill(fill);
  return a;
}

/**
 * Create an array [0, 1, 2, ..., n-1].
 * @param {number} n
 * @returns {Float64Array}
 */
export function arange(n) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/**
 * Linearly spaced values from start to stop (inclusive).
 * @param {number} start
 * @param {number} stop
 * @param {number} n
 * @returns {Float64Array}
 */
export function linspace(start, stop, n) {
  const a = new Float64Array(n);
  if (n === 1) { a[0] = start; return a; }
  const step = (stop - start) / (n - 1);
  for (let i = 0; i < n; i++) a[i] = start + i * step;
  return a;
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/**
 * Median of an array. Non-destructive (copies before sorting).
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function median(arr) {
  const sorted = Float64Array.from(arr).sort();
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Mean of an array.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/**
 * Sum of an array.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function sum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

/**
 * Standard deviation (population).
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function std(arr) {
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d; }
  return Math.sqrt(s / arr.length);
}

/**
 * Normal-consistent Median Absolute Deviation.
 * MAD * 1.4826 estimates σ for a Gaussian.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function mad(arr) {
  const med = median(arr);
  const devs = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) devs[i] = Math.abs(arr[i] - med);
  return median(devs) * 1.4826;
}

/**
 * Percentile (linear interpolation).
 * @param {ArrayLike<number>} arr
 * @param {number} p — percentile in [0, 100]
 * @returns {number}
 */
export function percentile(arr, p) {
  const sorted = Float64Array.from(arr).sort();
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ─── Array operations ───────────────────────────────────────────────────────

/**
 * Index of the maximum value.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function argmax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}

/**
 * Index of the minimum value.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function argmin(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[best]) best = i;
  }
  return best;
}

/**
 * Maximum value.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function max(arr) {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

/**
 * Minimum value.
 * @param {ArrayLike<number>} arr
 * @returns {number}
 */
export function min(arr) {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m;
}

/**
 * Element-wise maximum of two arrays (or array and scalar).
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>|number} b
 * @returns {Float64Array}
 */
export function maximum(a, b) {
  const n = a.length;
  const out = new Float64Array(n);
  const isScalar = typeof b === 'number';
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(a[i], isScalar ? b : b[i]);
  }
  return out;
}

/**
 * Element-wise absolute value.
 * @param {ArrayLike<number>} arr
 * @returns {Float64Array}
 */
export function abs(arr) {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.abs(arr[i]);
  return out;
}

/**
 * Cumulative sum.
 * @param {ArrayLike<number>} arr
 * @returns {Float64Array}
 */
export function cumsum(arr) {
  const out = new Float64Array(arr.length);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { s += arr[i]; out[i] = s; }
  return out;
}

/**
 * Bincount — count occurrences of each non-negative integer.
 * @param {ArrayLike<number>} arr — integer values
 * @param {number} [minlength=0]
 * @returns {Int32Array}
 */
export function bincount(arr, minlength = 0) {
  let maxVal = minlength - 1;
  for (let i = 0; i < arr.length; i++) if (arr[i] > maxVal) maxVal = arr[i];
  const out = new Int32Array(maxVal + 1);
  for (let i = 0; i < arr.length; i++) out[arr[i]]++;
  return out;
}

/**
 * Weighted bincount.
 * @param {ArrayLike<number>} arr — integer indices
 * @param {ArrayLike<number>} weights
 * @param {number} [minlength=0]
 * @returns {Float64Array}
 */
export function bincountWeighted(arr, weights, minlength = 0) {
  let maxVal = minlength - 1;
  for (let i = 0; i < arr.length; i++) if (arr[i] > maxVal) maxVal = arr[i];
  const out = new Float64Array(maxVal + 1);
  for (let i = 0; i < arr.length; i++) out[arr[i]] += weights[i];
  return out;
}

/**
 * Argsort — indices that would sort the array.
 * @param {ArrayLike<number>} arr
 * @returns {Uint32Array}
 */
export function argsort(arr) {
  const indices = new Uint32Array(arr.length);
  for (let i = 0; i < arr.length; i++) indices[i] = i;
  indices.sort((a, b) => arr[a] - arr[b]);
  return indices;
}

/**
 * Unique values, sorted.
 * @param {ArrayLike<number>} arr
 * @returns {number[]}
 */
export function unique(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

// ─── 2D array helpers ───────────────────────────────────────────────────────

/**
 * Create a 2D array stored as a flat typed array with row-major layout.
 * @param {number} rows
 * @param {number} cols
 * @param {number} [fill=0]
 * @returns {{data: Float64Array|Int32Array, rows: number, cols: number}}
 */
export function zeros2d(rows, cols, fill = 0, dtype = 'float64') {
  const Ctor = dtype === 'int32' ? Int32Array : Float64Array;
  const data = new Ctor(rows * cols);
  if (fill !== 0) data.fill(fill);
  return { data, rows, cols };
}

/**
 * Get value at (r, c) from a flat 2D array.
 * @param {{data: ArrayLike<number>, cols: number}} grid
 * @param {number} r
 * @param {number} c
 * @returns {number}
 */
export function get2d(grid, r, c) {
  return grid.data[r * grid.cols + c];
}

/**
 * Set value at (r, c) in a flat 2D array.
 * @param {{data: ArrayLike<number>, cols: number}} grid
 * @param {number} r
 * @param {number} c
 * @param {number} val
 */
export function set2d(grid, r, c, val) {
  grid.data[r * grid.cols + c] = val;
}

// ─── Numeric utilities ──────────────────────────────────────────────────────

/**
 * log(1 + exp(x)), numerically stable.
 * @param {number} x
 * @returns {number}
 */
export function logaddexp(a, b) {
  const mx = Math.max(a, b);
  return mx + Math.log(Math.exp(a - mx) + Math.exp(b - mx));
}

/**
 * Numerically stable log(sigmoid(z)) = -log(1 + exp(-z)).
 * @param {number} z
 * @returns {number}
 */
export function logSigmoid(z) {
  return -logaddexp(0, -z);
}

/**
 * Trapezoidal integration (equivalent to np.trapezoid / np.trapz).
 * @param {ArrayLike<number>} y — function values
 * @param {ArrayLike<number>} x — sample points
 * @returns {number}
 */
export function trapezoid(y, x) {
  let s = 0;
  for (let i = 1; i < y.length; i++) {
    s += (y[i] + y[i - 1]) * (x[i] - x[i - 1]) / 2;
  }
  return s;
}

/**
 * Simple pseudorandom number generator (xoshiro128**) for reproducible bootstraps.
 * Seeded, deterministic, fast.
 */
export class PRNG {
  constructor(seed = 0) {
    // splitmix64 to initialise state from a single integer
    let s = BigInt(seed) | 0n;
    const sm = () => {
      s = BigInt.asUintN(64, s + 0x9e3779b97f4a7c15n);
      let z = s;
      z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
      z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
      return Number(BigInt.asUintN(32, z ^ (z >> 31n)));
    };
    this._s = [sm(), sm(), sm(), sm()];
  }

  /** @returns {number} integer in [0, 2^32) */
  nextUint32() {
    const s = this._s;
    const result = ((s[1] * 5) << 7 | (s[1] * 5) >>> 25) * 9;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11 | s[3] >>> 21);
    return result >>> 0;
  }

  /** @returns {number} float in [0, 1) */
  random() {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Random integer in [0, max).
   * @param {number} max
   * @returns {number}
   */
  randint(max) {
    return Math.floor(this.random() * max);
  }

  /**
   * Random choice of n indices from [0, size) with replacement.
   * @param {number} size
   * @param {number} n
   * @returns {Uint32Array}
   */
  choice(size, n) {
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.randint(size);
    return out;
  }
}
