/**
 * pipeline.js — End-to-end analysis of one image series.
 *
 * Port of pipeline.py. Coordinates:
 *   segment → calibrate → objects → register → track → score → curves
 *
 * A "series" is one crop photographed repeatedly: the unit the original
 * pipeline processed as unrelated images and this one processes as a single
 * tracked experiment.
 */

import { foreground_mask, BackgroundModel } from './segment.js';
import { fit_scale, DEBRIS_AREA, REGISTRATION_SEARCH_DIAMETERS } from './calibrate.js';
import { labelConnectedComponents, measure } from './objects.js';
import { register_series, chain_shifts } from './register.js';
import { Seed, FrameAssignment, buildRegistry, assignFrame } from './track.js';
import { SeedTrack, frame_scores, call_onset, cumulative_germination, non_germinated } from './score.js';
import { mean } from './math-utils.js';

/**
 * Everything the pipeline learned about one crop through time.
 */
export class SeriesResult {
  /**
   * @param {object} opts
   */
  constructor(opts) {
    /** @type {number[]} */
    this.hours = opts.hours;
    /** @type {Seed[]} */
    this.seeds = opts.seeds;
    /** @type {SeedTrack[]} */
    this.tracks = opts.tracks || [];
    /** @type {import('./calibrate.js').ScaleModel|null} */
    this.scale = opts.scale || null;
    /** @type {BackgroundModel[]} */
    this.backgrounds = opts.backgrounds || [];
    /** @type {import('./register.js').Shift[]} */
    this.shifts = opts.shifts || [];
    /** @type {Array<[number, number]>} */
    this.offsets = opts.offsets || [];
    /** @type {number[]} */
    this.orphanFraction = opts.orphanFraction || [];
    /** @type {number[]} */
    this.anchorsOnForeground = opts.anchorsOnForeground || [];
    /** @type {number[]} */
    this.maxSeedsPerComponent = opts.maxSeedsPerComponent || [];
    /** @type {Uint8Array[]} */
    this.masks = opts.masks || [];
    /** @type {FrameAssignment[]} */
    this.assignments = opts.assignments || [];
  }

  get nSeeds() { return this.seeds.length; }
  get nFrames() { return this.hours.length; }
  get nGerminated() { return this.tracks.filter(t => t.germinated).length; }

  /** @returns {Array<number|null>} Hours at which each seed germinated */
  germinationTimes() {
    return this.tracks.map(t =>
      t.germinated ? this.hours[t.onset_index] : null
    );
  }

  /** @returns {object} Quality control metrics */
  qc() {
    return {
      n_seeds: this.nSeeds,
      max_orphan_fraction: this.orphanFraction.length ? Math.max(...this.orphanFraction) : 0,
      min_anchor_retention: this.anchorsOnForeground.length
        ? Math.min(...this.anchorsOnForeground) / Math.max(this.nSeeds, 1)
        : 0,
      max_seeds_per_component: this.maxSeedsPerComponent.length
        ? Math.max(...this.maxSeedsPerComponent) : 0,
      min_registration_snr: this.shifts.length
        ? Math.min(...this.shifts.map(s => s.snr)) : Infinity,
      ambiguous_seeds: this.tracks.filter(t => t.confidence < 0.5).length,
    };
  }
}

// ─── Helper functions ─────────────────────────────────────────────────────

/**
 * Fraction of each seed's pixels that are green (cotyledons).
 * @param {Float32Array} rgb - flat RGB float data
 * @param {Int32Array} labels - per-pixel seed ID
 * @param {number} width
 * @param {number} height
 * @param {number[]} seedIds
 * @returns {Map<number, number>}
 */
function _greenFraction(rgb, labels, width, height, seedIds) {
  const greenCount = new Map();
  const totalCount = new Map();
  for (const id of seedIds) { greenCount.set(id, 0); totalCount.set(id, 0); }

  const nPx = width * height;
  for (let i = 0; i < nPx; i++) {
    const sid = labels[i];
    if (sid > 0 && totalCount.has(sid)) {
      totalCount.set(sid, totalCount.get(sid) + 1);
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      // Green dominates both other channels (specific to chlorophyll)
      if (g > r && g > b) {
        greenCount.set(sid, greenCount.get(sid) + 1);
      }
    }
  }

  const out = new Map();
  for (const id of seedIds) {
    const tot = totalCount.get(id);
    out.set(id, tot > 0 ? greenCount.get(id) / tot : 0);
  }
  return out;
}

