// Microphone input: permission, analysis graph, calibration and smoothed level.
import { getAudioContext, resumeAudio } from '../audio/audioContext.js';
import {
  rms, rmsToDb, dbToLevel, smoothLevel, computeCalibration, defaultCalibration,
  createPitchWork, detectPitch, pitchToLevel, computePitchCalibration,
} from './micMath.js';
import { load, save } from '../core/storage.js';
import { t as tr } from '../i18n/i18n.js';

export class Mic {
  constructor(config) {
    this.cfg = config.mic;
    this.status = 'off'; // off | requesting | on | denied | unavailable | insecure | error | lost
    this.error = '';
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.sink = null;
    this.buf = null;
    this.byteBuf = null;
    this.db = -100;
    this.rawLevel = 0;
    this.level = 0;
    this.pitchHz = 0;     // detected pitch this frame (0 = none)
    this.voiced = false;  // sound above the noise floor this frame
    this.tooLow = 0;      // seconds the player has been making sound below the flying pitch
    this._hist = new Array(this.cfg.pitch.median).fill(0);
    this._sorted = new Array(this.cfg.pitch.median).fill(0);
    this._lastHz = 0;
    this._gapT = 0;
    this.deadzone = config.control.deadzone;
    this.pitchMode = this.cfg.mode === 'pitch';
    // Remembered calibration lets a returning player skip straight to play
    // (older, volume-only calibrations are ignored in pitch mode).
    const stored = load('calibration', null);
    // (a calibration saved by the short-lived fixed-loudness test version is ignored too)
    const usable = stored && !stored.fixed && (!this.pitchMode || stored.version === 2);
    this.cal = usable ? stored : defaultCalibration(this.cfg);
    this.calibrated = !!usable;
    this._onEnded = () => {
      this.status = 'lost';
      this.error = tr('mic.errStopped');
      this.level = 0;
      if (this.onStatus) this.onStatus(this.status);
    };
    this.onStatus = null;
    // The system can mute the input (another app, a call, a Bluetooth switch)
    this.trackMuted = false;
    this._onMute = (e) => { this.trackMuted = e.type === 'mute'; if (this.onStatus) this.onStatus(this.status); };
    // Exact digital silence for a while = the input is dead (an interrupted iOS audio session)
    this.zeroT = 0;
    this.deadInput = false;
  }

  get on() { return this.status === 'on'; }

  /** Audio constraints, including the microphone the player picked in Settings. */
  audioConstraints() {
    const c = { ...this.cfg.constraints };
    const id = load('micDevice', '');
    if (id) c.deviceId = { ideal: id };
    return c;
  }

