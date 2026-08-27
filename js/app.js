/**
 * app.js — Application orchestrator for Germinator AI.
 *
 * Wires the upload flow (files, ZIP, demo), image loading, pipeline
 * execution, and result rendering together. Entry point for index.html.
 */

import { analyseSeries } from './core/pipeline.js';
import { parametersFromTimes, fitHill, empiricalCurve } from './core/curves.js';
import { canvasToFrame } from './core/frame-utils.js';
import { Uploader } from './ui/uploader.js';
import { generateDemoDataset } from './core/demo-data.js';
import { extractFramesFromVideo } from './ui/video-extractor.js';

// ─── State ────────────────────────────────────────────────────────────────

const state = {
  /** @type {{file: File|Blob, name: string}[]} */
  fileEntries: [],
  /** @type {{data: Float32Array, width: number, height: number, channels: number}[]} */
  images: [],
  /** @type {number[]} */
  hours: [],
  /** @type {import('./core/pipeline.js').SeriesResult|null} */
  result: null,
  /** @type {number} */
  currentFrame: 0,
  /** @type {boolean} */
  playing: false,
  /** @type {number|null} */
  playTimer: null,
  /** @type {string} */
  overlayMode: 'none',
  /** @type {number} */
  overlayOpacity: 0.5,
};

// ─── DOM ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  // Upload
  dropZone:         $('drop-zone'),
  fileInput:        $('file-input'),
  btnBrowse:        $('btn-browse'),
  btnDemo:          $('btn-load-demo'),
  uploadSection:    $('upload-section'),
  workspaceSection: $('workspace-section'),

  // Nav
  btnHome:          $('btn-nav-home'),
  btnGuide:         $('btn-nav-guide'),

  // Viewer
  imageCanvas:      $('image-canvas'),
  overlayCanvas:    $('overlay-canvas'),
  canvasContainer:  $('canvas-container'),

  // Stats
  statSeeds:        $('stat-seeds'),
  statGerminated:   $('stat-germinated'),
  statT50:          $('stat-t50'),
  statUniformity:   $('stat-uniformity'),

  // Chart
  chartCanvas:      $('chart-canvas'),
  hillParams:       $('hill-params'),
  btnExportChart:   $('btn-export-chart'),

  // QC
  qcAnchors:        $('qc-anchors'),
  qcOrphan:         $('qc-orphan'),
  qcMerged:         $('qc-merged'),
  qcSnr:            $('qc-snr'),
  qcAmbiguous:      $('qc-ambiguous'),

  // Timeline
  timelineTrack:    $('timeline-track'),
  timelineFill:     $('timeline-fill'),
  scrubber:         $('timeline-scrubber'),
  frameLabel:       $('frame-label'),
  timeLabel:        $('time-label'),
  btnPlay:          $('btn-play'),
  btnPrev:          $('btn-prev'),
  btnNext:          $('btn-next'),

  // Overlay
  overlayOpacity:   $('overlay-opacity'),
  opacityValue:     $('opacity-value'),

  // Processing
  processingOverlay: $('processing-overlay'),
  processTitle:      $('process-title'),
  processStatus:     $('process-status'),
  progressFill:      $('progress-fill'),

  // Video extraction options
  videoOptionsOverlay: $('video-options-overlay'),
  videoOptionsName:    $('video-options-name'),
  videoFrameCount:     $('video-frame-count'),
  videoTotalHours:     $('video-total-hours'),
  btnVideoCancel:      $('btn-video-cancel'),
  btnVideoExtract:     $('btn-video-extract'),

  // Export
  btnExportCsv:     $('btn-export-csv'),
  btnExportJson:    $('btn-export-json'),
};

// ─── Uploader ─────────────────────────────────────────────────────────────

const uploader = new Uploader(dom.dropZone, dom.fileInput, dom.btnBrowse);

uploader.addEventListener('files-selected', (e) => {
  handleFileEntries(e.detail);
});

uploader.addEventListener('upload-progress', (e) => {
  showProcessing('Extracting ZIP…', e.detail.status);
});

