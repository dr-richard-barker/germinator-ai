/**
 * Connected-component extraction with ImageJ-compatible shape measurements.
 * Ported from Python source objects.py.
 */

import { mean, sum, max, min } from './math-utils.js';

const _SQRT2 = Math.sqrt(2.0);

// Marching-squares direction constants
const _R = 0, _D = 1, _L = 2, _U = 3;
const _STEP = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const _SADDLE = {
    6: { [_R]: _U, [_L]: _D },
    9: { [_U]: _L, [_D]: _R },
};
const _NEXT_DIR = [
    null, _R, _D, _R, _U, _U, null, _U,
    _L, null, _D, _R, _L, _L, _D, null,
];

/**
 * ImageJ-compatible shape measurements.
 */
export class ObjectMeasurements {
    /**
     * @param {number} label 
     * @param {number} area_px 
     * @param {number} x 
     * @param {number} y 
     * @param {number} perimeter_px 
     * @param {number} circularity 
     * @param {number} aspect_ratio 
     * @param {number} roundness 
     * @param {number} solidity 
     */
    constructor(label, area_px, x, y, perimeter_px, circularity, aspect_ratio, roundness, solidity) {
        this._label = label;
        this._area_px = area_px;
        this._x = x;
        this._y = y;
        this._perimeter_px = perimeter_px;
        this._circularity = circularity;
        this._aspect_ratio = aspect_ratio;
        this._roundness = roundness;
        this._solidity = solidity;
        Object.freeze(this);
    }

    get label() { return this._label; }
    get area_px() { return this._area_px; }
    get x() { return this._x; }
    get y() { return this._y; }
    get perimeter_px() { return this._perimeter_px; }
    get circularity() { return this._circularity; }
    get aspect_ratio() { return this._aspect_ratio; }
    get roundness() { return this._roundness; }
    get solidity() { return this._solidity; }
    
    get equivalent_diameter_px() { 
        return 2.0 * Math.sqrt(this._area_px / Math.PI); 
    }
}

/**
 * Label connected components (8-connected)
 * @param {Uint8Array} mask 
 * @param {number} width 
 * @param {number} height 
 * @returns {{labels: Int32Array, numLabels: number}}
 */
export function labelConnectedComponents(mask, width, height) {
    const labels = new Int32Array(width * height);
    let numLabels = 0;
    const stack = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (mask[idx] && labels[idx] === 0) {
                numLabels++;
                labels[idx] = numLabels;
                stack.push(x, y);

                while (stack.length > 0) {
                    const cy = stack.pop();
                    const cx = stack.pop();

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = cx + dx;
                            const ny = cy + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = ny * width + nx;
                                if (mask[nidx] && labels[nidx] === 0) {
                                    labels[nidx] = numLabels;
                                    stack.push(nx, ny);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    return { labels, numLabels };
}

/**
 * Flood from edges to find exterior, then invert.
 * @param {Uint8Array} sub 
 * @param {number} width 
 * @param {number} height 
 * @returns {Uint8Array}
 */
export function binaryFillHoles(sub, width, height) {
    const filled = new Uint8Array(width * height);
    const stack = [];

    // Initialize edges
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                if (sub[y * width + x] === 0) {
                    filled[y * width + x] = 2; // Temporary background marker
                    stack.push(x, y);
                }
            }
        }
    }

    // Flood fill background
    while (stack.length > 0) {
        const cy = stack.pop();
        const cx = stack.pop();

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (Math.abs(dx) + Math.abs(dy) !== 1) continue; // 4-connected for background
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nidx = ny * width + nx;
                    if (sub[nidx] === 0 && filled[nidx] === 0) {
                        filled[nidx] = 2;
                        stack.push(nx, ny);
                    }
                }
            }
        }
    }

    // Invert the filled mask to get filled holes + object
    for (let i = 0; i < filled.length; i++) {
        filled[i] = filled[i] === 2 ? 0 : 1;
    }
    return filled;
}

