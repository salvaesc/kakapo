// Front camera as the game's sky: the player becomes the backdrop.
// The video is drawn at the game's low pixel-art resolution (so it pixelates naturally),
// mirrored like a selfie, and posterized to a few colour levels so it sits with the art.
// Nothing is recorded or sent anywhere: frames go from the camera straight to the canvas.
import { load, save } from '../core/storage.js';
import { t as tr } from '../i18n/i18n.js';

export class Camera {
  constructor(config) {
    this.cfg = config.camera;
    this.status = 'off'; // off | requesting | on | denied | unavailable | insecure | error
    this.error = '';
    this.stream = null;
    this.video = null;
    this.wanted = load('camera', true); // the game is made to be played with the camera
    this._buf = null;
    this._bctx = null;
    this._lut = new Uint8ClampedArray(256);
    this._lutLevels = 0;
    this.onStatus = null;
    this._onEnded = () => { this.stop(); this.status = 'error'; this.error = tr('cam.errStopped'); this.onStatus && this.onStatus(); };
  }

  get on() { return this.status === 'on' && this.video && this.video.readyState >= 2; }

  /** Must be called from a user gesture. */
  async start() {
    if (this.status === 'on') return this.status;
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      this.status = 'insecure';
      this.error = tr('cam.errInsecure');
      return this.status;
    }
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || !md.getUserMedia) {
      this.status = 'unavailable';
      this.error = tr('cam.errUnsupported');
      return this.status;
    }
    this.status = 'requesting';
    try {
      this.stream = await md.getUserMedia({
        audio: false,
        // no forced size: phones send a portrait image in portrait, which needs less cropping
        video: { facingMode: 'user', frameRate: { ideal: 30 } },
      });
    } catch (e) {
      const name = e && e.name;
      this.status = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'error';
      this.error = this.status === 'denied' ? tr('cam.errDenied')
        : this.status === 'unavailable' ? tr('cam.errNotFound') : tr('cam.errStart', { name: name || tr('common.unknownError') });
      return this.status;
    }
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.srcObject = this.stream;
    try { await v.play(); } catch { /* some browsers resolve play() late; drawing waits for readyState */ }
    this.video = v;
    for (const t of this.stream.getVideoTracks()) t.addEventListener('ended', this._onEnded);
    this.status = 'on';
    this.setWanted(true);
    return this.status;
  }

  videoConstraints() {
    return { facingMode: 'user', frameRate: { ideal: 30 } };
  }

  /** Uses an already-granted stream (from a combined mic + camera request). */
  async startWithStream(stream) {
    this.stop();
    this.stream = stream;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.srcObject = stream;
    try { await v.play(); } catch { /* drawing waits for readyState */ }
    this.video = v;
    for (const t of stream.getVideoTracks()) t.addEventListener('ended', this._onEnded);
    this.status = 'on';
    this.error = '';
    return this.status;
  }

  setWanted(w) {
    this.wanted = w;
    save('camera', w);
  }

  stop() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) { t.removeEventListener('ended', this._onEnded); t.stop(); }
    }
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
    if (this.status === 'on') this.status = 'off';
  }

  _ensureBuffer(w, h) {
    if (!this._buf || this._buf.width !== w || this._buf.height !== h) {
      this._buf = document.createElement('canvas');
      this._buf.width = w;
      this._buf.height = h;
      this._bctx = this._buf.getContext('2d', { willReadFrequently: true });
      this._bctx.imageSmoothingEnabled = true; // smooth downscale, then crisp upscale
    }
    const L = this.cfg.levels;
    if (this._lutLevels !== L) {
      this._lutLevels = L;
      const step = 255 / (L - 1);
      for (let i = 0; i < 256; i++) this._lut[i] = Math.round(Math.round(i / step) * step);
    }
  }

  /**
   * Draws the camera at full screen resolution onto the display canvas (sharp, so the player
   * is easy to recognise). The pixel-art game is drawn on top of it with transparency.
   */
  drawSharp(ctx, w, h) {
    if (!this.on) return false;
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    const scale = Math.max(w / vw, h / vh) * this.cfg.zoom;
    const dw = vw * scale, dh = vh * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) * this.cfg.verticalBias;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // selfie mirror
    ctx.drawImage(v, dx, dy, dw, dh);
    ctx.restore();
    if (this.cfg.tintAmount > 0) {
      const [r, g, b] = this.cfg.tint;
      ctx.globalAlpha = this.cfg.tintAmount;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
    return true;
  }

  /**
   * Pixel-art variant (camera.pixelated: true): draws the frame covering (0,0,w,h) of the low-res game buffer,
   * mirrored and posterized. Returns false if there is no frame yet.
   */
  draw(ctx, w, h) {
    if (!this.on) return false;
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return false;
    this._ensureBuffer(w, h);
    const b = this._bctx;
    // cover-fit, with the face area biased towards the upper part of the screen
    const scale = Math.max(w / vw, h / vh) * this.cfg.zoom;
    const dw = vw * scale, dh = vh * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) * this.cfg.verticalBias;
    b.save();
    b.translate(w, 0);
    b.scale(-1, 1); // selfie mirror
    b.drawImage(v, dx, dy, dw, dh);
    b.restore();
    if (this.cfg.levels > 1) {
      const img = b.getImageData(0, 0, w, h);
      const d = img.data, lut = this._lut;
      const k = this.cfg.contrast, tint = this.cfg.tint, ta = this.cfg.tintAmount;
      for (let i = 0; i < d.length; i += 4) {
        let r = (d[i] - 128) * k + 128, g = (d[i + 1] - 128) * k + 128, bl = (d[i + 2] - 128) * k + 128;
        r = r + (tint[0] - r) * ta; g = g + (tint[1] - g) * ta; bl = bl + (tint[2] - bl) * ta;
        d[i] = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0];
        d[i + 1] = lut[g < 0 ? 0 : g > 255 ? 255 : g | 0];
        d[i + 2] = lut[bl < 0 ? 0 : bl > 255 ? 255 : bl | 0];
      }
      b.putImageData(img, 0, 0);
    }
    ctx.drawImage(this._buf, 0, 0);
    return true;
  }
}
