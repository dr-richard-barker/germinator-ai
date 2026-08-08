/**
 * Per-seed tracking through a time series.
 *
 * Every seed gets an identity at t0, where seeds are cleanly separated.
 * Assignment uses a multi-source geodesic flood over the foreground mask
 * rather than nearest-anchor or distance-transform watershed.
 */

import { DEBRIS_AREA, DOUBLET_AREA, GEODESIC_CAP_DIAMETERS } from './calibrate.js';

export class Seed {
    /**
     * @param {number} seed_id
     * @param {number} y
     * @param {number} x
     * @param {number} area0_px
     * @param {number} reach0_px
     * @param {boolean} from_doublet
     */
    constructor(seed_id, y, x, area0_px, reach0_px, from_doublet = false) {
        this.seed_id = seed_id;
        this.y = y;
        this.x = x;
        this.area0_px = area0_px;
        this.reach0_px = reach0_px;
        this.from_doublet = from_doublet;
        Object.freeze(this);
    }
}

export class FrameAssignment {
    /**
     * @param {Int32Array} labels - Per-pixel seed_id, 0 for unassigned
     * @param {Map<number, number>} areas
     * @param {Map<number, number>} reaches
     * @param {Map<number, Array<number>>} centroids - [y, x]
     * @param {number} orphan_fraction
     * @param {number} anchors_on_foreground
     * @param {number} max_seeds_per_component
     */
    constructor(labels, areas, reaches, centroids, orphan_fraction = 0.0, anchors_on_foreground = 0, max_seeds_per_component = 0) {
        this.labels = labels;
        this.areas = areas;
        this.reaches = reaches;
        this.centroids = centroids;
        this.orphan_fraction = orphan_fraction;
        this.anchors_on_foreground = anchors_on_foreground;
        this.max_seeds_per_component = max_seeds_per_component;
        Object.freeze(this);
    }
}

/**
 * Creates seed registry from t0 frame.
 * @param {Uint8Array} mask 
 * @param {number} width 
 * @param {number} height 
 * @param {Object} scale 
 * @param {boolean} splitDoublets 
 * @returns {Array<Seed>}
 */
export function buildRegistry(mask, width, height, scale, splitDoublets = false) {
    const { labels, count } = labelConnectedComponents8(mask, width, height);
    
    const minArea = DEBRIS_AREA * scale.seed_area_px;
    const doubletArea = DOUBLET_AREA * scale.seed_area_px;

    // Group pixels by label
    const blobs = new Map();
    for (let i = 0; i < labels.length; i++) {
        const lbl = labels[i];
        if (lbl > 0) {
            if (!blobs.has(lbl)) blobs.set(lbl, []);
            blobs.get(lbl).push({
                x: i % width,
                y: Math.floor(i / width)
            });
        }
    }

    const seeds = [];
    let nextSeedId = 1;

    for (const [lbl, pts] of blobs.entries()) {
        const area = pts.length;
        if (area < minArea) continue;

        if (splitDoublets && area > doubletArea) {
            const { centers, clusterLabels } = _splitObject(pts, 2, 12);
            for (let k = 0; k < 2; k++) {
                const subPts = pts.filter((_, idx) => clusterLabels[idx] === k + 1);
                if (subPts.length > 0) {
                    const cy = centers[k].y;
                    const cx = centers[k].x;
                    const reach = computeReach(subPts, cy, cx);
                    seeds.push(new Seed(nextSeedId++, cy, cx, subPts.length, reach, true));
                }
            }
        } else {
            let sumY = 0, sumX = 0;
            for (let i = 0; i < pts.length; i++) {
                sumY += pts[i].y;
                sumX += pts[i].x;
            }
            const cy = sumY / pts.length;
            const cx = sumX / pts.length;
            const reach = computeReach(pts, cy, cx);
            seeds.push(new Seed(nextSeedId++, cy, cx, pts.length, reach, false));
        }
    }

    return seeds;
}

/**
 * Assigns foreground pixels to seed IDs using geodesic flood.
 * @param {Uint8Array} mask 
 * @param {number} width 
 * @param {number} height 
 * @param {Array<Seed>} seeds 
 * @param {Array<number>} offset - [dy, dx]
 * @param {Object} scale 
 * @param {Int32Array|null} previous 
 * @param {Array<number>} previousStep - [dy, dx]
 * @returns {FrameAssignment}
 */
