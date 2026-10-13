import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { rms, rmsToDb, dbToLevel, smoothLevel, computeCalibration } from '../js/input/micMath.js';
import { detectPitch, createPitchWork, pitchToLevel, computePitchCalibration, defaultCalibration, semitones } from '../js/input/micMath.js';


const M = CONFIG.mic;

test('rms and dB of a sine', () => {
  const buf = new Float32Array(1024);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((i / buf.length) * Math.PI * 2 * 8);
  const r = rms(buf);
  assert.ok(Math.abs(r - 0.5 / Math.SQRT2) < 1e-3);
  assert.ok(Math.abs(rmsToDb(r) - -9.03) < 0.1);
  assert.equal(rmsToDb(0), -100);
});

test('calibration: floor from quiet, range from loud', () => {
  const quiet = Array.from({ length: 80 }, (_, i) => -62 + (i % 5)); // -62..-58
  const loud = Array.from({ length: 80 }, () => -20);
  const cal = computeCalibration(quiet, loud, M);
  assert.ok(cal.floorDb >= -61 && cal.floorDb <= -59, `floor ${cal.floorDb}`);
  assert.ok(cal.loudOk);
  // ambient noise maps to 0
  assert.equal(dbToLevel(-60, cal), 0);
  // your calibration shout is full speed; a softer aaah is slower; talking-level sound barely moves
  assert.ok(dbToLevel(-20, cal) > 0.99);
  const span = -20 - cal.floorDb - cal.marginDb;
  assert.ok(dbToLevel(cal.floorDb + cal.marginDb + span * 0.5, cal) < 0.6, 'a softer aaah is slower');
  assert.equal(dbToLevel(cal.floorDb + cal.marginDb - 1, cal), 0, 'below the shout threshold: nothing');
});

test('calibration falls back to default range if the loud step was too quiet', () => {
  const quiet = Array(50).fill(-50);
  const loud = Array(50).fill(-40);
  const cal = computeCalibration(quiet, loud, M);
  assert.equal(cal.loudOk, false);
  assert.equal(cal.rangeDb, M.defaultRangeDb);
});

test('smoothing: responds within a few frames both ways (stopping is quickest)', () => {
  let v = 0;
  for (let i = 0; i < 6; i++) v = smoothLevel(v, 1, 1 / 60, M.attack, M.release);
  const afterAttack = v;
  for (let i = 0; i < 6; i++) v = smoothLevel(v, 0, 1 / 60, M.attack, M.release);
  assert.ok(afterAttack > 0.7, `attack ${afterAttack}`);
  assert.ok(v < 0.15, `release is quick (${v})`);
});

// ---------- pitch ----------

function tone(hz, sr = 48000, n = 2048, shape = 'sine', amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (i * hz) / sr;
    b[i] = shape === 'saw' ? amp * (2 * (ph - Math.floor(ph)) - 1) : amp * Math.sin(2 * Math.PI * ph);
  }
  return b;
}

test('pitch detection: sines and voice-like (sawtooth) tones across the voice range', () => {
  const work = createPitchWork(2048);
  for (const sr of [44100, 48000]) {
    for (const hz of [90, 150, 220, 440, 700, 1000, 1400]) {
      for (const shape of ['sine', 'saw']) {
        const got = detectPitch(tone(hz, sr, 2048, shape), sr, work);
        assert.ok(Math.abs(semitones(hz, got)) < 0.35, `${shape} ${hz} Hz @${sr} → ${got.toFixed(1)}`);
      }
    }
  }
});

test('pitch detection: noise and silence have no pitch', () => {
  const work = createPitchWork(2048);
  let seed = 7;
  const noise = new Float32Array(2048).map(() => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.6; });
  assert.equal(detectPitch(noise, 48000, work), 0);
  assert.equal(detectPitch(new Float32Array(2048), 48000, work), 0);
});

test('pitch → level: talking does nothing, higher flies more, capped', () => {
  const cal = { lowHz: 250, highHz: 700 };
  assert.equal(pitchToLevel(0, cal, 0.07), 0);
  assert.equal(pitchToLevel(200, cal, 0.07), 0, 'normal voice');
  const a = pitchToLevel(260, cal, 0.07), b = pitchToLevel(450, cal, 0.07), c = pitchToLevel(700, cal, 0.07);
  assert.ok(a > 0.07 && a < b && b < c, `${a} ${b} ${c}`);
  assert.equal(pitchToLevel(2000, cal, 0.07), 1);
});

test('pitch calibration adapts to deep and high voices', () => {
  const cfgM = CONFIG.mic;
  const base = defaultCalibration(cfgM);
  const deep = computePitchCalibration(base, Array(40).fill(110), Array(40).fill(400), cfgM);
  const high = computePitchCalibration(base, Array(40).fill(230), Array(40).fill(900), cfgM);
  assert.ok(deep.pitchOk && high.pitchOk);
  assert.ok(deep.lowHz > 110 && deep.lowHz < 130, `deep low ${deep.lowHz}`);
  assert.ok(high.lowHz > 230 && high.lowHz < 270, `high low ${high.lowHz}`);
  // a deep voice's squeak flies; a high voice speaking normally does not
  assert.ok(pitchToLevel(380, deep, 0.07) > 0.8);
  assert.equal(pitchToLevel(230, high, 0.07), 0);
});

test('pitch calibration falls back sensibly when nothing was heard', () => {
  const cfgM = CONFIG.mic;
  const cal = computePitchCalibration(defaultCalibration(cfgM), [0, 0, 0], [0, 0], cfgM);
  assert.equal(cal.pitchOk, false);
  assert.ok(Math.abs(semitones(cal.lowHz, cal.highHz) - cfgM.pitch.defaultRange) < 1e-6);
});

test('a word or a bump during the quiet step does not make the game deaf', () => {
  // 2.5 s at 60 fps: room at -60 dB, with 0.6 s of the player talking (-25 dB) in the middle
  const quiet = Array.from({ length: 150 }, (_, i) => (i > 50 && i < 86 ? -25 : -60));
  const cal = computeCalibration(quiet, null, M);
  assert.ok(cal.floorDb < -55, `floor stays at the room's level (${cal.floorDb})`);
  // so a normal voice (-35 dB) is still heard
  assert.ok(-35 > cal.floorDb + cal.marginDb);
});
