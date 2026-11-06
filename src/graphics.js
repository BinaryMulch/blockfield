export const FPS_LIMITS = [30, 60, 120];
export const RESOLUTION_SCALES = [0.5, 0.75, 1];
const STORAGE_KEY = 'blockfield-graphics';

export function graphicsSettings(value, mobile = false) {
  const defaults = { version: 1, fps: mobile ? 30 : 60, resolution: mobile ? 0.75 : 1 };
  if (!value || value.version !== 1) return defaults;
  return { version: 1, fps: FPS_LIMITS.includes(value.fps) ? value.fps : defaults.fps,
    resolution: RESOLUTION_SCALES.includes(value.resolution) ? value.resolution : defaults.resolution };
}

export function renderPixelRatio(deviceRatio, resolution) {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(ratio, 2) * (RESOLUTION_SCALES.includes(resolution) ? resolution : 1);
}

export class FrameLimiter {
  constructor(fps = 60) { this.setFPS(fps); }
  setFPS(fps) { this.interval = 1000 / (FPS_LIMITS.includes(fps) ? fps : 60); this.reset(); }
  reset() { this.next = null; }
  allow(now) {
    if (this.next === null) { this.next = now + this.interval; return true; }
    // A small tolerance avoids losing frames to fractional refresh timestamps.
    if (now + Math.min(0.75, this.interval * 0.025) < this.next) return false;
    // Maintain cadence across refresh rates without catching up after a stall.
    this.next = now - this.next >= this.interval ? now + this.interval : this.next + this.interval;
    return true;
  }
}

export class GraphicsSettings {
  constructor(renderer) {
    this.renderer = renderer;
    this.mobile = window.matchMedia('(pointer: coarse)').matches;
    this.note = document.querySelector('#graphics-note');
    this.fpsSelect = document.querySelector('#fps-limit');
    this.resolutionSelect = document.querySelector('#render-resolution');
    let saved, available = true;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { available = false; }
    try { saved = JSON.parse(saved); } catch { saved = null; }
    this.value = graphicsSettings(saved, this.mobile);
    this.limiter = new FrameLimiter(this.value.fps);
    this.fpsSelect.value = String(this.value.fps);
    this.resolutionSelect.value = String(this.value.resolution);
    if (!available) this.note.textContent = 'Settings apply for this visit; browser settings storage is unavailable.';
    const change = () => {
      this.value = graphicsSettings({ version: 1, fps: Number(this.fpsSelect.value), resolution: Number(this.resolutionSelect.value) }, this.mobile);
      this.limiter.setFPS(this.value.fps); this.resize();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
        this.note.textContent = 'Saved in this browser. Lower resolution draws fewer pixels.';
      } catch { this.note.textContent = 'Applied for this visit; browser settings storage is unavailable.'; }
      this.onChange?.();
    };
    this.fpsSelect.addEventListener('change', change);
    this.resolutionSelect.addEventListener('change', change);
    this.resize();
  }
  resize() {
    const ratio = renderPixelRatio(window.devicePixelRatio, this.value.resolution);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.limiter.reset();
  }
  snapshot() {
    return { fpsLimit: this.value.fps, resolutionScale: this.value.resolution, pixelRatio: this.renderer.getPixelRatio(),
      bufferWidth: this.renderer.domElement.width, bufferHeight: this.renderer.domElement.height };
  }
}