uploader.addEventListener('upload-error', (e) => {
  console.error('Upload error:', e.detail.message);
  alert(e.detail.message);
});

uploader.addEventListener('video-selected', (e) => {
  handleVideoFile(e.detail.file);
});

// Drop zone click (outside the browse button) also triggers file input
dom.dropZone.addEventListener('click', (e) => {
  if (e.target === dom.dropZone || e.target.closest('.drop-zone-content')) {
    if (!e.target.closest('.link-btn')) {
      dom.fileInput.click();
    }
  }
});

// ─── Demo Dataset ─────────────────────────────────────────────────────────

dom.btnDemo.addEventListener('click', async () => {
  showProcessing('Generating demo…', 'Creating synthetic Arabidopsis series');

  // Let UI update before blocking
  await tick();

  const demo = generateDemoDataset();
  state.images = demo.images;
  state.hours = demo.hours;
  state.fileEntries = [];

  transitionToWorkspace();

  updateProcessing('Analysing…', 'Running pipeline on demo data');
  await tick();
  runAnalysis();
});

// ─── File Handling ────────────────────────────────────────────────────────

/**
 * Parse MMDDYY_HHMM filename format.
 */
function parseTimestamp(name) {
  const match = name.match(/(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  if (!match) return null;
  return {
    month: parseInt(match[1], 10),
    day:   parseInt(match[2], 10),
    year:  2000 + parseInt(match[3], 10),
    hour:  parseInt(match[4], 10),
    minute:parseInt(match[5], 10),
  };
}

function timestampsToHours(stamps) {
  const toMinutes = (s) => {
    const d = new Date(s.year, s.month - 1, s.day, s.hour, s.minute);
    return d.getTime() / 60000;
  };
  const mins = stamps.map(toMinutes);
  const t0 = mins[0];
  return mins.map(m => (m - t0) / 60);
}

/**
 * @param {Array<{file: File|Blob, name: string}>} entries
 */
async function handleFileEntries(entries) {
  state.fileEntries = entries;

  // Sort by name
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Parse timestamps
  const stamps = entries.map(e => parseTimestamp(e.name));
  if (stamps.every(s => s !== null)) {
    state.hours = timestampsToHours(stamps);
  } else {
    // Fallback: equal spacing at 6h intervals
    state.hours = entries.map((_, i) => i * 6);
  }

  transitionToWorkspace();

  showProcessing('Loading images…', 'Reading files');
  await loadImages(entries);

  updateProcessing('Analysing…', 'Running segmentation pipeline');
  await tick();
  runAnalysis();
}

async function loadImages(entries) {
  state.images = [];
  for (let i = 0; i < entries.length; i++) {
    updateProcessing('Loading images…', `Image ${i + 1} of ${entries.length}`, (i / entries.length) * 100);
    const img = await loadImage(entries[i].file);
    state.images.push(img);
  }
}

/**
 * Load an image file/blob into float RGB.
 */
function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const frame = canvasToFrame(canvas);
      URL.revokeObjectURL(img.src);
      resolve(frame);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(fileOrBlob);
  });
}

// ─── Video (time-lapse) ─────────────────────────────────────────────────

/**
 * Ask the user how many frames to extract and what real-world time span the
 * video covers, then run extraction and feed the result into the pipeline
 * exactly like a file-based series would.
 * @param {File} file
 */
async function handleVideoFile(file) {
  const opts = await promptVideoOptions(file.name);
  if (!opts) return; // cancelled

  state.fileEntries = [];
  transitionToWorkspace();
  showProcessing('Extracting frames…', `Reading ${file.name}`);
  await tick();

  try {
    const { images, hours } = await extractFramesFromVideo(file, opts, (i, n) => {
      updateProcessing('Extracting frames…', `Frame ${i} of ${n}`, (i / n) * 100);
    });
    state.images = images;
    state.hours = hours;
  } catch (err) {
    console.error('Video extraction failed:', err);
    hideProcessing();
    alert(`Could not extract frames: ${err.message}`);
    resetToUpload();
    return;
  }

  updateProcessing('Analysing…', 'Running segmentation pipeline');
  await tick();
  runAnalysis();
}

