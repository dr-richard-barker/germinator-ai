/**
 * @fileoverview Seed Map overlay component for rendering seed annotations.
 * Ported from Python scientific computing context to pure ES module UI.
 */

export class SeedMap extends EventTarget {
  /**
   * @param {HTMLCanvasElement} overlayCanvas
   * @param {HTMLElement} tooltipEl
   */
  constructor(overlayCanvas, tooltipEl) {
    super();
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    this.tooltipEl = tooltipEl;
    
    this.data = null;
    this.frameIndex = 0;
    this.opacity = 1.0;
    this.seeds = [];
    
    this.initEvents();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseleave', () => {
      this.tooltipEl.style.display = 'none';
    });
    this.canvas.addEventListener('click', this.handleClick.bind(this));
  }

  setData(seriesResult, frameIndex) {
    this.data = seriesResult;
    this.frameIndex = frameIndex;
    
    // Extract seeds for current frame
    this.seeds = this.data && this.data.frames && this.data.frames[frameIndex] 
      ? this.data.frames[frameIndex].seeds 
      : [];
      
    this.render();
  }

  setOpacity(value) {
    this.opacity = Math.max(0, Math.min(1, value));
    this.render();
  }

  render() {
    requestAnimationFrame(() => {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      
      if (!this.seeds || !this.seeds.length) return;

      this.ctx.globalAlpha = this.opacity;

      this.seeds.forEach(seed => {
        // Draw bounding box or polygon based on seed data
        const { x, y, width, height, isGerminated, confidence } = seed;
        
        let fillColor;
        if (confidence < 0.5) {
          fillColor = 'rgba(255, 183, 77, 0.5)'; // amber
        } else if (isGerminated) {
          fillColor = 'rgba(102, 187, 106, 0.5)'; // green
        } else {
          fillColor = 'rgba(120, 144, 156, 0.5)'; // blue-grey
        }

        this.ctx.fillStyle = fillColor;
        this.ctx.strokeStyle = fillColor.replace('0.5)', '1.0)');
        this.ctx.lineWidth = 2;
        
        this.ctx.beginPath();
        if (seed.polygon && seed.polygon.length) {
          this.ctx.moveTo(seed.polygon[0].x, seed.polygon[0].y);
          for (let i = 1; i < seed.polygon.length; i++) {
            this.ctx.lineTo(seed.polygon[i].x, seed.polygon[i].y);
          }
          this.ctx.closePath();
        } else {
          // Fallback to bounding box
          this.ctx.rect(x, y, width, height);
        }
        
        this.ctx.fill();
        this.ctx.stroke();
      });
      
      this.ctx.globalAlpha = 1.0;
    });
  }

  getSeedAtPoint(x, y) {
    // Assuming x,y are relative to canvas logical size
    // Need to scale to internal canvas resolution if different
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    
    const cx = x * scaleX;
    const cy = y * scaleY;
    
    return this.seeds.find(seed => {
      // Simple bounding box hit test
      return cx >= (seed.x || 0) && cx <= (seed.x || 0) + (seed.width || 0) &&
             cy >= (seed.y || 0) && cy <= (seed.y || 0) + (seed.height || 0);
    });
  }

  handleMouseMove(e) {
    if (!this.seeds.length) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const hoveredSeed = this.getSeedAtPoint(x, y);
    
    if (hoveredSeed) {
      this.tooltipEl.style.display = 'block';
      this.tooltipEl.style.left = `${e.clientX + 10}px`;
      this.tooltipEl.style.top = `${e.clientY + 10}px`;
      
      const state = hoveredSeed.isGerminated ? 'Germinated' : 'Ungerminated';
      this.tooltipEl.innerHTML = `
        <strong>ID: ${hoveredSeed.id || 'N/A'}</strong><br>
        State: ${state}<br>
        Confidence: ${hoveredSeed.confidence !== undefined ? (hoveredSeed.confidence * 100).toFixed(1) + '%' : 'N/A'}<br>
        Area: ${hoveredSeed.area || 'N/A'}<br>
        Protrusion: ${hoveredSeed.protrusion !== undefined ? hoveredSeed.protrusion.toFixed(2) : 'N/A'}<br>
        Germination Time: ${hoveredSeed.germinationTime !== undefined ? hoveredSeed.germinationTime.toFixed(1) + 'h' : 'N/A'}
      `;
    } else {
      this.tooltipEl.style.display = 'none';
    }
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const clickedSeed = this.getSeedAtPoint(x, y);
    if (clickedSeed) {
      console.log('Seed clicked:', clickedSeed);
      this.dispatchEvent(new CustomEvent('seed-click', { detail: clickedSeed }));
    }
  }
}
