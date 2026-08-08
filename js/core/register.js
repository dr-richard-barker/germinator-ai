/**
 * Frame-to-frame registration by point-set voting.
 * The constellation of seed centroids is sparse, distinctive and nearly rigid.
 * A pairwise-difference vote over ~60 points is ~3600 integer operations.
 * 
 * Ported from register.py
 */

import { zeros } from './math-utils.js';

export class Shift {
    /**
     * @param {number} dy 
     * @param {number} dx 
     * @param {number} votes 
     * @param {number} snr 
     * @param {number} n_inliers 
     */
    constructor(dy, dx, votes, snr, n_inliers) {
        this._dy = dy;
        this._dx = dx;
        this._votes = votes;
        this._snr = snr;
        this._n_inliers = n_inliers;
        Object.freeze(this);
    }

    get dy() { return this._dy; }
    get dx() { return this._dx; }
    get votes() { return this._votes; }
    get snr() { return this._snr; }
    get n_inliers() { return this._n_inliers; }

    get ok() {
        return this.snr >= 5.0 && this.n_inliers >= 3;
    }

    /**
     * @param {Array<Array<number>>} points 
     * @returns {Array<Array<number>>}
     */
    apply(points) {
        return points.map(p => [p[0] - this.dy, p[1] - this.dx]);
    }
}

/**
 * reference_pts and moving_pts are arrays of [y,x] pairs.
 * Every pair (p,q) votes for translation q-p.
 * Peak is refined by least squares over inlier pairs.
 * 
 * @param {Array<Array<number>>} reference_pts 
 * @param {Array<Array<number>>} moving_pts 
 * @param {number} max_shift 
 * @returns {Shift}
 */
export function estimate_shift(reference_pts, moving_pts, max_shift) {
    if (reference_pts.length === 0 || moving_pts.length === 0) {
        return new Shift(0.0, 0.0, 0, 0.0, 0);
    }
    
    const r = Math.ceil(max_shift);
    const size = 2 * r + 1;
    const acc = new Int32Array(size * size); // Flat array for 2D accumulation

    const deltas = [];
    for (let i = 0; i < moving_pts.length; i++) {
        for (let j = 0; j < reference_pts.length; j++) {
            const dy = moving_pts[i][0] - reference_pts[j][0];
            const dx = moving_pts[i][1] - reference_pts[j][1];
            if (Math.abs(dy) <= r && Math.abs(dx) <= r) {
                deltas.push([dy, dx]);
            }
        }
    }

    if (deltas.length === 0) {
        return new Shift(0.0, 0.0, 0, 0.0, 0);
    }

    for (let i = 0; i < deltas.length; i++) {
        const iy = Math.round(deltas[i][0]) + r;
        const ix = Math.round(deltas[i][1]) + r;
        acc[iy * size + ix] += 1;
    }

    const smooth = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ny = (y + dy + size) % size;
                    const nx = (x + dx + size) % size;
                    sum += acc[ny * size + nx];
                }
            }
            smooth[y * size + x] = sum;
        }
    }

    let max_val = -1;
    let peak_y = 0;
    let peak_x = 0;
    let smooth_sum = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const val = smooth[y * size + x];
            smooth_sum += val;
            if (val > max_val) {
                max_val = val;
                peak_y = y;
                peak_x = x;
            }
        }
    }

    const coarse_dy = peak_y - r;
    const coarse_dx = peak_x - r;
    
    const mean_val = (smooth_sum / (size * size)) || 1e-9;
    const snr = max_val / mean_val;

    const near = [];
    for (let i = 0; i < deltas.length; i++) {
        if (Math.abs(deltas[i][0] - coarse_dy) <= 1.5 && Math.abs(deltas[i][1] - coarse_dx) <= 1.5) {
            near.push(deltas[i]);
        }
    }

    let final_dy = coarse_dy;
    let final_dx = coarse_dx;
    if (near.length >= 3) {
        let sum_dy = 0;
        let sum_dx = 0;
        for (let i = 0; i < near.length; i++) {
            sum_dy += near[i][0];
            sum_dx += near[i][1];
        }
        final_dy = sum_dy / near.length;
        final_dx = sum_dx / near.length;
    }

    return new Shift(final_dy, final_dx, acc[peak_y * size + peak_x], snr, near.length);
}

export function chain_shifts(shifts) {
    const offsets = [[0, 0]];
    let cur_dy = 0;
    let cur_dx = 0;
    for (let i = 0; i < shifts.length; i++) {
        cur_dy += shifts[i].dy;
        cur_dx += shifts[i].dx;
        offsets.push([cur_dy, cur_dx]);
    }
    return offsets;
}

export function register_series(centroids_per_frame, seed_diameter_px, max_shift_diameters = 3.0) {
    const max_shift = seed_diameter_px * max_shift_diameters;
    const shifts = [];
    for (let i = 1; i < centroids_per_frame.length; i++) {
        shifts.push(estimate_shift(centroids_per_frame[i - 1], centroids_per_frame[i], max_shift));
    }
    return shifts;
}