/**
 * Show the frame-count / time-span mini-form and resolve with the user's
 * choice, or null if they cancel.
 * @param {string} filename
 * @returns {Promise<{frameCount: number, totalHours: number}|null>}
 */
function promptVideoOptions(filename) {
  return new Promise((resolve) => {
    dom.videoOptionsName.textContent = filename;
    dom.videoOptionsOverlay.classList.remove('hidden');

    const cleanup = () => {
      dom.videoOptionsOverlay.classList.add('hidden');
      dom.btnVideoCancel.removeEventListener('click', onCancel);
      dom.btnVideoExtract.removeEventListener('click', onExtract);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onExtract = () => {
      const frameCount = clamp(parseInt(dom.videoFrameCount.value, 10) || 12, 2, 40);
      const totalHours = clamp(parseFloat(dom.videoTotalHours.value) || 144, 1, 2000);
      cleanup();
      resolve({ frameCount, totalHours });
    };
    dom.btnVideoCancel.addEventListener('click', onCancel);
    dom.btnVideoExtract.addEventListener('click', onExtract);
  });
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ─── Analysis ─────────────────────────────────────────────────────────────

function runAnalysis() {
  try {
    const result = analyseSeries(state.images, state.hours);
    state.result = result;
    hideProcessing();
    displayResults(result);
  } catch (err) {
    console.error('Analysis failed:', err);
    hideProcessing();
    alert(`Analysis failed: ${err.message}`);
    resetToUpload();
  }
}

function displayResults(result) {
  const germTimes = result.germinationTimes();
  const params = parametersFromTimes(germTimes, state.hours);

  dom.statSeeds.textContent = result.nSeeds;
  dom.statGerminated.textContent = `${result.nGerminated ?? '—'}`;
  dom.statT50.textContent = params.t50 != null ? params.t50.toFixed(1) : '—';
  dom.statUniformity.textContent = params.u8416 != null ? params.u8416.toFixed(1) : '—';

  // QC
  const qc = result.qc();
  dom.qcAnchors.textContent = `${((1 - (qc.min_anchor_retention ?? 0)) * 100).toFixed(1)}%`;
  dom.qcOrphan.textContent = `${((qc.max_orphan_fraction ?? 0) * 100).toFixed(1)}%`;
  dom.qcMerged.textContent = qc.max_seeds_per_component ?? '—';
  dom.qcSnr.textContent = (qc.min_registration_snr ?? Infinity) === Infinity ? '—' : qc.min_registration_snr.toFixed(1);
  dom.qcAmbiguous.textContent = qc.ambiguous_seeds ?? '—';

  // Hill fit
  const curve = empiricalCurve(germTimes, state.hours);
  const hill = fitHill(state.hours, Array.from(curve));
  if (hill) {
    dom.hillParams.classList.remove('hidden');
    dom.hillParams.innerHTML = `
      y₀=${hill.y0.toFixed(3)} &nbsp; a=${hill.a.toFixed(3)} &nbsp;
      b=${hill.b.toFixed(2)} &nbsp; c=${hill.c.toFixed(2)} &nbsp;
      R²=${hill.rSquared.toFixed(4)}
    `;
  }

  // Chart
  drawChart(state.hours, curve, hill, params);

  // Timeline
  updateTimeline(0);
  showFrame(0);
}

// ─── Chart ────────────────────────────────────────────────────────────────

const chartOpts = { showEmpirical: true, showHill: false };

function drawChart(hours, curve, hill, params) {
  const canvas = dom.chartCanvas;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = rect.width, h = rect.height;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const pw = w - margin.left - margin.right;
  const ph = h - margin.top - margin.bottom;

  ctx.clearRect(0, 0, w, h);

  // Read theme-aware colours from CSS
  const styles = getComputedStyle(document.documentElement);
  const gridColor = styles.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.06)';
  const axisColor = styles.getPropertyValue('--chart-axis').trim() || 'rgba(0,0,0,0.2)';
  const textColor = styles.getPropertyValue('--chart-text').trim() || '#566478';

  const xMin = 0, xMax = Math.max(...hours) * 1.05;
  const yMin = 0, yMax = 1.05;
  const sx = (v) => margin.left + (v - xMin) / (xMax - xMin) * pw;
  const sy = (v) => margin.top + ph - (v - yMin) / (yMax - yMin) * ph;

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let y = 0; y <= 1; y += 0.25) {
    ctx.beginPath(); ctx.moveTo(sx(xMin), sy(y)); ctx.lineTo(sx(xMax), sy(y)); ctx.stroke();
  }
  const xStep = Math.pow(10, Math.floor(Math.log10(Math.max(xMax / 4, 1))));
  for (let x = 0; x <= xMax; x += xStep) {
    ctx.beginPath(); ctx.moveTo(sx(x), sy(yMin)); ctx.lineTo(sx(x), sy(yMax)); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx(xMin), sy(yMin)); ctx.lineTo(sx(xMax), sy(yMin));
  ctx.moveTo(sx(xMin), sy(yMin)); ctx.lineTo(sx(xMin), sy(yMax));
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = textColor;
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Time (hours)', w / 2, h - 4);
  ctx.save();
  ctx.translate(12, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Cumulative germination', 0, 0);
  ctx.restore();

  // Tick labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = 0; x <= xMax; x += xStep) {
    ctx.fillText(x.toFixed(0), sx(x), sy(yMin) + 6);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = 0; y <= 1; y += 0.25) {
    ctx.fillText((y * 100).toFixed(0) + '%', sx(xMin) - 6, sy(y));
  }

  // Empirical curve
  if (chartOpts.showEmpirical && curve) {
    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < hours.length; i++) {
      const x = sx(hours[i]), yv = sy(curve[i]);
      if (i === 0) ctx.moveTo(x, yv);
      else { ctx.lineTo(x, sy(curve[i - 1])); ctx.lineTo(x, yv); }
    }
    ctx.stroke();

    ctx.fillStyle = '#66bb6a';
    for (let i = 0; i < hours.length; i++) {
      ctx.beginPath(); ctx.arc(sx(hours[i]), sy(curve[i]), 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Hill fit
  if (chartOpts.showHill && hill) {
    ctx.strokeStyle = '#ffb74d';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = xMin + (xMax - xMin) * i / 100;
      const yVal = hill.predict(t);
      const px = sx(t), py = sy(yVal);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // t50 marker
  if (params && params.t50 != null) {
    ctx.strokeStyle = 'rgba(102, 187, 106, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx(params.t50), sy(yMin));
    ctx.lineTo(sx(params.t50), sy(yMax));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(102, 187, 106, 0.7)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`t₅₀ = ${params.t50.toFixed(1)}h`, sx(params.t50) + 4, sy(0.5));
  }
}

function redrawChart() {
  if (!state.result) return;
  const germTimes = state.result.germinationTimes();
  const params = parametersFromTimes(germTimes, state.hours);
  const curve = empiricalCurve(germTimes, state.hours);
  const hill = fitHill(state.hours, Array.from(curve));
  drawChart(state.hours, curve, hill, params);
}

// Chart chip toggles
document.querySelectorAll('[data-curve]').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.curve;
    if (mode === 'empirical') {
      chartOpts.showEmpirical = !chartOpts.showEmpirical;
      btn.classList.toggle('active', chartOpts.showEmpirical);
    } else if (mode === 'hill') {
      chartOpts.showHill = !chartOpts.showHill;
      btn.classList.toggle('active', chartOpts.showHill);
    }
    redrawChart();
  });
});