  /** Audio inputs available (labels appear once permission was granted). */
  static async listInputs() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    } catch { return []; }
  }

  get deviceLabel() {
    const t = this.stream && this.stream.getAudioTracks()[0];
    return (t && t.label) || '';
  }

  /** Switches to another microphone (restarts the stream). */
  async useDevice(deviceId) {
    save('micDevice', deviceId || '');
    this.stop();
    return this.start();
  }

  /**
   * Must be called from a user gesture. Resolves to the final status.
   * `stream`: an already-granted stream with an audio track (asking for mic + camera
   * in a single request is more reliable on iOS than two separate requests).
   */
  async start({ stream: given = null } = {}) {
    if (this.on) return this.status;
    this.error = '';
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      this.status = 'insecure';
      this.error = tr('mic.errInsecure');
      return this.status;
    }
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || !md.getUserMedia || !getAudioContext()) {
      this.status = 'unavailable';
      this.error = tr('mic.errUnsupported');
      return this.status;
    }
    this.status = 'requesting';
    const ctxPromise = resumeAudio(); // start resuming inside the gesture
    let stream = given;
    if (!stream) try {
      stream = await md.getUserMedia({ audio: this.audioConstraints(), video: false });
    } catch (e) {
      const name = e && e.name;
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        this.status = 'denied';
        this.error = tr('mic.errDenied');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        this.status = 'unavailable';
        this.error = tr('mic.errNotFound');
      } else {
        this.status = 'error';
        this.error = tr('mic.errStart', { name: name || tr('common.unknownError') });
      }
      return this.status;
    }
    let ctx = await ctxPromise;
    if (ctx.state !== 'running') ctx = await resumeAudio(); // iOS: 'interrupted' after the mic turns on
    try {
      this.stream = stream;
      this.source = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = this.pitchMode ? this.cfg.pitch.fftSize : this.cfg.fftSize;
      this.sampleRate = ctx.sampleRate;
      this.pitchWork = createPitchWork(this.analyser.fftSize);
      this.analyser.smoothingTimeConstant = 0;
      // Some Safari versions only pull audio through nodes connected to the destination:
      // route through a muted gain so nothing is audible (no feedback loop).
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.analyser);
      this.analyser.connect(this.sink);
      this.sink.connect(ctx.destination);
      this.buf = new Float32Array(this.analyser.fftSize);
      if (!this.analyser.getFloatTimeDomainData) this.byteBuf = new Uint8Array(this.analyser.fftSize);
      for (const t of stream.getAudioTracks()) {
        t.addEventListener('ended', this._onEnded);
        t.addEventListener('mute', this._onMute);
        t.addEventListener('unmute', this._onMute);
      }
      this.zeroT = 0;
      this.status = 'on';
    } catch (e) {
      this.stop();
      this.status = 'error';
      this.error = tr('mic.errAudio');
    }
    return this.status;
  }

  /** Reads the analyser once per frame; returns the smoothed level 0..1. */
  sample(dt) {
    if (!this.on || !this.analyser) {
      this.level = smoothLevel(this.level, 0, dt, this.cfg.attack, this.cfg.release);
      return this.level;
    }
    if (this.byteBuf) {
      this.analyser.getByteTimeDomainData(this.byteBuf);
      for (let i = 0; i < this.byteBuf.length; i++) this.buf[i] = (this.byteBuf[i] - 128) / 128;
    } else {
      this.analyser.getFloatTimeDomainData(this.buf);
    }
    const r = rms(this.buf);
    // A real microphone is never exactly zero. If it is, the audio session is stuck:
    // try to resume it, and tell the game so it can warn the player.
    if (r === 0) {
      this.zeroT += dt;
      if (this.zeroT > 0.8 && ((this.zeroT * 2) | 0) !== (((this.zeroT - dt) * 2) | 0)) resumeAudio();
    } else {
      this.zeroT = 0;
    }
    this.deadInput = this.zeroT > 1.5 || this.trackMuted;
    this.db = rmsToDb(r);
    this.voiced = this.db > this.cal.floorDb + this.cal.marginDb;
    if (this.pitchMode) {
      const P = this.cfg.pitch;
      const hz = this.voiced ? detectPitch(this.buf, this.sampleRate, this.pitchWork, P.minHz, P.maxHz, P.threshold) : 0;
      // short gaps (a voiced sound whose pitch flickers out) keep the last good pitch
      let f = hz;
      if (f > 0) { this._lastHz = f; this._gapT = 0; }
      else if (this.voiced && this._lastHz && (this._gapT += dt) < P.holdGap) f = this._lastHz;
      else this._lastHz = 0;
      // median over the last few frames removes octave jumps and voice cracks
      const h = this._hist, so = this._sorted, n = P.median;
      for (let i = 0; i < n - 1; i++) h[i] = h[i + 1];
      h[n - 1] = f;
      for (let i = 0; i < n; i++) so[i] = h[i];
      so.sort((a, b) => a - b);
      this.pitchHz = so[n >> 1];
      this.rawLevel = pitchToLevel(this.pitchHz, this.cal, this.deadzone);
      this.tooLow = this.voiced && this.pitchHz > 0 && this.rawLevel === 0 ? this.tooLow + dt : 0;
    } else {
      this.rawLevel = dbToLevel(this.db, this.cal);
    }
    this.level = smoothLevel(this.level, this.rawLevel, dt, this.cfg.attack, this.cfg.release);
    return this.level;
  }

  applyCalibration(quietDbs, loudDbs) {
    this.cal = { ...this.cal, ...computeCalibration(quietDbs, loudDbs, this.cfg) };
    this.calibrated = true;
    save('calibration', this.cal);
    return this.cal;
  }

  /** Pitch mode: quiet phase sets the noise gate, then normal "aaah" and highest squeak. */
  applyPitchCalibration(quietDbs, normalHz, highHz) {
    const base = { ...this.cal, ...computeCalibration(quietDbs, null, this.cfg) };
    this.cal = computePitchCalibration(base, normalHz, highHz, this.cfg);
    this.calibrated = true;
    save('calibration', this.cal);
    return this.cal;
  }

  /** Releases the microphone completely (tracks stopped → browser mic indicator turns off). */
  stop() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.removeEventListener('ended', this._onEnded);
        t.removeEventListener('mute', this._onMute);
        t.removeEventListener('unmute', this._onMute);
        t.stop();
      }
    }
    try { this.source && this.source.disconnect(); } catch { /* already disconnected */ }
    try { this.analyser && this.analyser.disconnect(); } catch { /* already disconnected */ }
    try { this.sink && this.sink.disconnect(); } catch { /* already disconnected */ }
    this.stream = this.source = this.analyser = this.sink = null;
    this.level = 0;
    if (this.status === 'on' || this.status === 'lost') this.status = 'off';
  }
}
