/**
 * Self-calibrating foreground/background segmentation.
 *
 * The original GERMINATOR (Joosen et al. 2010) thresholded in YUV with constants
 * tuned to one camera and one batch of blue filter paper:
 *
 *     +white (seed coat + radicle):  Y 100-255  U 0-135  V  80-255
 *     -white (seed coat only):       Y 120-255  U 0-90   V 120-255
 *
 * Those constants do not transfer to another camera, substrate or exposure. Here
 * the background model is estimated from each image instead.
 *
 * The substrate is uniform and occupies the large majority of the frame, so its
 * colour is the mode of the image. We reduce colour to a scalar "substrate
 * contrast" index that is high on substrate and low on seeds, then threshold at a
 * robust distance below the index median. Median and MAD are used rather than mean
 * and SD because up to ~10% of pixels are foreground at late timepoints and would
 * drag a mean estimator.
 *
 * Ported from Python source.
 */

import { median, mad, std, argmax } from './math-utils.js';

const _CHANNELS = ["r", "g", "b"];

export class BackgroundModel {
    /**
     * @param {string} channel
     * @param {number} median
     * @param {number} mad
     * @param {number} threshold
     * @param {number} k
     */
    constructor(channel, median, mad, threshold, k) {
        this._channel = channel;
        this._median = median;
        this._mad = mad;
        this._threshold = threshold;
        this._k = k;
        Object.freeze(this);
    }

    get channel() { return this._channel; }
    get median() { return this._median; }
    get mad() { return this._mad; }
    get threshold() { return this._threshold; }
    get k() { return this._k; }

    get contrast_to_noise() {
        return this.mad > 0 ? (this.median - this.threshold) / this.mad : Infinity;
    }
}

/**
 * @param {{data: Float32Array, width: number, height: number, channels: number}} rgb
 * @param {string} channel
 * @returns {Float32Array}
 */
export function contrast_index(rgb, channel) {
    const i = _CHANNELS.indexOf(channel);
    const others = [0, 1, 2].filter(j => j !== i);
    const numPixels = rgb.width * rgb.height;
    const index = new Float32Array(numPixels);
    const data = rgb.data;
    
    for (let p = 0; p < numPixels; p++) {
        const idx = p * 3;
        index[p] = data[idx + i] - 0.5 * (data[idx + others[0]] + data[idx + others[1]]);
    }
    return index;
}

/**
 * @param {{data: Float32Array, width: number, height: number, channels: number}} rgb
 * @returns {string}
 */
export function dominant_channel(rgb) {
    const scores = _CHANNELS.map(c => median(contrast_index(rgb, c)));
    // argmax expects an array or typed array, depending on the implementation in math-utils.js
    // passing a Float64Array to be safe.
    return _CHANNELS[argmax(Float64Array.from(scores))];
}

/**
 * @param {{data: Float32Array, width: number, height: number, channels: number}} rgb
 * @param {number} [k=6.0]
 * @param {string} [channel=null]
 * @returns {BackgroundModel}
 */
export function fit_background(rgb, k = 6.0, channel = null) {
    channel = channel || dominant_channel(rgb);
    const index = contrast_index(rgb, channel);
    const med = median(index);
    
    let mad_val = mad(index);
    if (mad_val <= 0) {
        mad_val = Math.max(std(index), 1e-6);
    }
    
    return new BackgroundModel(channel, med, mad_val, med - k * mad_val, k);
}

/**
 * @param {{data: Float32Array, width: number, height: number, channels: number}} rgb
 * @param {BackgroundModel} [model=null]
 * @param {number} [k=6.0]
 * @param {string} [channel=null]
 * @returns {{mask: Uint8Array, model: BackgroundModel}}
 */
export function foreground_mask(rgb, model = null, k = 6.0, channel = null) {
    model = model || fit_background(rgb, k, channel);
    const index = contrast_index(rgb, model.channel);
    const mask = new Uint8Array(index.length);
    const threshold = model.threshold;
    
    for (let i = 0; i < index.length; i++) {
        mask[i] = index[i] < threshold ? 1 : 0;
    }
    
    return { mask, model };
}