// ─── Image Viewer & Overlay ───────────────────────────────────────────────

function showFrame(index) {
  if (index < 0 || index >= state.images.length) return;
  state.currentFrame = index;

  const img = state.images[index];
  const imgCanvas = dom.imageCanvas;
  imgCanvas.width = img.width;
  imgCanvas.height = img.height;
  const ctx = imgCanvas.getContext('2d');
  const imageData = ctx.createImageData(img.width, img.height);
  const rgba = imageData.data;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    rgba[i * 4]     = Math.round(img.data[i * 3] * 255);
    rgba[i * 4 + 1] = Math.round(img.data[i * 3 + 1] * 255);
    rgba[i * 4 + 2] = Math.round(img.data[i * 3 + 2] * 255);
    rgba[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  renderOverlay(index);
  updateTimeline(index);
}

function renderOverlay(frameIndex) {
  const ov = dom.overlayCanvas;
  const img = state.images[frameIndex];
  ov.width = img.width;
  ov.height = img.height;
  const ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, ov.width, ov.height);
  ov.style.opacity = state.overlayOpacity;

  if (state.overlayMode === 'none' || !state.result) return;

  const result = state.result;

  if (state.overlayMode === 'mask' && result.masks && result.masks[frameIndex]) {
    const mask = result.masks[frameIndex];
    const imageData = ctx.createImageData(img.width, img.height);
    const rgba = imageData.data;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        rgba[i * 4] = 102; rgba[i * 4 + 1] = 187; rgba[i * 4 + 2] = 106; rgba[i * 4 + 3] = 128;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  if ((state.overlayMode === 'seeds' || state.overlayMode === 'state') && result.assignments && result.assignments[frameIndex]) {
    const labels = result.assignments[frameIndex].labels;
    const imageData = ctx.createImageData(img.width, img.height);
    const rgba = imageData.data;

    const tracks = result.tracks || [];
    const germSet = new Set();
    const uncertainSet = new Set();
    for (const t of tracks) {
      if (t.germinated) germSet.add(t.seed_id);
      if (t.confidence < 0.5) uncertainSet.add(t.seed_id);
    }

    for (let i = 0; i < labels.length; i++) {
      const sid = labels[i];
      if (sid === 0) continue;
      if (state.overlayMode === 'state') {
        if (germSet.has(sid)) { rgba[i*4]=102; rgba[i*4+1]=187; rgba[i*4+2]=106; }
        else if (uncertainSet.has(sid)) { rgba[i*4]=255; rgba[i*4+1]=183; rgba[i*4+2]=77; }
        else { rgba[i*4]=120; rgba[i*4+1]=144; rgba[i*4+2]=156; }
      } else {
        const hue = (sid * 137) % 360;
        const [r, g, b] = hslToRgb(hue / 360, 0.7, 0.5);
        rgba[i*4] = r; rgba[i*4+1] = g; rgba[i*4+2] = b;
      }
      rgba[i * 4 + 3] = 160;
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ─── Overlay Toolbar ──────────────────────────────────────────────────────

document.querySelectorAll('[data-overlay]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.overlayMode = btn.dataset.overlay;
    document.querySelectorAll('[data-overlay]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderOverlay(state.currentFrame);
  });
});

dom.overlayOpacity.addEventListener('input', (e) => {
  state.overlayOpacity = e.target.value / 100;
  dom.opacityValue.textContent = `${e.target.value}%`;
  dom.overlayCanvas.style.opacity = state.overlayOpacity;
});

// ─── Timeline ─────────────────────────────────────────────────────────────

function updateTimeline(index) {
  const n = state.hours.length;
  if (n === 0) return;
  const pct = n === 1 ? 0 : (index / (n - 1)) * 100;
  dom.timelineFill.style.width = `${pct}%`;
  dom.scrubber.style.left = `${pct}%`;
  dom.frameLabel.textContent = `${index + 1} / ${n}`;
  dom.timeLabel.textContent = `${state.hours[index].toFixed(1)} h`;
}

dom.timelineTrack.addEventListener('click', (e) => {
  const rect = dom.timelineTrack.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const idx = Math.round(pct * (state.images.length - 1));
  showFrame(Math.max(0, Math.min(idx, state.images.length - 1)));
});

dom.btnPlay.addEventListener('click', () => {
  state.playing = !state.playing;
  dom.btnPlay.querySelector('.play-icon').classList.toggle('hidden', state.playing);
  dom.btnPlay.querySelector('.pause-icon').classList.toggle('hidden', !state.playing);

  if (state.playing) {
    state.playTimer = setInterval(() => {
      const next = (state.currentFrame + 1) % state.images.length;
      showFrame(next);
    }, 500);
  } else {
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
});

dom.btnPrev.addEventListener('click', () => {
  if (state.images.length === 0) return;
  showFrame(Math.max(0, state.currentFrame - 1));
});

dom.btnNext.addEventListener('click', () => {
  if (state.images.length === 0) return;
  showFrame(Math.min(state.images.length - 1, state.currentFrame + 1));
});

// ─── Export ────────────────────────────────────────────────────────────────

dom.btnExportCsv.addEventListener('click', () => {
  if (!state.result) return;
  const result = state.result;
  const germTimes = result.germinationTimes();
  let csv = 'seed_id,germination_hours,germinated,confidence\n';
  for (let i = 0; i < result.tracks.length; i++) {
    const t = result.tracks[i];
    csv += `${t.seed_id},${germTimes[i] != null ? germTimes[i].toFixed(2) : ''},${t.germinated},${t.confidence.toFixed(3)}\n`;
  }
  downloadFile(csv, 'germination_results.csv', 'text/csv');
});

dom.btnExportJson.addEventListener('click', () => {
  if (!state.result) return;
  const result = state.result;
  const germTimes = result.germinationTimes();
  const params = parametersFromTimes(germTimes, state.hours);
  const data = {
    n_seeds: result.nSeeds,
    germination_times: germTimes,
    parameters: params,
    qc: result.qc(),
    hours: state.hours,
    seeds: result.tracks.map(t => ({
      seed_id: t.seed_id,
      germinated: t.germinated,
      onset_index: t.onset_index,
      confidence: t.confidence,
    })),
  };
  downloadFile(JSON.stringify(data, null, 2), 'germination_results.json', 'application/json');
});

dom.btnExportChart.addEventListener('click', () => {
  const url = dom.chartCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'germination_curve.png';
  a.click();
});

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Navigation ───────────────────────────────────────────────────────────

dom.btnHome.addEventListener('click', resetToUpload);

dom.btnGuide.addEventListener('click', () => {
  if (state.result) {
    resetToUpload();
  }
  // Scroll to tutorial cards
  const tutorial = document.querySelector('.tutorial-section');
  if (tutorial) tutorial.scrollIntoView({ behavior: 'smooth' });
});

// ─── Processing Overlay ───────────────────────────────────────────────────

function showProcessing(title, status, progress = 0) {
  dom.processingOverlay.classList.remove('hidden');
  dom.processTitle.textContent = title;
  dom.processStatus.textContent = status;
  dom.progressFill.style.width = `${progress}%`;
}

function updateProcessing(title, status, progress) {
  dom.processTitle.textContent = title;
  dom.processStatus.textContent = status;
  if (progress != null) dom.progressFill.style.width = `${progress}%`;
}

function hideProcessing() {
  dom.processingOverlay.classList.add('hidden');
}

// ─── State Transitions ───────────────────────────────────────────────────

function transitionToWorkspace() {
  dom.uploadSection.classList.add('hidden');
  dom.workspaceSection.classList.remove('hidden');
}

function resetToUpload() {
  state.fileEntries = [];
  state.images = [];
  state.hours = [];
  state.result = null;
  state.currentFrame = 0;
  state.playing = false;
  if (state.playTimer) clearInterval(state.playTimer);

  dom.uploadSection.classList.remove('hidden');
  dom.workspaceSection.classList.add('hidden');
}

// ─── Utilities ────────────────────────────────────────────────────────────

function tick() { return new Promise(r => setTimeout(r, 50)); }

// ─── Resize ───────────────────────────────────────────────────────────────

window.addEventListener('resize', () => { if (state.result) redrawChart(); });

// Theme change → redraw chart with new colours
new MutationObserver(() => { if (state.result) redrawChart(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ─── Init ─────────────────────────────────────────────────────────────────

console.log('🌱 Germinator AI v2.0-beta loaded');
