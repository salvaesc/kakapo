// Phone vibration on the big moments (landing, losing a heart, dying).
// Uses navigator.vibrate: Android browsers support it; iPhone Safari does not (it's
// simply skipped there). Can be turned off in Settings.
import { load, save } from './storage.js';

const PATTERNS = {
  land: 12,
  bonk: 25,
  checkpoint: [20, 40, 20],
  hurt: [70, 40, 70],
  falcon: [15, 30, 15],
  dead: [160, 60, 260],
};

export class Haptics {
  constructor() {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    this.enabled = load('vibrate', true);
  }

  setEnabled(on) {
    this.enabled = on;
    save('vibrate', on);
    if (on) this.buzz('land');
  }

  buzz(kind) {
    if (!this.supported || !this.enabled) return;
    try { navigator.vibrate(PATTERNS[kind] ?? kind); } catch { /* ignored */ }
  }
}
