/**
 * Germination scoring with temporal enforcement.
 * 
 * Self-normalised features + absorbing-state temporal model.
 * Germination is irreversible, so the state sequence is a run of
 * "ungerminated" followed by a run of "germinated".
 * 
 * Ported from score.py
 */

import { argsort, cumsum, logaddexp } from './math-utils.js';

export const MARGIN_AREA = 1.00;
export const MARGIN_PROTRUSION = 0.25;
export const MARGIN_ELONGATION = 0.60;
export const MARGIN_GREEN = 0.03;
export const VETO_PROTRUSION = 1.10;
export const VETO_ELONGATION = 1.20;

export class SeedTrack {
    /**
     * @param {number} seed_id 
     * @param {Float64Array} scores 
     * @param {number} onset_index 
     * @param {number} confidence 
     * @param {boolean} germinated 
     */
    constructor(seed_id, scores, onset_index, confidence, germinated) {
        this.seed_id = seed_id;
        this.scores = scores;
        this.onset_index = onset_index;
        this.confidence = confidence;
        this.germinated = germinated;
    }

    get flicker() {
        let count = 0;
        for (let i = 1; i < this.scores.length; i++) {
            const prev = this.scores[i - 1] >= 1.0;
            const curr = this.scores[i] >= 1.0;
            if (prev !== curr) count++;
        }
        return count;
    }
}

/**
 * @param {Float64Array|number[]} area 
 * @param {Float64Array|number[]} reach 
 * @param {Float64Array|number[]} elongation 
 * @param {Float64Array|number[]} [green_fraction] 
 * @returns {Float64Array}
 */
export function frame_scores(area, reach, elongation, green_fraction = null) {
    const n = area.length;
    const a = area;
    const r = reach;
    const e = elongation;
    const g = green_fraction || new Float64Array(n);
    
    const s = new Float64Array(n);
    
    for (let i = 0; i < n; i++) {
        const protrusion = r[i] / Math.sqrt(Math.max(a[i], 1e-9));
        
        const max_val = Math.max(
            (protrusion - 1.0) / MARGIN_PROTRUSION,
            (a[i] - 1.0) / MARGIN_AREA,
            (e[i] - 1.0) / MARGIN_ELONGATION,
            g[i] / MARGIN_GREEN
        );
        s[i] = max_val;

        const halo = (a[i] >= 1.0 + MARGIN_AREA) && 
                     (protrusion < VETO_PROTRUSION) && 
                     (e[i] < VETO_ELONGATION) && 
                     (g[i] < MARGIN_GREEN);
                     
        if (halo) {
            s[i] = 0.0;
        }
    }
    
    return s;
}

/**
 * @param {number} z 
 * @returns {number}
 */
function _log_sigmoid(z) {
    return -logaddexp(0, -z);
}

/**
 * @param {Float64Array|number[]} scores 
 * @param {number} beta 
 * @param {number} never_prior 
 * @param {number} switch_penalty 
 * @returns {SeedTrack}
 */
export function call_onset(scores, beta = 4.0, never_prior = 0.10, switch_penalty = 1.0) {
    const s = Float64Array.from(scores);
    const t = s.length;
    if (t === 0) {
        return new SeedTrack(-1, s, 0, 0, false);
    }

    const z = new Float64Array(t);
    const log_p_g = new Float64Array(t);
    const log_p_u = new Float64Array(t);

    for (let i = 0; i < t; i++) {
        z[i] = beta * (s[i] - 1.0);
        log_p_g[i] = _log_sigmoid(z[i]);
        log_p_u[i] = _log_sigmoid(-z[i]);
    }

    const neg_log_p_u = Array.from(log_p_u).map(v => -v);
    const neg_log_p_g = Array.from(log_p_g).map(v => -v);
    
    const cum_u_arr = cumsum(neg_log_p_u);
    const cum_g_arr = cumsum(neg_log_p_g);
    
    const cum_u = new Float64Array(t + 1);
    const cum_g = new Float64Array(t + 1);
    
    cum_u[0] = 0;
    cum_g[0] = 0;
    for (let i = 0; i < t; i++) {
        cum_u[i + 1] = cum_u_arr[i];
        cum_g[i + 1] = cum_g_arr[i];
    }
    
    const total_g = cum_g[t];
    const costs = new Float64Array(t + 1);
    
    for (let k = 0; k <= t; k++) {
        costs[k] = cum_u[k] + (total_g - cum_g[k]);
    }
    
    const log_prior = new Float64Array(t + 1);
    const default_prior = -Math.log(Math.max(t, 1)) - Math.log1p(-never_prior);
    for (let i = 0; i < t; i++) {
        log_prior[i] = default_prior;
    }
    log_prior[t] = Math.log(never_prior);
    
    for (let i = 0; i <= t; i++) {
        costs[i] -= log_prior[i];
    }
    
    for (let i = 0; i < t; i++) {
        costs[i] += switch_penalty;
    }
    
    costs[0] = Infinity;
    
    const order = argsort(costs);
    const best = order[0];
    const gap = (t >= 1 && order.length > 1) ? costs[order[1]] - costs[best] : 0;
    
    return new SeedTrack(-1, s, best, gap, best < t);
}

/**
 * @param {SeedTrack[]} tracks 
 * @param {number} n_frames 
 * @returns {Float64Array}
 */
export function cumulative_germination(tracks, n_frames) {
    const counts = new Float64Array(n_frames);
    for (const tr of tracks) {
        if (tr.germinated) {
            for (let i = tr.onset_index; i < n_frames; i++) {
                counts[i]++;
            }
        }
    }
    return counts;
}

/**
 * @param {SeedTrack[]} tracks 
 * @param {number} n_frames 
 * @returns {Float64Array}
 */
export function non_germinated(tracks, n_frames) {
    const counts = cumulative_germination(tracks, n_frames);
    const total = tracks.length;
    const result = new Float64Array(n_frames);
    for (let i = 0; i < n_frames; i++) {
        result[i] = total - counts[i];
    }
    return result;
}
