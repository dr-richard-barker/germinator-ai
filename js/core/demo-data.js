/**
 * demo-data.js — Generates a synthetic 6-frame Arabidopsis-like
 * germination demo dataset entirely in-browser using Canvas 2D.
 *
 * Each frame shows ~40 seeds on a blue filter paper background.
 * Seeds progressively germinate: area increases, shape elongates,
 * and a white "radicle" protrudes. The timing follows a Hill-curve
 * (sigmoidal) profile matching typical Arabidopsis germination at 22°C.
 *
 * This is used to demonstrate the pipeline without needing real images.
 */

const WIDTH = 800;
const HEIGHT = 600;
const N_SEEDS = 42;
const N_FRAMES = 6;
const HOURS = [0, 6, 12, 18, 24, 36]; // typical Arabidopsis time course

/**
 * Seeded PRNG (Mulberry32) for reproducibility.
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Hill function: fraction germinated at time t.
 * @param {number} t - hours
 * @param {number} b - slope (Hill coefficient)
 * @param {number} c - t50 (inflection point)
 * @returns {number} fraction [0, 1]
 */
function hillFraction(t, b = 4, c = 14) {
  if (t <= 0) return 0;
  const tb = Math.pow(t, b);
  const cb = Math.pow(c, b);
  return tb / (cb + tb);
}

/**
 * Generate the demo dataset.
 * @returns {{ images: Array<{data: Float32Array, width: number, height: number, channels: number}>, hours: number[], metadata: object }}
 */
export function generateDemoDataset() {
  const rng = mulberry32(42);

  // Generate seed positions (non-overlapping circles on a grid-ish layout)
  const seeds = [];
  const seedRadius = 10; // px
  const margin = 40;

  for (let i = 0; i < N_SEEDS; i++) {
    let attempts = 0;
    let x, y, ok;
    do {
      x = margin + rng() * (WIDTH - 2 * margin);
      y = margin + rng() * (HEIGHT - 2 * margin);
      ok = true;
      for (const s of seeds) {
        const dx = x - s.x, dy = y - s.y;
        if (Math.sqrt(dx * dx + dy * dy) < seedRadius * 3.5) { ok = false; break; }
      }
      attempts++;
    } while (!ok && attempts < 200);

    if (ok) {
      // Each seed gets an individual germination time (drawn from a distribution)
      const t50_seed = 12 + rng() * 8; // t50 between 12-20h
      const will_germinate = rng() < 0.85; // 85% final germination
      const angle = rng() * Math.PI * 2; // radicle direction

      seeds.push({
        x, y,
        radius: seedRadius * (0.85 + rng() * 0.3),
        t50: t50_seed,
        will_germinate,
        angle,
        // Seed coat colour variation
        r: 0.55 + rng() * 0.15,
        g: 0.40 + rng() * 0.10,
        b: 0.30 + rng() * 0.10,
      });
    }
  }

  // Generate frames
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const images = [];

  for (let f = 0; f < N_FRAMES; f++) {
    const t = HOURS[f];

    // Blue filter paper background with subtle texture
    ctx.fillStyle = '#4a7cb5'; // CoSE blue-ish filter paper
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Add noise texture to background
    const bgData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const noiseRng = mulberry32(f * 1000 + 7);
    for (let i = 0; i < bgData.data.length; i += 4) {
      const noise = (noiseRng() - 0.5) * 20;
      bgData.data[i] = Math.max(0, Math.min(255, bgData.data[i] + noise));
      bgData.data[i + 1] = Math.max(0, Math.min(255, bgData.data[i + 1] + noise));
      bgData.data[i + 2] = Math.max(0, Math.min(255, bgData.data[i + 2] + noise));
    }
    ctx.putImageData(bgData, 0, 0);

    // Draw each seed
    for (const seed of seeds) {
      const germFrac = seed.will_germinate ? hillFraction(t, 4, seed.t50) : 0;

      // Seed body (brown ellipse, slightly swelling with germination)
      const swell = 1.0 + germFrac * 0.15;
      const rx = seed.radius * swell;
      const ry = seed.radius * swell * (1.0 + germFrac * 0.3);

      ctx.save();
      ctx.translate(seed.x, seed.y);
      ctx.rotate(seed.angle);

      // Seed coat
      const seedR = Math.round(seed.r * 255);
      const seedG = Math.round(seed.g * 255);
      const seedB = Math.round(seed.b * 255);
      ctx.fillStyle = `rgb(${seedR}, ${seedG}, ${seedB})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Subtle seed coat highlight
      const highlight = ctx.createRadialGradient(-rx * 0.3, -ry * 0.3, 0, 0, 0, rx);
      highlight.addColorStop(0, 'rgba(255,255,255,0.15)');
      highlight.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Radicle (white protrusion) — only if germinating
      if (germFrac > 0.1) {
        const radicleLen = germFrac * seed.radius * 2.5;
        const radicleWidth = seed.radius * 0.35 * (1 + germFrac * 0.3);

        ctx.fillStyle = `rgba(230, 235, 220, ${0.7 + germFrac * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(0, ry + radicleLen * 0.4, radicleWidth, radicleLen * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Green cotyledons for late-stage
      if (germFrac > 0.7 && seed.will_germinate) {
        const greenIntensity = (germFrac - 0.7) / 0.3;
        ctx.fillStyle = `rgba(76, 175, 80, ${greenIntensity * 0.6})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // Read pixels and convert to Float32 RGB [0,1]
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const floatData = new Float32Array(WIDTH * HEIGHT * 3);
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
      floatData[j] = imageData.data[i] / 255;
      floatData[j + 1] = imageData.data[i + 1] / 255;
      floatData[j + 2] = imageData.data[i + 2] / 255;
    }

    images.push({
      data: floatData,
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
    });
  }

  return {
    images,
    hours: [...HOURS],
    metadata: {
      source: 'synthetic-demo',
      species: 'arabidopsis',
      n_seeds: seeds.length,
      description: 'Synthetic 6-frame Arabidopsis germination time-series for pipeline demonstration',
      seed_positions: seeds.map(s => ({ x: s.x, y: s.y, t50: s.t50.toFixed(1), germinated: s.will_germinate })),
    },
  };
}