/**
 * Perimeter²/(4π·area) per seed — inverse circularity (elongation proxy).
 * @param {Uint8Array} mask - foreground mask
 * @param {Int32Array} labels
 * @param {number} width
 * @param {number} height
 * @param {number[]} seedIds
 * @returns {Map<number, number>}
 */
function _elongation(mask, labels, width, height, seedIds) {
  // Compute edge pixels: foreground pixels with at least one background 8-neighbour
  const out = new Map();
  const areaMap = new Map();
  const perimMap = new Map();
  for (const id of seedIds) { areaMap.set(id, 0); perimMap.set(id, 0); }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sid = labels[idx];
      if (sid <= 0 || !areaMap.has(sid)) continue;
      areaMap.set(sid, areaMap.get(sid) + 1);

      // Check if edge pixel (any 8-neighbour is background)
      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) {
        for (let dx = -1; dx <= 1 && !isEdge; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width || !mask[ny * width + nx]) {
            isEdge = true;
          }
        }
      }
      if (isEdge) {
        perimMap.set(sid, perimMap.get(sid) + 1);
      }
    }
  }

  for (const id of seedIds) {
    const area = areaMap.get(id);
    if (area <= 0) { out.set(id, 1.0); continue; }
    const perim = perimMap.get(id);
    out.set(id, perim > 0 ? (perim * perim) / (4 * Math.PI * area) : 1.0);
  }
  return out;
}

/**
 * Analyse a complete germination time series.
 *
 * @param {Array<{data: Float32Array, width: number, height: number, channels: number}>} images
 *   Pre-loaded images as float RGB [0,1], ordered chronologically.
 * @param {number[]} hours
 *   Elapsed hours for each frame. hours[0] defines the baseline.
 * @param {string} [species='arabidopsis']
 * @param {number} [kSigma=6.0]
 * @param {number|null} [pxPerMm=null]
 * @returns {SeriesResult}
 */