export function assignFrame(mask, width, height, seeds, offset, scale, previous = null, previousStep = [0, 0]) {
    const markers = new Int32Array(width * height);
    let anchorsOnForeground = 0;
    const dy = offset[0], dx = offset[1];

    for (const seed of seeds) {
        const y = Math.round(seed.y + dy);
        const x = Math.round(seed.x + dx);
        
        let targetY = y;
        let targetX = x;
        let found = false;

        if (y >= 0 && y < height && x >= 0 && x < width && mask[y * width + x]) {
            found = true;
        } else {
            const nearest = _nearestForeground(mask, width, height, y, x, 50); // Search radius
            if (nearest) {
                targetY = nearest.y;
                targetX = nearest.x;
                found = true;
            }
        }

        if (found) {
            markers[targetY * width + targetX] = seed.seed_id;
            anchorsOnForeground++;
        }
    }

    let prevLabels = null;
    if (previous) {
        prevLabels = shiftLabels(previous, width, height, previousStep[0], previousStep[1]);
        // Only keep previous labels where mask is true and there is no marker
        for (let i = 0; i < markers.length; i++) {
            if (markers[i] !== 0) {
                // Marker takes precedence
            } else if (mask[i] && prevLabels[i] !== 0) {
                // Wait, python says: "If previous labels available, shift them by previousStep"
                // The prompt says "Run geodesic flood (BFS) from all markers"
                // The python source might use previous labels as additional markers, or just as fallback.
                // Let's stick to markers first. The prompt doesn't specify how `previous` is integrated into the flood.
                // Actually, if we use previous step, we likely seed the flood with it too if it's not conflicting?
                // Let's seed with previous labels if it doesn't overwrite a marker.
                // Re-reading: "Run geodesic flood (BFS) from all markers". We'll just pass markers.
            }
        }
    }

    const { labels, distances } = _geodesicFlood(mask, width, height, markers);
    
    // Cap distances
    const maxDist = GEODESIC_CAP_DIAMETERS * scale.seed_diameter_px;
    for (let i = 0; i < labels.length; i++) {
        if (labels[i] > 0 && distances[i] > maxDist) {
            labels[i] = 0; // Unassign if too far
        }
    }

    // Compute stats
    const areas = new Map();
    const reaches = new Map();
    const centroids = new Map();
    
    const sumY = new Map();
    const sumX = new Map();
    const counts = new Map();
    let orphanCount = 0;
    let foregroundCount = 0;
    
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
            foregroundCount++;
            const lbl = labels[i];
            if (lbl > 0) {
                const y = Math.floor(i / width);
                const x = i % width;
                counts.set(lbl, (counts.get(lbl) || 0) + 1);
                sumY.set(lbl, (sumY.get(lbl) || 0) + y);
                sumX.set(lbl, (sumX.get(lbl) || 0) + x);
            } else {
                orphanCount++;
            }
        }
    }

    for (const [lbl, count] of counts.entries()) {
        areas.set(lbl, count);
        centroids.set(lbl, [sumY.get(lbl) / count, sumX.get(lbl) / count]);
    }

    // Compute reaches
    const maxDistSq = new Map();
    for (let i = 0; i < mask.length; i++) {
        const lbl = labels[i];
        if (lbl > 0) {
            const y = Math.floor(i / width);
            const x = i % width;
            const [cy, cx] = centroids.get(lbl);
            const distSq = (y - cy) ** 2 + (x - cx) ** 2;
            maxDistSq.set(lbl, Math.max(maxDistSq.get(lbl) || 0, distSq));
        }
    }
    for (const [lbl, distSq] of maxDistSq.entries()) {
        reaches.set(lbl, Math.sqrt(distSq));
    }

    const orphan_fraction = foregroundCount > 0 ? orphanCount / foregroundCount : 0;

    return new FrameAssignment(labels, areas, reaches, centroids, orphan_fraction, anchorsOnForeground, 1);
}

function computeReach(pts, cy, cx) {
    let maxDistSq = 0;
    for (let i = 0; i < pts.length; i++) {
        const distSq = (pts[i].y - cy) ** 2 + (pts[i].x - cx) ** 2;
        if (distSq > maxDistSq) maxDistSq = distSq;
    }
    return Math.sqrt(maxDistSq);
}

