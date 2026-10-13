// Tiny synthesized sound effects (no audio files).
// They are short, quiet and mostly high-pitched so they don't excite the voice
// controller; `blockedUntil` also tells the game to ignore takeoff while they play.
import { getAudioContext } from './audioContext.js';
import { load, save } from '../core/storage.js';

export class Sfx {
  constructor(config) {
    this.cfg = config.sfx;
    this.muted = load('muted', false);
    this.blockedUntil = 0;
    this.out = null;
  }

  /** Also send the effects to a MediaStreamDestination (for the run video). */
  recordTo(dest) {
    if (this._recordDest === dest) return;
    this._recordDest = dest;
    if (this.out) { try { this.out.connect(dest); } catch { /* ignore */ } }
  }

  setMuted(m) {
    this.muted = m;
    save('muted', m);
  }

  _ctx() {
    const c = getAudioContext();
    if (!c || c.state !== 'running') return null;
    if (!this.out) {
      this.out = c.createGain();
      this.out.gain.value = this.cfg.volume;
      this.out.connect(c.destination);
      if (this._recordDest) this.out.connect(this._recordDest);
    }
    return c;
  }

  _tone(c, t0, freq, freqEnd, dur, type = 'square', vol = 0.5) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  _seq(notes, type, vol, step) {
    if (this.muted) return;
    const c = this._ctx();
    if (!c) return;
    const t0 = c.currentTime + 0.005;
    notes.forEach((f, i) => this._tone(c, t0 + i * step, f, null, step * 1.1, type, vol));
    this._block(notes.length * step);
  }

  _block(sec) {
    this.blockedUntil = performance.now() + sec * 1000 + this.cfg.micIgnoreMs;
  }

  get blocking() { return performance.now() < this.blockedUntil; }

  play(name) {
    if (this.muted) return;
    const c = this._ctx();
    if (!c) return;
    const t = c.currentTime + 0.005;
    switch (name) {
      case 'takeoff': this._tone(c, t, 520, 1100, 0.12, 'square', 0.25); this._block(0.12); break;
      case 'land': this._tone(c, t, 220, 110, 0.08, 'triangle', 0.5); this._block(0.08); break;
      case 'perfect': this._seq([880, 1320], 'square', 0.2, 0.06); break;
      case 'berry': this._tone(c, t, 1400, 2100, 0.07, 'square', 0.18); this._block(0.07); break;
      case 'bonk': this._tone(c, t, 180, 90, 0.1, 'square', 0.3); this._block(0.1); break;
      case 'hurt': this._tone(c, t, 330, 120, 0.18, 'square', 0.35); this._tone(c, t + 0.09, 260, 90, 0.16, 'square', 0.25); this._block(0.25); break;
      case 'ko': this._seq([523, 440, 349, 262, 196], 'square', 0.25, 0.09); break;
      case 'burn': this._tone(c, t, 900, 300, 0.2, 'sawtooth', 0.12); this._block(0.2); break;
      case 'chomp': this._tone(c, t, 160, 60, 0.15, 'square', 0.4); this._tone(c, t + 0.12, 140, 50, 0.15, 'square', 0.4); this._block(0.3); break;
      case 'whoosh': this._tone(c, t, 200, 1200, 0.4, 'sawtooth', 0.1); this._block(0.4); break;
      case 'screech': this._seq([1500, 1250, 1500, 1250], 'sawtooth', 0.08, 0.06); break;
      case 'blub': this._seq([220, 260, 200, 300, 180], 'sine', 0.35, 0.11); break;
      case 'milestone': this._seq([660, 880, 1100, 1320], 'square', 0.2, 0.07); break;
      case 'checkpoint': this._seq([523, 659, 784, 1046], 'triangle', 0.4, 0.08); break;
      case 'splash': this._tone(c, t, 600, 80, 0.4, 'sawtooth', 0.15); this._seq([392, 330, 262], 'triangle', 0.35, 0.12); break;
      default: break;
    }
  }
}
