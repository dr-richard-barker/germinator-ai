/**
 * Scale calibration in seed units.
 *
 * The fix is to stop measuring in pixels. The median seed at the first timepoint
 * is a ruler that is present in every experiment by definition.
 *
 * Ported from Python source.
 */

import { median, mad } from './math-utils.js';

export const SEED_DIAMETER_MM = {
    "arabidopsis": 0.35,
    "brassica": 1.60,
    "lettuce": 1.20,
    "tomato": 2.40,
};

export class ScaleModel {
    /**
     * @param {number} seed_area_px
     * @param {number} seed_area_mad_px
     * @param {number|null} [px_per_mm=null]
     * @param {string} [source="seed-median"]
     */
    constructor(seed_area_px, seed_area_mad_px, px_per_mm = null, source = "seed-median") {
        this._seed_area_px = seed_area_px;
        this._seed_area_mad_px = seed_area_mad_px;
        this._px_per_mm = px_per_mm;
        this._source = source;
        Object.freeze(this);
    }

    get seed_area_px() { return this._seed_area_px; }
    get seed_area_mad_px() { return this._seed_area_mad_px; }
    get px_per_mm() { return this._px_per_mm; }
    get source() { return this._source; }

    get seed_diameter_px() {
        return 2.0 * Math.sqrt(this.seed_area_px / Math.PI);
    }

    get relative_spread() {
        return this.seed_area_px ? this.seed_area_mad_px / this.seed_area_px : 0.0;
    }

    /**
     * @param {number} area_px
     * @returns {number|null}
     */
    area_to_mm2(area_px) {
        if (!this.px_per_mm) return null;
        return area_px / (this.px_per_mm ** 2);
    }
}

/**
 * @param {number[]|Float64Array} t0_areas_px
 * @param {string} [species="arabidopsis"]
 * @param {number|null} [px_per_mm=null]
 * @returns {ScaleModel}
 */
export function fit_scale(t0_areas_px, species = "arabidopsis", px_per_mm = null) {
    const areas = Float64Array.from(t0_areas_px);
    if (areas.length === 0) {
        throw new Error("cannot calibrate scale: no objects");
    }
    const median_val = median(areas);
    const mad_val = mad(areas); // already uses 1.4826 factor
    if (px_per_mm) {
        return new ScaleModel(median_val, mad_val, px_per_mm, "user");
    }
    if (species) {
        const key = species.trim().toLowerCase();
        if (key in SEED_DIAMETER_MM) {
            const diameter_px = 2.0 * Math.sqrt(median_val / Math.PI);
            return new ScaleModel(median_val, mad_val, diameter_px / SEED_DIAMETER_MM[key], "seed-median");
        }
    }
    return new ScaleModel(median_val, mad_val, null, "none");
}

// Constants — all dimensionless multiples of seed units
export const DEBRIS_AREA = 0.30;
export const DOUBLET_AREA = 1.60;
export const ROI_MARGIN_DIAMETERS = 15.0;
export const GEODESIC_CAP_DIAMETERS = 12.0;
export const REGISTRATION_SEARCH_DIAMETERS = 3.0;