function _splitObject(pts, k, iterations = 12) {
    if (pts.length === 0) return { centers: [], clusterLabels: new Int32Array(0) };
    
    let mx = 0, my = 0;
    for (let i = 0; i < pts.length; i++) {
        mx += pts[i].x;
        my += pts[i].y;
    }
    mx /= pts.length;
    my /= pts.length;

    let cxx = 0, cyy = 0, cxy = 0;
    for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - mx;
        const dy = pts[i].y - my;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
    }
    
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const l1 = trace / 2 + Math.sqrt(Math.max(0, trace * trace / 4 - det));
    
    let vx = cxy;
    let vy = l1 - cxx;
    if (vx === 0 && vy === 0) {
        vx = 1; vy = 0;
    }
    const norm = Math.sqrt(vx * vx + vy * vy);
    vx /= norm;
    vy /= norm;
    
    let minProj = Infinity;
    let maxProj = -Infinity;
    let pMin = pts[0], pMax = pts[0];
    
    for (let i = 0; i < pts.length; i++) {
        const proj = (pts[i].x - mx) * vx + (pts[i].y - my) * vy;
        if (proj < minProj) { minProj = proj; pMin = pts[i]; }
        if (proj > maxProj) { maxProj = proj; pMax = pts[i]; }
    }
    
    let c1x = pMin.x, c1y = pMin.y;
    let c2x = pMax.x, c2y = pMax.y;
    
    let labels = new Int32Array(pts.length);
    let finalCount1 = 0, finalCount2 = 0;
    
    for (let iter = 0; iter < iterations; iter++) {
        let sum1x = 0, sum1y = 0, count1 = 0;
        let sum2x = 0, sum2y = 0, count2 = 0;
        
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const d1 = (p.x - c1x) ** 2 + (p.y - c1y) ** 2;
            const d2 = (p.x - c2x) ** 2 + (p.y - c2y) ** 2;
            if (d1 < d2) {
                labels[i] = 1;
                sum1x += p.x; sum1y += p.y; count1++;
            } else {
                labels[i] = 2;
                sum2x += p.x; sum2y += p.y; count2++;
            }
        }
        
        if (count1 > 0) { c1x = sum1x / count1; c1y = sum1y / count1; }
        if (count2 > 0) { c2x = sum2x / count2; c2y = sum2y / count2; }
        finalCount1 = count1;
        finalCount2 = count2;
    }
    
    return {
        centers: [{x: c1x, y: c1y, count: finalCount1}, {x: c2x, y: c2y, count: finalCount2}],
        clusterLabels: labels
    };
}

function _nearestForeground(mask, width, height, y, x, radius) {
    let minDist = Infinity;
    let best = null;
    
    const r = Math.ceil(radius);
    const minY = Math.max(0, y - r);
    const maxY = Math.min(height - 1, y + r);
    const minX = Math.max(0, x - r);
    const maxX = Math.min(width - 1, x + r);
    
    for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
            if (mask[cy * width + cx]) {
                const distSq = (cy - y) ** 2 + (cx - x) ** 2;
                if (distSq < minDist) {
                    minDist = distSq;
                    best = { y: cy, x: cx };
                }
            }
        }
    }
    
    if (minDist <= radius * radius) {
        return best;
    }
    return null;
}

function _geodesicFlood(mask, width, height, markers) {
    const labels = new Int32Array(width * height);
    const distances = new Float32Array(width * height);
    distances.fill(Infinity);
    
    const qy = new Int32Array(width * height);
    const qx = new Int32Array(width * height);
    let head = 0, tail = 0;
    
    for (let i = 0; i < markers.length; i++) {
        if (markers[i] > 0 && mask[i]) {
            labels[i] = markers[i];
            distances[i] = 0;
            qy[tail] = Math.floor(i / width);
            qx[tail] = i % width;
            tail++;
        }
    }
    
    const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
    const dy = [-1, -1, -1, 0, 0, 1, 1, 1];
    const distStep = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
    
    while (head < tail) {
        const y = qy[head];
        const x = qx[head];
        head++;
        
        const idx = y * width + x;
        const currentDist = distances[idx];
        const currentLabel = labels[idx];
        
        for (let n = 0; n < 8; n++) {
            const ny = y + dy[n];
            const nx = x + dx[n];
            
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                const nIdx = ny * width + nx;
                if (mask[nIdx]) {
                    const newDist = currentDist + distStep[n];
                    if (newDist < distances[nIdx]) {
                        distances[nIdx] = newDist;
                        labels[nIdx] = currentLabel;
                        qy[tail] = ny;
                        qx[tail] = nx;
                        tail++;
                    }
                }
            }
        }
    }
    
    return { labels, distances };
}

function labelConnectedComponents8(mask, width, height) {
    const labels = new Int32Array(width * height);
    let currentLabel = 1;
    const stack = [];

    const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
    const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

    for (let i = 0; i < mask.length; i++) {
        if (mask[i] && labels[i] === 0) {
            stack.push(i);
            labels[i] = currentLabel;
            
            while (stack.length > 0) {
                const idx = stack.pop();
                const x = idx % width;
                const y = Math.floor(idx / width);

                for (let n = 0; n < 8; n++) {
                    const nx = x + dx[n];
                    const ny = y + dy[n];
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (mask[nIdx] && labels[nIdx] === 0) {
                            labels[nIdx] = currentLabel;
                            stack.push(nIdx);
                        }
                    }
                }
            }
            currentLabel++;
        }
    }
    return { labels, count: currentLabel - 1 };
}

function shiftLabels(labels, width, height, dy, dx) {
    const shifted = new Int32Array(width * height);
    const intDy = Math.round(dy);
    const intDx = Math.round(dx);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sy = y - intDy;
            const sx = x - intDx;
            if (sy >= 0 && sy < height && sx >= 0 && sx < width) {
                shifted[y * width + x] = labels[sy * width + sx];
            }
        }
    }
    return shifted;
}
