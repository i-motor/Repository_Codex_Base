import { buildRgbaTable } from './Palette.js';
import { cropRect } from './VideoTiming.js';

export const PAL_PIXEL_ASPECT = 0.9365;

export class CanvasRenderer {
  constructor(canvas, timing, { cropMode = 'normal', integerScaling = false, palAspect = false, palette = 'colodore' } = {}) {
    this.canvas = canvas;
    this.timing = timing;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.integerScaling = integerScaling;
    this.palAspect = palAspect;
    this.sourceWidth = timing.cyclesPerLine * 8;
    this.setPalette(palette);
    this.setCropMode(cropMode);
    this.observer = null;
    this.destination = { x: 0, y: 0, width: 0, height: 0 };
    this.handleResize = () => this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.handleResize);
      this.observer.observe(canvas);
    }
    window.addEventListener('resize', this.handleResize);
    this.watchPixelRatio();
    this.resize();
  }

  watchPixelRatio() {
    if (!window.matchMedia) {
      return;
    }
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const listener = () => {
      query.removeEventListener('change', listener);
      this.resize();
      this.watchPixelRatio();
    };
    query.addEventListener('change', listener);
  }

  setPalette(name) {
    this.rgba = buildRgbaTable(name);
  }

  setCropMode(mode) {
    this.cropMode = mode;
    this.crop = cropRect(this.timing, mode);
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = this.crop.width;
    this.offscreen.height = this.crop.height;
    this.offscreenCtx = this.offscreen.getContext('2d', { alpha: false });
    this.imageData = this.offscreenCtx.createImageData(this.crop.width, this.crop.height);
    this.pixels = new Uint32Array(this.imageData.data.buffer);
    this.resize();
  }

  setIntegerScaling(enabled) {
    this.integerScaling = !!enabled;
    this.resize();
  }

  setPalAspect(enabled) {
    this.palAspect = !!enabled;
    this.resize();
  }

  resize() {
    if (!this.crop) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const aspect = this.palAspect ? PAL_PIXEL_ASPECT : 1;
    const sourceW = this.crop.width * aspect;
    const sourceH = this.crop.height;
    let scale = Math.min(width / sourceW, height / sourceH);
    if (this.integerScaling && scale >= 1) {
      scale = Math.floor(scale);
    }
    const destW = Math.round(sourceW * scale);
    const destH = Math.round(sourceH * scale);
    this.destination = {
      x: Math.floor((width - destW) / 2),
      y: Math.floor((height - destH) / 2),
      width: destW,
      height: destH
    };
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);
    if (this.lastFrame) {
      this.present(this.lastFrame);
    }
  }

  present(frameBuffer) {
    this.lastFrame = frameBuffer;
    const { x: cx, y: cy, width: cw, height: ch } = this.crop;
    const pixels = this.pixels;
    const rgba = this.rgba;
    const sourceWidth = this.sourceWidth;
    let out = 0;
    for (let y = 0; y < ch; y++) {
      let index = (cy + y) * sourceWidth + cx;
      for (let x = 0; x < cw; x++) {
        pixels[out++] = rgba[frameBuffer[index++] & 0x0f];
      }
    }
    this.offscreenCtx.putImageData(this.imageData, 0, 0);
    const d = this.destination;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreen, 0, 0, cw, ch, d.x, d.y, d.width, d.height);
  }

  canvasToScreen(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const d = this.destination;
    return {
      x: ((clientX - rect.left) * ratio - d.x) / d.width,
      y: ((clientY - rect.top) * ratio - d.y) / d.height
    };
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    window.removeEventListener('resize', this.handleResize);
  }
}
