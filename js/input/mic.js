// Microphone input: permission, analysis graph, calibration and smoothed level.
import { getAudioContext, resumeAudio } from '../audio/audioContext.js';
import {
  rms, rmsToDb, dbToLevel, smoothLevel, computeCalibration, defaultCalibration,
  createPitchWork, detectPitch, pitchToLevel, computePitchCalibration,
} from './micMath.js';
import { load, save } from '../core/storage.js';

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
    this._hist = [0, 0, 0, 0, 0];
    this._sorted = [0, 0, 0, 0, 0];
    this.deadzone = config.control.deadzone;
    this.pitchMode = this.cfg.mode === 'pitch';
    // Remembered calibration lets a returning player skip straight to play
    // (older, volume-only calibrations are ignored in pitch mode).
    const stored = load('calibration', null);
    const usable = stored && (!this.pitchMode || stored.version === 2);
    this.cal = usable ? stored : defaultCalibration(this.cfg);
    this.calibrated = !!usable;
    this._onEnded = () => {
      this.status = 'lost';
      this.error = 'The microphone stopped (another app may have taken it).';
      this.level = 0;
      if (this.onStatus) this.onStatus(this.status);
    };
    this.onStatus = null;
  }

  get on() { return this.status === 'on'; }

  /** Must be called from a user gesture. Resolves to the final status. */
  async start() {
    if (this.on) return this.status;
    this.error = '';
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      this.status = 'insecure';
      this.error = 'Microphone needs a secure page (https:// or localhost).';
      return this.status;
    }
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || !md.getUserMedia || !getAudioContext()) {
      this.status = 'unavailable';
      this.error = 'This browser does not support microphone input.';
      return this.status;
    }
    this.status = 'requesting';
    const ctxPromise = resumeAudio(); // start resuming inside the gesture
    let stream;
    try {
      stream = await md.getUserMedia({ audio: { ...this.cfg.constraints }, video: false });
    } catch (e) {
      const name = e && e.name;
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        this.status = 'denied';
        this.error = 'Microphone permission was denied. You can allow it in the browser’s site settings.';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        this.status = 'unavailable';
        this.error = 'No microphone was found on this device.';
      } else {
        this.status = 'error';
        this.error = `The microphone could not start (${name || 'unknown error'}).`;
      }
      return this.status;
    }
    const ctx = await ctxPromise;
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
      for (const t of stream.getAudioTracks()) t.addEventListener('ended', this._onEnded);
      this.status = 'on';
    } catch (e) {
      this.stop();
      this.status = 'error';
      this.error = 'Audio processing could not start on this browser.';
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
    this.db = rmsToDb(rms(this.buf));
    this.voiced = this.db > this.cal.floorDb + this.cal.marginDb;
    if (this.pitchMode) {
      const P = this.cfg.pitch;
      const hz = this.voiced ? detectPitch(this.buf, this.sampleRate, this.pitchWork, P.minHz, P.maxHz, P.threshold) : 0;
      // median of the last 5 frames removes octave jumps and voice cracks
      const h = this._hist, so = this._sorted;
      for (let i = 0; i < 4; i++) h[i] = h[i + 1];
      h[4] = hz;
      for (let i = 0; i < 5; i++) so[i] = h[i];
      so.sort((a, b) => a - b);
      this.pitchHz = so[2];
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
      for (const t of this.stream.getTracks()) { t.removeEventListener('ended', this._onEnded); t.stop(); }
    }
    try { this.source && this.source.disconnect(); } catch { /* already disconnected */ }
    try { this.analyser && this.analyser.disconnect(); } catch { /* already disconnected */ }
    try { this.sink && this.sink.disconnect(); } catch { /* already disconnected */ }
    this.stream = this.source = this.analyser = this.sink = null;
    this.level = 0;
    if (this.status === 'on' || this.status === 'lost') this.status = 'off';
  }
}
