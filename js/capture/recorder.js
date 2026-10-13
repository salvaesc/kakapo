// Records each run: the finished screen (camera + game) and the sound (your squeaks + the
// game's effects) into a vertical video, ready to share when the run ends.
// The video stays in memory on this device; it is only shared if the player taps Share.
import { load, save } from '../core/storage.js';

// MP4 with AAC sound first: it plays with sound everywhere (Windows player, WhatsApp, iPhone).
// A plain 'video/mp4' in Chrome means Opus sound inside MP4, which many players open
// SILENT, so Chrome without AAC gets WebM (Opus in WebM is understood); Safari's plain
// 'video/mp4' is H.264 + AAC, so it keeps it.
const AAC = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc3,mp4a.40.2',
];
const isSafari = () => typeof navigator !== 'undefined'
  && /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios|fxios|edg|android/i.test(navigator.userAgent);
const TYPES = () => [
  ...AAC.map((t) => [t, 'mp4']),
  ...(isSafari() ? [['video/mp4', 'mp4']] : []),
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
  ['video/mp4', 'mp4'],
];

export class Recorder {
  constructor(config) {
    this.cfg = config.recording;
    this.enabled = load('record', true);
    this.state = 'idle'; // idle | recording | paused | stopping | ready | failed
    this.canvas = null;
    this.ctx = null;
    this.rec = null;
    this.chunks = [];
    this.blob = null;
    this.url = '';
    this.ext = 'webm';
    this.mime = '';
    this.startedAt = 0;
    this._stopPromise = null;
    const hasRecorder = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
    const hasCapture = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
    if (hasRecorder && hasCapture) {
      for (const [t, ext] of TYPES()) {
        if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(t)) { this.mime = t; this.ext = ext; break; }
      }
    }
    this.supported = !!this.mime;
  }

  setEnabled(on) {
    this.enabled = on;
    save('record', on);
    if (!on) this.discard();
  }

  /** Starts recording `display` (the game canvas) plus the given audio tracks. */
  start(display, audioTracks = []) {
    this.discard();
    if (!this.enabled || !this.supported) return false;
    const C = this.cfg;
    const k = Math.min(1, C.maxHeight / display.height);
    const w = Math.max(2, Math.round((display.width * k) / 2) * 2);
    const h = Math.max(2, Math.round((display.height * k) / 2) * 2);
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(display, 0, 0, w, h);
    try {
      const stream = this.canvas.captureStream(C.fps);
      for (const t of audioTracks) if (t && t.readyState === 'live') stream.addTrack(t);
      this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: C.videoBps, audioBitsPerSecond: C.audioBps });
    } catch {
      this.state = 'failed';
      return false;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.startedAt = performance.now();
    this.state = 'recording';
    return true;
  }

  /** Called after every rendered frame. */
  frame(display) {
    if (this.state !== 'recording') return;
    this.ctx.drawImage(display, 0, 0, this.canvas.width, this.canvas.height);
    if (performance.now() - this.startedAt > this.cfg.maxSeconds * 1000) this.stop();
  }

  pause() {
    if (this.state === 'recording' && this.rec.state === 'recording') { this.rec.pause(); this.state = 'paused'; }
  }

  resume() {
    if (this.state === 'paused' && this.rec.state === 'paused') { this.rec.resume(); this.state = 'recording'; }
  }

  /** Finishes the video. Resolves to the Blob, or null if there is nothing usable. */
  stop() {
    if (this._stopPromise) return this._stopPromise;
    if (!this.rec || (this.state !== 'recording' && this.state !== 'paused')) return Promise.resolve(this.blob);
    this.state = 'stopping';
    const rec = this.rec;
    this._stopPromise = new Promise((resolve) => {
      rec.onstop = () => {
        const type = this.mime.split(';')[0];
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.chunks = [];
        this.rec = null;
        this._stopPromise = null;
        if (blob && blob.size > 1000) {
          this.blob = blob;
          this.url = URL.createObjectURL(blob);
          this.state = 'ready';
        } else {
          this.state = 'failed';
        }
        resolve(this.blob);
      };
      try { rec.stop(); } catch { rec.onstop(); }
    });
    return this._stopPromise;
  }

  /** Drops the current recording and frees its memory. */
  discard() {
    if (this.rec) {
      this.rec.ondataavailable = null;
      this.rec.onstop = null;
      try { this.rec.stop(); } catch { /* already stopped */ }
      this.rec = null;
    }
    this._stopPromise = null;
    this.chunks = [];
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    this.blob = null;
    this.state = 'idle';
  }

  file(score) {
    if (!this.blob) return null;
    return new File([this.blob], `kakapo-${score}.${this.ext}`, { type: this.blob.type });
  }
}
