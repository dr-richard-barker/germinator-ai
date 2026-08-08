/**
 * Germination curve fitting and parameter extraction.
 * Port of curves.py
 *
 * Because seeds are now tracked individually, a replicate yields N event times
 * rather than 8 noisy proportions. The empirical cumulative curve is available
 * directly, with no model to misspecify.
 */

import { zeros, argmax } from './math-utils.js';

export class GerminationParameters {
    /**
     * @param {Object} params
     * @param {number} params.gmax
     * @param {number|null} params.t50
     * @param {number|null} params.u7525
     * @param {number|null} params.u8416
     * @param {number|null} params.auc
     * @param {Array<number>|null} params.aucWindow
     * @param {number|null} params.mgt
     * @param {number|null} params.t50OverMgt
     * @param {number} params.nSeeds
     * @param {number} params.nGerminated
     */
    constructor({ gmax, t50, u7525, u8416, auc, aucWindow, mgt, t50OverMgt, nSeeds, nGerminated }) {
        this._gmax = gmax;
        this._t50 = t50;
        this._u7525 = u7525;
        this._u8416 = u8416;
        this._auc = auc;
        this._aucWindow = aucWindow;
        this._mgt = mgt;
        this._t50OverMgt = t50OverMgt;
        this._nSeeds = nSeeds;
        this._nGerminated = nGerminated;
        Object.freeze(this);
    }
    get gmax() { return this._gmax; }
    get t50() { return this._t50; }
    get u7525() { return this._u7525; }
    get u8416() { return this._u8416; }
    get auc() { return this._auc; }
    get aucWindow() { return this._aucWindow; }
    get mgt() { return this._mgt; }
    get t50OverMgt() { return this._t50OverMgt; }
    get nSeeds() { return this._nSeeds; }
    get nGerminated() { return this._nGerminated; }
}

/**
 * @param {Array<number|null>} germinationTimes
 * @param {Array<number>|Float64Array} times
 * @returns {Float64Array} Cumulative fraction at each time
 */
export function empiricalCurve(germinationTimes, times) {
    const n = germinationTimes.length;
    const out = new Float64Array(times.length);
    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        let count = 0;
        for (let j = 0; j < n; j++) {
            const g = germinationTimes[j];
            if (g !== null && g !== undefined && g <= t) {
                count++;
            }
        }
        out[i] = count / n;
    }
    return out;
}

/**
 * First time curve reaches target, by linear interpolation
 * @param {Array<number>|Float64Array} times
 * @param {Array<number>|Float64Array} curve
 * @param {number} target
 * @returns {number|null}
 */
export function interpolateTime(times, curve, target) {
    if (target <= 0 || times.length === 0 || curve[curve.length - 1] < target) {
        return null;
    }
    let idx = 0;
    while (idx < curve.length && curve[idx] < target) {
        idx++;
    }
    if (idx === 0) return times[0];
    const y0 = curve[idx - 1];
    const y1 = curve[idx];
    if (y1 === y0) return times[idx];
    const frac = (target - y0) / (y1 - y0);
    return times[idx - 1] + frac * (times[idx] - times[idx - 1]);
}

/**
 * Extract standard parameters from per-seed event times
 * @param {Array<number|null>} germinationTimes
 * @param {Array<number>|Float64Array} times
 * @returns {GerminationParameters}
 */
export function parametersFromTimes(germinationTimes, times) {
    const validTimes = germinationTimes.filter(t => t !== null && t !== undefined);
    validTimes.sort((a, b) => a - b);
    const nSeeds = germinationTimes.length;
    const nGerminated = validTimes.length;
    const gmax = nSeeds > 0 ? nGerminated / nSeeds : 0;

    let t50 = null, u7525 = null, u8416 = null, auc = null, mgt = null, t50OverMgt = null;
    const aucWindow = null;

    if (nGerminated > 0) {
        const curve = empiricalCurve(germinationTimes, times);
        t50 = interpolateTime(times, curve, gmax * 0.5);
        const t75 = interpolateTime(times, curve, gmax * 0.75);
        const t25 = interpolateTime(times, curve, gmax * 0.25);
        if (t75 !== null && t25 !== null) u7525 = t75 - t25;

        const t84 = interpolateTime(times, curve, gmax * 0.84);
        const t16 = interpolateTime(times, curve, gmax * 0.16);
        if (t84 !== null && t16 !== null) u8416 = t84 - t16;

        mgt = validTimes.reduce((sum, val) => sum + val, 0) / nGerminated;
        if (t50 !== null && mgt > 0) t50OverMgt = t50 / mgt;

        auc = 0;
        for (let i = 1; i < times.length; i++) {
            const dt = times[i] - times[i - 1];
            auc += 0.5 * (curve[i] + curve[i - 1]) * dt;
        }
    }

    return new GerminationParameters({
        gmax, t50, u7525, u8416, auc, aucWindow, mgt, t50OverMgt, nSeeds, nGerminated
    });
}