export function analyseSeries(images, hours, species = 'arabidopsis', kSigma = 6.0, pxPerMm = null) {
  if (images.length === 0) throw new Error('No images provided');
  const nFrames = images.length;
  const { width, height } = images[0];

  const result = {
    hours: [...hours],
    seeds: [],
    tracks: [],
    scale: null,
    backgrounds: [],
    shifts: [],
    offsets: [],
    orphanFraction: [],
    anchorsOnForeground: [],
    maxSeedsPerComponent: [],
    masks: [],
    assignments: [],
  };

  // ─── Step 1: Segment all frames ──────────────────────────────────────
  const masks = [];
  const centroids = [];

  for (let f = 0; f < nFrames; f++) {
    const img = images[f];
    const { mask, model } = foreground_mask(img, null, kSigma);
    masks.push(mask);
    result.backgrounds.push(model);

    // Extract centroids for registration
    const { labels, numLabels } = labelConnectedComponents(mask, width, height);
    const pts = [];
    if (numLabels > 0) {
      const sumY = new Float64Array(numLabels + 1);
      const sumX = new Float64Array(numLabels + 1);
      const counts = new Int32Array(numLabels + 1);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const lab = labels[y * width + x];
          if (lab > 0) {
            sumY[lab] += y;
            sumX[lab] += x;
            counts[lab]++;
          }
        }
      }
      for (let i = 1; i <= numLabels; i++) {
        if (counts[i] >= 20) {
          pts.push([sumY[i] / counts[i], sumX[i] / counts[i]]);
        }
      }
    }
    centroids.push(pts);
  }
  result.masks = masks;

  // ─── Step 2: Scale calibration from first frame ─────────────────────
  const { labels: lab0, numLabels: n0 } = labelConnectedComponents(masks[0], width, height);
  const areas0 = [];
  if (n0 > 0) {
    const counts0 = new Int32Array(n0 + 1);
    for (let i = 0; i < width * height; i++) {
      if (lab0[i] > 0) counts0[lab0[i]]++;
    }
    for (let i = 1; i <= n0; i++) {
      if (counts0[i] >= 20) areas0.push(counts0[i]);
    }
  }
  if (areas0.length === 0) throw new Error('No seeds found in the first frame');

  const scale = fit_scale(areas0, species, pxPerMm);
  result.scale = scale;

  // ─── Step 3: Clean t₀ mask and build seed registry ──────────────────
  const clean0 = new Uint8Array(width * height);
  if (n0 > 0) {
    const counts0 = new Int32Array(n0 + 1);
    for (let i = 0; i < width * height; i++) {
      if (lab0[i] > 0) counts0[lab0[i]]++;
    }
    for (let i = 0; i < width * height; i++) {
      if (lab0[i] > 0 && counts0[lab0[i]] >= DEBRIS_AREA * scale.seed_area_px) {
        clean0[i] = 1;
      }
    }
  }

  const seeds = buildRegistry(clean0, width, height, scale);
  result.seeds = seeds;
  if (seeds.length === 0) return new SeriesResult(result);

  // ─── Step 4: Register series ────────────────────────────────────────
  const shifts = register_series(centroids, scale.seed_diameter_px, REGISTRATION_SEARCH_DIAMETERS);
  const offsets = chain_shifts(shifts);
  result.offsets = offsets;
  result.shifts = shifts;

  // ─── Step 5: Track and collect features ─────────────────────────────
  const seedIds = seeds.map(s => s.seed_id);
  const areaSeries = {};
  const reachSeries = {};
  const elongSeries = {};
  const greenSeries = {};
  for (const sid of seedIds) {
    areaSeries[sid] = new Float64Array(nFrames);
    reachSeries[sid] = new Float64Array(nFrames);
    elongSeries[sid] = new Float64Array(nFrames);
    greenSeries[sid] = new Float64Array(nFrames);
  }

  let previous = null;
  for (let f = 0; f < nFrames; f++) {
    const step = f === 0 ? [0, 0] : [
      offsets[f][0] - offsets[f - 1][0],
      offsets[f][1] - offsets[f - 1][1],
    ];

    const assignment = assignFrame(
      masks[f], width, height, seeds, offsets[f], scale,
      previous, step
    );
    previous = assignment.labels;
    result.assignments.push(assignment);
    result.orphanFraction.push(assignment.orphan_fraction);
    result.anchorsOnForeground.push(assignment.anchors_on_foreground);
    result.maxSeedsPerComponent.push(assignment.max_seeds_per_component);

    const elong = _elongation(masks[f], assignment.labels, width, height, seedIds);
    const green = _greenFraction(images[f].data, assignment.labels, width, height, seedIds);

    for (const sid of seedIds) {
      areaSeries[sid][f] = assignment.areas.get(sid) || 0;
      reachSeries[sid][f] = assignment.reaches.get(sid) || 0;
      elongSeries[sid][f] = elong.get(sid) || 1.0;
      greenSeries[sid][f] = green.get(sid) || 0;
    }
  }

  // ─── Step 6: Score each seed ────────────────────────────────────────
  const tracks = [];
  for (const s of seeds) {
    const sid = s.seed_id;
    const a0 = Math.max(areaSeries[sid][0], 1);
    const r0 = Math.max(reachSeries[sid][0], 1);
    const e0 = Math.max(elongSeries[sid][0], 1e-6);

    // Normalise to t₀
    const areaNorm = new Float64Array(nFrames);
    const reachNorm = new Float64Array(nFrames);
    const elongNorm = new Float64Array(nFrames);
    const greenArr = new Float64Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      areaNorm[f] = areaSeries[sid][f] / a0;
      reachNorm[f] = reachSeries[sid][f] / r0;
      elongNorm[f] = elongSeries[sid][f] / e0;
      greenArr[f] = greenSeries[sid][f];
    }

    const scores = frame_scores(areaNorm, reachNorm, elongNorm, greenArr);
    const tr = call_onset(scores);

    tracks.push(new SeedTrack(
      sid, tr.scores, tr.onset_index, tr.confidence, tr.germinated
    ));
  }
  result.tracks = tracks;

  return new SeriesResult(result);
}
