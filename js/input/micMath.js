// Pure microphone math — no browser APIs, unit-testable in Node.
import { clamp } from '../core/rng.js';

const MIN_DB = -100;

/** RMS of a time-domain buffer (Float32 samples in -1..1). */
export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function rmsToDb(r) {
  return r > 1e-5 ? Math.max(MIN_DB, 20 * Math.log10(r)) : MIN_DB;
}

/** Maps a dBFS value to 0..1 given the calibrated noise floor and dynamic range. */
export function dbToLevel(db, cal) {
  return clamp((db - cal.floorDb - cal.marginDb) / cal.rangeDb, 0, 1);
}

/** Asymmetric exponential smoothing: quick attack, gentler release. */
export function smoothLevel(prev, target, dt, attack, release) {
  const tau = target > prev ? attack : release;
  const a = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  return prev + (target - prev) * a;
}

export function percentile(values, p) {
  if (!values.length) return MIN_DB;
  const s = Array.from(values).sort((a, b) => a - b);
  const i = clamp(Math.round((s.length - 1) * p), 0, s.length - 1);
  return s[i];
}

/**
 * Builds calibration from samples gathered in a quiet phase and a loud phase.
 * The floor is a high percentile of the quiet phase (so steady fans/hum sit below level 0).
 * The range stretches so the player's loud sound lands near `loudHeadroom`.
 */
export function computeCalibration(quietDbs, loudDbs, cfg) {
  const floorDb = Math.max(percentile(quietDbs, 0.9), -90);
  const marginDb = cfg.floorMarginDb;
  let rangeDb = cfg.defaultRangeDb;
  let loudOk = false;
  if (loudDbs && loudDbs.length) {
    const loud = percentile(loudDbs, 0.8);
    const span = loud - floorDb - marginDb;
    if (span >= cfg.minRangeDb * cfg.loudHeadroom) {
      rangeDb = clamp(span / cfg.loudHeadroom, cfg.minRangeDb, cfg.maxRangeDb);
      loudOk = true;
    }
  }
  return { floorDb, marginDb, rangeDb, loudOk };
}

export function defaultCalibration(cfg) {
  const P = cfg.pitch;
  const lowHz = P.defaultSpeakHz * Math.pow(2, P.aboveSpeech / 12);
  return {
    version: 2, floorDb: -60, marginDb: cfg.floorMarginDb, rangeDb: cfg.defaultRangeDb, loudOk: false,
    speakHz: P.defaultSpeakHz, lowHz, highHz: lowHz * Math.pow(2, P.defaultRange / 12), pitchOk: false,
  };
}

// ---------------------------------------------------------------------------
// Pitch (how high the voice is). The game flies on pitch: talking normally does
// nothing, a high squeak flies. Uses YIN (de Cheveigné & Kawahara 2002) on a
// 2x-decimated buffer, which is plenty for voices (70–1600 Hz) and cheap on phones.
// ---------------------------------------------------------------------------

/** Scratch buffers for detectPitch, sized for a given input length (allocate once). */
export function createPitchWork(bufferLength) {
  const n = bufferLength >> 1;
  return { x: new Float32Array(n), d: new Float32Array(n) };
}

/**
 * Fundamental frequency of `buf` in Hz, or 0 when there is no clear pitch
 * (silence, noise, claps, breath). `work` comes from createPitchWork(buf.length).
 */
export function detectPitch(buf, sampleRate, work, minHz = 70, maxHz = 1600, threshold = 0.15) {
  const n = buf.length >> 1;
  const x = work.x, d = work.d;
  for (let i = 0; i < n; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
  const sr = sampleRate / 2;
  const maxTau = Math.min(Math.floor(sr / minHz), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sr / maxHz));
  const W = n - maxTau;
  // difference function
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const v = x[i] - x[i + tau];
      sum += v * v;
    }
    running += sum;
    // cumulative mean normalised difference
    d[tau] = running > 0 ? (sum * tau) / running : 1;
  }
  // first dip under the threshold, then follow it down to its local minimum
  let best = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 <= maxTau && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return 0;
  // parabolic interpolation around the minimum
  let t = best;
  if (best > 1 && best < maxTau) {
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c;
    if (den !== 0) t = best + (0.5 * (a - c)) / den;
  }
  return sr / t;
}

/** Semitones from a to b. */
export function semitones(a, b) {
  return 12 * Math.log2(b / a);
}

/**
 * Pitch → control level. Below `lowHz` (your normal voice + a bit) nothing happens;
 * from there to `highHz` (your best squeak) it climbs from just above the dead zone to 1.
 */
export function pitchToLevel(hz, cal, deadzone) {
  if (!hz || hz < cal.lowHz) return 0;
  const frac = semitones(cal.lowHz, hz) / semitones(cal.lowHz, cal.highHz);
  return clamp(deadzone + 0.02 + (1 - deadzone - 0.02) * frac, 0, 1);
}

/**
 * Builds the pitch part of the calibration from the pitches heard while the player said
 * "aaah" normally and while they squeaked as high as they could (0 = no pitch heard).
 */
export function computePitchCalibration(cal, normalHz, highHz, cfg) {
  const P = cfg.pitch;
  const voicedN = normalHz.filter((v) => v > 0);
  const voicedH = highHz.filter((v) => v > 0);
  const speakOk = voicedN.length >= 5;
  const speakHz = speakOk ? percentile(voicedN, 0.5) : P.defaultSpeakHz;
  const lowHz = speakHz * Math.pow(2, P.aboveSpeech / 12);
  let high = lowHz * Math.pow(2, P.defaultRange / 12);
  let highOk = false;
  if (voicedH.length >= 5) {
    const top = percentile(voicedH, 0.8) * P.highHeadroom;
    if (semitones(lowHz, top) >= P.minRange) { high = top; highOk = true; }
  }
  return { ...cal, version: 2, speakHz, lowHz, highHz: high, pitchOk: speakOk && highOk };
}