/**
 * Bootstrap CIs by resampling seeds
 * @param {Array<number|null>} germinationTimes
 * @param {Array<number>|Float64Array} times
 * @param {number} nBoot
 * @param {number} seed
 * @returns {Array<GerminationParameters>}
 */
export function bootstrapParameters(germinationTimes, times, nBoot = 2000, seed = 0) {
    const n = germinationTimes.length;
    const results = [];
    
    // Simple PRNG (Linear congruential generator) for reproducibility
    let currentSeed = seed;
    const random = () => {
        currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
        return currentSeed / 4294967296;
    };

    for (let b = 0; b < nBoot; b++) {
        const sample = new Array(n);
        for (let i = 0; i < n; i++) {
            const idx = Math.floor(random() * n);
            sample[i] = germinationTimes[idx];
        }
        results.push(parametersFromTimes(sample, times));
    }
    return results;
}

export class HillFit {
    constructor(y0, a, b, c, rSquared, identifiable, nRising) {
        this._y0 = y0;
        this._a = a;
        this._b = b;
        this._c = c;
        this._rSquared = rSquared;
        this._identifiable = identifiable;
        this._nRising = nRising;
        Object.freeze(this);
    }
    get y0() { return this._y0; }
    get a() { return this._a; }
    get b() { return this._b; }
    get c() { return this._c; }
    get rSquared() { return this._rSquared; }
    get identifiable() { return this._identifiable; }
    get nRising() { return this._nRising; }

    predict(t) {
        t = Math.max(t, 1e-9);
        return this._y0 + this._a * Math.pow(t, this._b) / (Math.pow(this._c, this._b) + Math.pow(t, this._b));
    }
}

function hillObjective(params, times, curve) {
    const [y0, a, b, c] = params;
    let sumSq = 0;
    for (let i = 0; i < times.length; i++) {
        const t = Math.max(times[i], 1e-9);
        const tb = Math.pow(t, b);
        const cb = Math.pow(c, b);
        const pred = y0 + a * tb / (cb + tb);
        const err = curve[i] - pred;
        sumSq += err * err;
    }
    return sumSq;
}

/**
 * 4-parameter Hill fit by bounded least squares
 * @param {Array<number>|Float64Array} times
 * @param {Array<number>|Float64Array} curve
 * @returns {HillFit|null}
 */
export function fitHill(times, curve) {
    if (times.length < 4) return null;
    const tMin = times[0];
    const tMax = times[times.length - 1];
    
    const bounds = [
        [0, 0.2],           // y0
        [0, 1.2],           // a
        [0.5, 30],          // b
        [tMin * 0.3, tMax * 3] // c
    ];
    
    // Multi-start with b0 in [1, 2, 4, 8]
    const bInitial = [1, 2, 4, 8];
    let bestParams = null;
    let bestError = Infinity;
    
    const maxIter = 100;
    const step = 0.001;
    
    for (const b0 of bInitial) {
        // Initial guess
        let params = [0, curve[curve.length - 1], b0, tMax / 2];
        
        // Simple Gradient Descent / pseudo LM for bounded optimization
        for (let iter = 0; iter < maxIter; iter++) {
            const currentErr = hillObjective(params, times, curve);
            const grads = [0, 0, 0, 0];
            
            // Numeric gradient
            for (let p = 0; p < 4; p++) {
                const paramsUp = [...params];
                paramsUp[p] += step;
                const errUp = hillObjective(paramsUp, times, curve);
                grads[p] = (errUp - currentErr) / step;
            }
            
            let moved = false;
            for (let p = 0; p < 4; p++) {
                // Adaptive step size based on current value
                let lr = 0.01 * Math.max(0.1, Math.abs(params[p]));
                let newP = params[p] - lr * grads[p];
                
                // Clamp
                if (newP < bounds[p][0]) newP = bounds[p][0];
                if (newP > bounds[p][1]) newP = bounds[p][1];
                
                if (Math.abs(newP - params[p]) > 1e-6) moved = true;
                params[p] = newP;
            }
            
            if (!moved) break;
        }
        
        const finalErr = hillObjective(params, times, curve);
        if (finalErr < bestError) {
            bestError = finalErr;
            bestParams = params;
        }
    }
    
    if (!bestParams) return null;
    
    // Calculate R-squared
    let meanY = 0;
    for (let i = 0; i < curve.length; i++) meanY += curve[i];
    meanY /= curve.length;
    
    let ssTot = 0;
    for (let i = 0; i < curve.length; i++) {
        const d = curve[i] - meanY;
        ssTot += d * d;
    }
    
    const rSquared = ssTot === 0 ? 1 : 1 - (bestError / ssTot);
    
    let nRising = 0;
    for (let i = 1; i < curve.length; i++) {
        if (curve[i] > curve[i-1]) nRising++;
    }
    
    return new HillFit(bestParams[0], bestParams[1], bestParams[2], bestParams[3], rSquared, nRising >= 3, nRising);
}