/**
 * Trace boundary using marching squares
 * @param {Uint8Array} mask_data 
 * @param {number} width 
 * @param {number} height 
 * @returns {number[][]}
 */
export function trace_boundary(mask_data, width, height) {
    let start_x = -1, start_y = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (mask_data[y * width + x]) {
                start_x = x;
                start_y = y;
                break;
            }
        }
        if (start_x !== -1) break;
    }
    if (start_x === -1) return [];

    let cx = start_x, cy = start_y;
    let dir = _R;
    const initial_state = `${cx},${cy},${dir}`;
    const verts = [[cx, cy]];
    
    while (true) {
        cx += _STEP[dir][0];
        cy += _STEP[dir][1];
        
        let p_tl = (cy - 1 >= 0 && cx - 1 >= 0) ? mask_data[(cy - 1) * width + cx - 1] : 0;
        let p_tr = (cy - 1 >= 0 && cx < width) ? mask_data[(cy - 1) * width + cx] : 0;
        let p_bl = (cy < height && cx - 1 >= 0) ? mask_data[cy * width + cx - 1] : 0;
        let p_br = (cy < height && cx < width) ? mask_data[cy * width + cx] : 0;
        
        let state = (p_tl << 3) | (p_tr << 2) | (p_br << 1) | p_bl;
        let next_dir = _NEXT_DIR[state];
        
        if (next_dir === null) {
            if (_SADDLE[state] !== undefined) {
                next_dir = _SADDLE[state][dir];
            } else {
                break;
            }
        }
        dir = next_dir;
        
        if (`${cx},${cy},${dir}` === initial_state) {
            break;
        }
        verts.push([cx, cy]);
    }
    
    return verts;
}

/**
 * @param {number[][]} verts 
 * @returns {number[][]}
 */
export function collapse_collinear(verts) {
    if (verts.length <= 2) return verts.slice();
    const result = [verts[0]];
    for (let i = 1; i < verts.length; i++) {
        const prev = result[result.length - 1];
        const curr = verts[i];
        const next = verts[(i + 1) % verts.length];
        
        const dx1 = curr[0] - prev[0];
        const dy1 = curr[1] - prev[1];
        const dx2 = next[0] - curr[0];
        const dy2 = next[1] - curr[1];
        
        if (dx1 * dy2 !== dy1 * dx2) {
            result.push(curr);
        }
    }
    return result;
}

/**
 * @param {number[][]} verts 
 * @returns {number}
 */
export function traced_perimeter(verts) {
    if (verts.length <= 1) return 0;
    
    let peri = 0;
    let nCorners = verts.length; // Approximating alternating corners
    
    for (let i = 0; i < verts.length; i++) {
        const p1 = verts[i];
        const p2 = verts[(i + 1) % verts.length];
        const dx = Math.abs(p2[0] - p1[0]);
        const dy = Math.abs(p2[1] - p1[1]);
        peri += dx + dy; // Manhattan length of edges
    }
    
    return peri + nCorners * (1 - _SQRT2);
}

/**
 * @param {number[]} ys 
 * @param {number[]} xs 
 * @param {number} area 
 * @returns {number[]}
 */
export function _ellipse_axes(ys, xs, area) {
    let sum_x = 0, sum_y = 0;
    for (let i = 0; i < xs.length; i++) {
        sum_x += xs[i];
        sum_y += ys[i];
    }
    const xm = sum_x / xs.length;
    const ym = sum_y / ys.length;

    let u20 = 0, u02 = 0, u11 = 0;
    for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - xm;
        const dy = ys[i] - ym;
        u20 += dx * dx;
        u02 += dy * dy;
        u11 += dx * dy;
    }
    u20 = u20 / area + 1 / 12;
    u02 = u02 / area + 1 / 12;
    u11 = u11 / area;
    
    const term = Math.sqrt((u20 - u02) * (u20 - u02) + 4 * u11 * u11);
    const a = Math.sqrt(2 * (u20 + u02 + term));
    const b = Math.sqrt(2 * Math.max(0, u20 + u02 - term));
    
    const factor = Math.sqrt(area / (Math.PI * a * b || 1));
    return [a * factor * 2, b * factor * 2];
}

