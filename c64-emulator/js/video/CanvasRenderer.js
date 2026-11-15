export class CanvasRenderer {
  constructor(canvas, { width = 404, height = 284, pixelAspect = 0.94 } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('HTMLCanvasElement erforderlich');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('Canvas-2D-Kontext nicht verfügbar');
    this.source = document.createElement('canvas');
    this.sourceContext = this.source.getContext('2d', { alpha: false });
    this.integerScaling = false;
    this.lastPresentedFrame = -1;
    this.configureSource(width, height, pixelAspect);
  }

  configureSource(width, height, pixelAspect = 1) {
    if (![width, height].every(Number.isInteger) || width < 1 || height < 1 ||
        !Number.isFinite(pixelAspect) || pixelAspect <= 0) {
      throw new RangeError('Ungültige Videogeometrie');
    }
    this.width = width;
    this.height = height;
    this.pixelAspect = pixelAspect;
    this.source.width = width;
    this.source.height = height;
    this.imageData = this.sourceContext.createImageData(width, height);
    this.sourceContext.fillStyle = '#000000';
    this.sourceContext.fillRect(0, 0, width, height);
    this.resize();
  }

  setIntegerScaling(enabled) {
    this.integerScaling = Boolean(enabled);
    this.resize();
  }

  resize() {
    const host = this.canvas.parentElement;
    if (!host) return;
    const availableWidth = Math.max(1, host.clientWidth);
    const availableHeight = Math.max(1, host.clientHeight);
    const aspect = (this.width * (this.integerScaling ? 1 : this.pixelAspect)) / this.height;
    let displayHeight = Math.min(availableHeight, availableWidth / aspect);
    if (this.integerScaling) {
      const factor = Math.floor(Math.min(availableWidth / this.width, availableHeight / this.height));
      if (factor >= 1) displayHeight = this.height * factor;
    }
    const displayWidth = displayHeight * aspect;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    const pixelsWide = Math.max(1, Math.round(displayWidth * dpr));
    const pixelsHigh = Math.max(1, Math.round(displayHeight * dpr));
    if (this.canvas.width !== pixelsWide || this.canvas.height !== pixelsHigh) {
      this.canvas.width = pixelsWide;
      this.canvas.height = pixelsHigh;
    }
    this.draw();
  }

  present(frame) {
    if (frame.width !== this.width || frame.height !== this.height) {
      throw new RangeError('Framebuffergeometrie ungültig');
    }
    if (frame.data instanceof Uint8Array && frame.palette) {
      if (frame.data.length !== this.width * this.height) throw new RangeError('Indexierter Framebuffer ungültig');
      const rgba = this.imageData.data;
      const pixels = frame.data;
      const palette = frame.palette;
      for (let i = 0, j = 0; i < pixels.length; i += 1, j += 4) {
        const color = palette[pixels[i] & 15];
        rgba[j] = color >>> 16;
        rgba[j + 1] = (color >>> 8) & 255;
        rgba[j + 2] = color & 255;
        rgba[j + 3] = 255;
      }
    } else if (frame.data instanceof Uint8ClampedArray && frame.data.length === this.width * this.height * 4) {
      this.imageData.data.set(frame.data);
    } else {
      throw new RangeError('Framebufferformat ungültig');
    }
    this.sourceContext.putImageData(this.imageData, 0, 0);
    this.lastPresentedFrame = frame.frameNumber ?? this.lastPresentedFrame + 1;
    this.draw();
  }

  draw() {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
  }
}
