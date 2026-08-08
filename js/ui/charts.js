/**
 * @fileoverview Germination curve rendering component.
 * Ported from Python scientific computing context to pure ES module UI.
 */

export class GerminationChart extends EventTarget {
  /**
   * @param {HTMLCanvasElement} canvasEl
   */
  constructor(canvasEl) {
    super();
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    
    this.data = {
      hours: [],
      empiricalCurve: [],
      hillFit: [],
      bootstrapCIs: null // { lower: [], upper: [] }
    };
    
    this.options = {
      showEmpirical: true,
      showHill: true,
      showCI: true
    };
    
    // Dark theme config
    this.theme = {
      text: '#8b949e',
      grid: 'rgba(255,255,255,0.05)',
      empirical: '#66bb6a',
      hill: '#ffb74d',
      ciFill: 'rgba(102, 187, 106, 0.2)',
      font: '11px Inter, sans-serif'
    };
    
    this.margin = { top: 20, right: 20, bottom: 40, left: 50 };
    
    this.setupCanvas();
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  setupCanvas() {
    // Handle device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    // Fallback if parent has 0 dimensions
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : {width: 600, height: 400};
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  handleResize() {
    this.setupCanvas();
    this.render(this.options);
  }

  setData(hours, empiricalCurve, hillFit, bootstrapCIs) {
    this.data = {
      hours: hours || [],
      empiricalCurve: empiricalCurve || [],
      hillFit: hillFit || [],
      bootstrapCIs: bootstrapCIs || null
    };
  }

  /**
   * @param {Object} options 
   */
  render(options = {}) {
    this.options = { ...this.options, ...options };
    const { hours, empiricalCurve, hillFit, bootstrapCIs } = this.data;
    
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    if (!hours || !hours.length) return;
    
    const chartWidth = this.width - this.margin.left - this.margin.right;
    const chartHeight = this.height - this.margin.top - this.margin.bottom;
    
    const maxHour = Math.max(...hours, 1);
    // Y-axis max is always 1.0 (100% germination) or slightly above based on data
    const maxY = 1.0; 
    
    // Scale functions
    const xToPx = (x) => this.margin.left + (x / maxHour) * chartWidth;
    const yToPx = (y) => this.margin.top + chartHeight - (y / maxY) * chartHeight;
    
    this.drawAxes(chartWidth, chartHeight, maxHour, maxY, xToPx, yToPx);
    
    // CI Band
    if (this.options.showCI && bootstrapCIs && bootstrapCIs.lower && bootstrapCIs.lower.length) {
      this.ctx.fillStyle = this.theme.ciFill;
      this.ctx.beginPath();
      
      // Top edge (upper CI)
      this.ctx.moveTo(xToPx(hours[0]), yToPx(bootstrapCIs.upper[0]));
      for (let i = 1; i < hours.length; i++) {
        this.ctx.lineTo(xToPx(hours[i]), yToPx(bootstrapCIs.upper[i]));
      }
      // Bottom edge (lower CI, backwards)
      for (let i = hours.length - 1; i >= 0; i--) {
        this.ctx.lineTo(xToPx(hours[i]), yToPx(bootstrapCIs.lower[i]));
      }
      
      this.ctx.closePath();
      this.ctx.fill();
    }
    
    // Hill Fit Curve
    if (this.options.showHill && hillFit && hillFit.length) {
      this.ctx.strokeStyle = this.theme.hill;
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([5, 5]);
      this.ctx.beginPath();
      this.ctx.moveTo(xToPx(hours[0]), yToPx(hillFit[0]));
      for (let i = 1; i < hours.length; i++) {
        this.ctx.lineTo(xToPx(hours[i]), yToPx(hillFit[i]));
      }
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      
      // Calculate and draw t50 if possible (approximate)
      // Assuming hillFit reaches 0.5
      let t50Index = hillFit.findIndex(v => v >= 0.5);
      if (t50Index >= 0) {
        let t50X = hours[t50Index];
        this.ctx.strokeStyle = this.theme.text;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 2]);
        this.ctx.beginPath();
        this.ctx.moveTo(xToPx(t50X), yToPx(0));
        this.ctx.lineTo(xToPx(t50X), yToPx(maxY));
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // t50 label
        this.ctx.fillStyle = this.theme.text;
        this.ctx.textAlign = 'right';
        this.ctx.fillText(`t50 \u2248 ${t50X.toFixed(1)}h`, xToPx(t50X) - 5, this.margin.top + 10);
      }
    }
    
    // Empirical Curve (Step curve)
    if (this.options.showEmpirical && empiricalCurve && empiricalCurve.length) {
      this.ctx.strokeStyle = this.theme.empirical;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      
      this.ctx.moveTo(xToPx(hours[0]), yToPx(empiricalCurve[0]));
      
      for (let i = 1; i < hours.length; i++) {
        // Step interpolation
        this.ctx.lineTo(xToPx(hours[i]), yToPx(empiricalCurve[i-1]));
        this.ctx.lineTo(xToPx(hours[i]), yToPx(empiricalCurve[i]));
      }
      this.ctx.stroke();
      
      // Timepoint markers
      this.ctx.fillStyle = this.theme.empirical;
      for (let i = 0; i < hours.length; i++) {
        this.ctx.beginPath();
        this.ctx.arc(xToPx(hours[i]), yToPx(empiricalCurve[i]), 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }
  
  drawAxes(w, h, maxX, maxY, xToPx, yToPx) {
    this.ctx.strokeStyle = this.theme.grid;
    this.ctx.lineWidth = 1;
    this.ctx.font = this.theme.font;
    this.ctx.fillStyle = this.theme.text;
    
    // Y-axis grid and labels (0, 0.2, 0.4, 0.6, 0.8, 1.0)
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    for (let y = 0; y <= maxY; y += 0.2) {
      const py = yToPx(y);
      this.ctx.beginPath();
      this.ctx.moveTo(this.margin.left, py);
      this.ctx.lineTo(this.width - this.margin.right, py);
      this.ctx.stroke();
      
      this.ctx.fillText(`${(y * 100).toFixed(0)}%`, this.margin.left - 10, py);
    }
    
    // X-axis grid and labels
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    const xSteps = 5;
    const stepSize = Math.max(1, Math.round(maxX / xSteps));
    
    for (let x = 0; x <= maxX; x += stepSize) {
      const px = xToPx(x);
      this.ctx.beginPath();
      this.ctx.moveTo(px, this.margin.top);
      this.ctx.lineTo(px, this.height - this.margin.bottom);
      this.ctx.stroke();
      
      this.ctx.fillText(`${x}`, px, this.height - this.margin.bottom + 10);
    }
    
    // Axis titles
    this.ctx.save();
    this.ctx.translate(15, this.margin.top + h / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Cumulative germination', 0, 0);
    this.ctx.restore();
    
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Time (hours)', this.margin.left + w / 2, this.height - 15);
  }

  exportPNG() {
    return this.canvas.toDataURL('image/png');
  }

  exportSVG() {
    // Basic SVG export - to create publication-quality charts.
    const w = this.width;
    const h = this.height;
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    svg += `<style>
      .text { font: ${this.theme.font}; fill: ${this.theme.text}; }
      .grid { stroke: #333; stroke-width: 1px; }
      .empirical { stroke: ${this.theme.empirical}; stroke-width: 2px; fill: none; }
      .marker { fill: ${this.theme.empirical}; }
      .hill { stroke: ${this.theme.hill}; stroke-width: 2px; stroke-dasharray: 5,5; fill: none; }
      .ci { fill: ${this.theme.ciFill}; stroke: none; }
    </style>`;
    
    // Note: A full SVG export would reconstruct the paths here. 
    // This is a placeholder for the SVG representation.
    svg += `<!-- SVG content representing the chart lines -->`;
    
    svg += `</svg>`;
    return svg;
  }
}