/**
 * @param {number[][]} vertices 
 * @returns {number}
 */
export function _convex_area(vertices) {
    if (vertices.length < 3) return 0;
    const pts = vertices.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    
    const lower = [];
    for (let i = 0; i < pts.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
            lower.pop();
        }
        lower.push(pts[i]);
    }
    
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
            upper.pop();
        }
        upper.push(pts[i]);
    }
    
    upper.pop();
    lower.pop();
    const hull = lower.concat(upper);
    
    let area = 0;
    for (let i = 0; i < hull.length; i++) {
        const p1 = hull[i];
        const p2 = hull[(i + 1) % hull.length];
        area += p1[0] * p2[1] - p2[0] * p1[1];
    }
    return Math.abs(area / 2);
}

/**
 * Label connected components (8-connected) and measure each.
 * @param {Uint8Array} mask_data 
 * @param {number} width 
 * @param {number} height 
 * @param {number} min_area_px 
 * @param {number} max_area_px 
 * @param {boolean} exclude_edges 
 * @param {boolean} include_holes 
 * @returns {ObjectMeasurements[]}
 */
export function measure(mask_data, width, height, min_area_px = 1, max_area_px = null, exclude_edges = true, include_holes = true) {
    const { labels, numLabels } = labelConnectedComponents(mask_data, width, height);
    const results = [];
    
    for (let label = 1; label <= numLabels; label++) {
        const xs = [], ys = [];
        let is_edge = false;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (labels[y * width + x] === label) {
                    xs.push(x);
                    ys.push(y);
                    if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                        is_edge = true;
                    }
                }
            }
        }
        
        if (exclude_edges && is_edge) continue;
        const area_px = xs.length;
        if (area_px < min_area_px || (max_area_px !== null && area_px > max_area_px)) continue;
        
        let sum_x = 0, sum_y = 0;
        let min_x = Infinity, max_x = -Infinity;
        let min_y = Infinity, max_y = -Infinity;

        for (let i = 0; i < area_px; i++) {
            const x = xs[i], y = ys[i];
            sum_x += x;
            sum_y += y;
            if (x < min_x) min_x = x;
            if (x > max_x) max_x = x;
            if (y < min_y) min_y = y;
            if (y > max_y) max_y = y;
        }

        const xm = sum_x / area_px;
        const ym = sum_y / area_px;
        
        const w = max_x - min_x + 3;
        const h = max_y - min_y + 3;
        
        let sub = new Uint8Array(w * h);
        for (let i = 0; i < xs.length; i++) {
            sub[(ys[i] - min_y + 1) * w + (xs[i] - min_x + 1)] = 1;
        }
        
        if (include_holes) {
            sub = binaryFillHoles(sub, w, h);
        }
        
        const verts = trace_boundary(sub, w, h);
        const collapsed = collapse_collinear(verts);
        const peri = traced_perimeter(collapsed);
        const conv_area = _convex_area(verts);
        const [major, minor] = _ellipse_axes(ys, xs, area_px);
        
        const circularity = peri > 0 ? 4 * Math.PI * area_px / (peri * peri) : 0;
        const aspect_ratio = minor > 0 ? major / minor : 0;
        const roundness = major > 0 ? 4 * area_px / (Math.PI * major * major) : 0;
        const solidity = conv_area > 0 ? area_px / conv_area : 0;
        
        results.push(new ObjectMeasurements(
            label, area_px, xm, ym, peri, circularity, aspect_ratio, roundness, solidity
        ));
    }
    
    return results;
}
