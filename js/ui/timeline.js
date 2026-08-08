/**
 * @fileoverview Timeline component for playback and frame scrubbing.
 * Ported from Python scientific computing context to pure ES module UI.
 */

export class Timeline extends EventTarget {
  /**
   * @param {HTMLElement} trackEl
   * @param {HTMLElement} fillEl
   * @param {HTMLElement} scrubberEl
   * @param {HTMLElement} labelEl
   * @param {HTMLElement} frameInfoEl
   * @param {HTMLElement} playBtn
   */
  constructor(trackEl, fillEl, scrubberEl, labelEl, frameInfoEl, playBtn) {
    super();
    this.trackEl = trackEl;
    this.fillEl = fillEl;
    this.scrubberEl = scrubberEl;
    this.labelEl = labelEl;
    this.frameInfoEl = frameInfoEl;
    this.playBtn = playBtn;

    this.hours = [];
    this._currentFrame = 0;
    this.isPlaying = false;
    this.playInterval = null;
    this.isDragging = false;

    this.initEvents();
  }

  initEvents() {
    this.playBtn.addEventListener('click', () => {
      this.togglePlay();
    });

    this.trackEl.addEventListener('mousedown', this.handleTrackPointer.bind(this));
    window.addEventListener('mousemove', this.handleScrubberDrag.bind(this));
    window.addEventListener('mouseup', this.handleScrubberEnd.bind(this));
    
    // Touch support
    this.trackEl.addEventListener('touchstart', this.handleTrackPointer.bind(this), {passive: false});
    window.addEventListener('touchmove', this.handleScrubberDrag.bind(this), {passive: false});
    window.addEventListener('touchend', this.handleScrubberEnd.bind(this));
  }

  setFrames(hours) {
    this.hours = hours;
    this.setFrame(0);
  }

  get currentFrame() {
    return this._currentFrame;
  }

  setFrame(index) {
    if (!this.hours.length) return;
    
    index = Math.max(0, Math.min(index, this.hours.length - 1));
    this._currentFrame = index;

    const percent = this.hours.length > 1 
      ? (index / (this.hours.length - 1)) * 100 
      : 0;

    this.scrubberEl.style.left = `${percent}%`;
    this.fillEl.style.width = `${percent}%`;

    const currentHour = this.hours[index];
    this.labelEl.textContent = `${currentHour.toFixed(1)} h`;
    this.frameInfoEl.textContent = `Frame ${index + 1} / ${this.hours.length}`;

    this.dispatchEvent(new CustomEvent('frame-change', {
      detail: { index: this._currentFrame, hours: currentHour }
    }));
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.playBtn.classList.toggle('playing', this.isPlaying);
    
    if (this.isPlaying) {
      // Auto-advance at ~2fps
      this.playInterval = setInterval(() => {
        let nextFrame = this._currentFrame + 1;
        if (nextFrame >= this.hours.length) {
          nextFrame = 0; // loop
        }
        this.setFrame(nextFrame);
      }, 500);
    } else {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  updateFromPointer(e) {
    if (!this.hours.length) return;
    
    const rect = this.trackEl.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let x = clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    
    const percent = x / rect.width;
    const index = Math.round(percent * (this.hours.length - 1));
    
    this.setFrame(index);
  }

  handleTrackPointer(e) {
    e.preventDefault();
    this.isDragging = true;
    if (this.isPlaying) this.togglePlay(); // pause on interaction
    this.updateFromPointer(e);
  }

  handleScrubberDrag(e) {
    if (!this.isDragging) return;
    this.updateFromPointer(e);
  }

  handleScrubberEnd() {
    this.isDragging = false;
  }
}
