import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { Sim } from '../js/game/sim.js';
import { autopilotLevel } from './autopilot.mjs';
import { sharkAt, spoutAt, waveHeight, eelAt } from '../js/game/hazards.js';

const cfg = structuredClone(CONFIG);
const L = cfg.lives;
const H = cfg.flight.hitHalfH;

function sim(seed = 3) {
  const s = new Sim(cfg);
  s.reset(seed);
  return s;
}

/** Runs frames, collecting event types. */
function run(s, seconds, level, stopWhen) {
  const seen = [];
  for (let i = 0; i < seconds * 60; i++) {
    s.update(1 / 60, typeof level === 'function' ? level(s) : level);
    for (let e = 0; e < s.eventCount; e++) seen.push(s.events[e].type);
    s.clearEvents();
    if (stopWhen && stopWhen(s)) break;
  }
  return seen;
}

/** Puts the bird in mid-air at (x, y) with no platform overlap. */
function placeInAir(s, x, y, vy = 0) {
  const b = s.bird;
  b.state = 'fly'; b.x = x; b.y = y; b.vy = vy; b.speed = 0;
  b.apexY = y; b.fallHeight = 0; b.stun = 0;
}

test('a run starts with 3 hearts', () => {
  assert.equal(sim().bird.lives, 3);
});

test('hitting the canopy costs one heart, then the bird blinks (no double loss)', () => {
  const s = sim();
  run(s, 1, 0.8, (x) => x.bird.state === 'fly');
  run(s, 6, 1, (x) => x.bird.lives < 3);
  assert.equal(s.bird.lives, 2);
  assert.equal(s.bird.hurtCause, 'ceiling');
  // keep shouting into the canopy during the immunity window
  const startInv = s.bird.invulnT;
  assert.ok(startInv > 1);
  run(s, startInv - 0.1, 1);
  assert.equal(s.bird.lives, 2, 'no second heart lost while blinking');
});

test('hitting a platform from below costs one heart', () => {
  const s = sim();
  const p = s.world.platforms[1];
  placeInAir(s, p.x + p.w / 2, p.y + p.h + H + 12, -60);
  const seen = run(s, 1, 1, (x) => x.bird.lives < 3);
  assert.ok(seen.includes('hurt'));
  assert.equal(s.bird.lives, 2);
  assert.equal(s.bird.hurtCause, 'underside');
});

test('hitting a platform side does not cost a heart', () => {
  const s = sim();
  const p = s.world.platforms[1];
  placeInAir(s, p.x - H - 8, p.y + p.h / 2);
  s.bird.speed = 80;
  run(s, 0.3, 0.6);
  assert.equal(s.bird.lives, 3);
});

test('falling into the river takes every heart', () => {
  const s = sim();
  const p0 = s.world.platforms[0], p1 = s.world.platforms[1];
  placeInAir(s, (p0.x + p0.w + p1.x) / 2, 200); // over the middle of the first gap
  const seen = run(s, 5, 0, (x) => x.dead);
  assert.ok(s.dead);
  assert.equal(s.bird.lives, 0);
  assert.equal(s.bird.deathCause, 'water');
  assert.ok(seen.includes('splash') && seen.includes('dead'));
});

test('a long free fall onto a platform costs a heart; a short one does not', () => {
  for (const [drop, expected] of [[L.hardFallHeight * 0.6, 3], [L.hardFallHeight + 20, 2]]) {
    const s = sim();
    const p = s.world.platforms[1];
    placeInAir(s, p.x + p.w / 2, p.y - H - drop);
    const seen = run(s, 4, 0, (x) => x.bird.state === 'rest');
    assert.equal(s.bird.state, 'rest', 'landed');
    assert.equal(s.bird.y, p.y - H, 'stands on the platform, not inside it');
    assert.equal(s.bird.lives, expected, `drop of ${drop}px`);
    if (expected < 3) { assert.ok(seen.includes('hurt')); assert.equal(s.bird.hurtCause, 'fall'); }
  }
});

test('braking a dive with sound resets the fall height', () => {
  const s = sim();
  const p = s.world.platforms[1];
  placeInAir(s, p.x + p.w / 2, p.y - H - (L.hardFallHeight + 30));
  // fall most of the way, brake with a burst of sound until the bird goes up, then drop the rest
  let braked = false;
  run(s, 4, (x) => {
    if (x.bird.vy < 0) braked = true;
    return !braked && x.bird.fallHeight > L.hardFallHeight * 0.5 ? 1 : 0;
  }, () => braked);
  assert.ok(braked && s.bird.fallHeight < 1, 'apex reset while going up');
  run(s, 4, 0, (x) => x.bird.state === 'rest');
  assert.equal(s.bird.state, 'rest');
  assert.equal(s.bird.lives, 3);
});

test('losing the last heart in the air: KO tumble, then dead', () => {
  const s = sim();
  s.bird.lives = 1;
  run(s, 1, 0.8, (x) => x.bird.state === 'fly');
  run(s, 6, 1, (x) => x.bird.state !== 'fly');
  assert.equal(s.bird.state, 'ko');
  const xKo = s.bird.x;
  run(s, 6, 1, (x) => x.dead); // input is ignored while KO
  assert.ok(s.dead);
  assert.equal(s.bird.deathCause, 'ceiling');
  assert.ok(Math.abs(s.bird.x - xKo) < 80, 'no flying away while KO (just momentum)');
});

test('losing the last heart on a hard landing: dead on the platform', () => {
  const s = sim();
  s.bird.lives = 1;
  const p = s.world.platforms[1];
  placeInAir(s, p.x + p.w / 2, p.y - H - (L.hardFallHeight + 30));
  run(s, 4, 0, (x) => x.dead);
  assert.ok(s.dead);
  assert.ok(s.bird.deadOnGround);
  assert.equal(s.bird.deathCause, 'fall');
});

test('a careful scripted player rarely loses hearts', () => {
  let hurts = 0, landings = 0;
  const noHz = structuredClone(cfg);
  noHz.hazards.enabled = false;
  for (let seed = 1; seed <= 20; seed++) {
    const s = new Sim(noHz);
    s.reset(seed);
    run(s, 120, autopilotLevel, (x) => x.dead || x.bird.landings > 30);
    hurts += 3 - s.bird.lives;
    landings += s.bird.landings;
  }
  console.log(`autopilot: ${landings} landings, ${hurts} hearts lost over 20 runs`);
  assert.ok(landings > 400);
  assert.ok(hurts <= 10, `hearts lost ${hurts}`);
});

// ---------- canopy maze, fire, river hazards ----------

/** Finds the first generated item matching `pred`, generating further if needed. */
function findIn(s, list, pred) {
  for (let k = 0; k < 40; k++) {
    const hit = s.world[list].find(pred);
    if (hit) return hit;
    s.world.update(-1000, s.world.platforms[s.world.platforms.length - 1].x + 400);
  }
  throw new Error('not generated: ' + list);
}

test('flying into the side of a hanging canopy mass costs a heart and knocks back', () => {
  const s = sim(4);
  const c = findIn(s, 'ceilings', (c) => c.kind === 'drop');
  placeInAir(s, c.x - H - 6, c.y - 8); // head-height inside the mass's band
  s.bird.speed = 90;
  run(s, 0.5, 0.45, (x) => x.bird.lives < 3);
  assert.equal(s.bird.lives, 2);
  assert.equal(s.bird.hurtCause, 'ceiling');
  assert.ok(s.bird.x < c.x, 'stays outside the mass');
});

test('flying under a hanging mass is safe', () => {
  const s = sim(4);
  const c = findIn(s, 'ceilings', (c) => c.kind === 'drop');
  placeInAir(s, c.x - H - 6, c.y + H + 6);
  s.bird.speed = 60;
  // hold altitude roughly: tiny bursts
  run(s, (c.w + 30) / 60, (x) => (x.bird.vy > 10 ? 0.35 : 0));
  assert.equal(s.bird.lives, 3);
});

test('landing on a burning island costs a heart and bounces the bird up (no resting)', () => {
  const s = sim(2);
  const p = findIn(s, 'platforms', (p) => p.fire);
  placeInAir(s, p.x + p.w / 2, p.y - H - 30);
  const seen = run(s, 0.6, 0, (x) => x.bird.lives < 3);
  assert.ok(seen.includes('burn'));
  assert.equal(s.bird.lives, 2);
  assert.equal(s.bird.hurtCause, 'fire');
  assert.equal(s.bird.state, 'fly');
  assert.ok(s.bird.vy < 0, 'bouncing up');
});

function hazardSim(type) {
  const s = sim(6);
  const hz = findIn(s, 'hazards', (h) => h.type === type);
  return { s, hz };
}

test('a leaping shark kills (all hearts)', () => {
  const { s, hz } = hazardSim('shark');
  const st = { };
  // jump to the middle of a leap and put the bird exactly where the shark is
  let t = 0;
  while (sharkAt(hz, t, st).mode !== 'leap' || st.u < 0.45) t += 0.01;
  s.time = t;
  placeInAir(s, st.x, st.y);
  const seen = run(s, 0.05, 0.4, (x) => x.dead);
  assert.ok(seen.includes('chomp'));
  assert.ok(s.dead);
  assert.equal(s.bird.deathCause, 'shark');
  assert.equal(s.bird.lives, 0);
});

test('a hidden shark (only the fin showing) does not kill', () => {
  const { s, hz } = hazardSim('shark');
  const st = {};
  let t = 0;
  while (sharkAt(hz, t, st).mode !== 'fin') t += 0.01;
  s.time = t;
  placeInAir(s, st.x, cfg.field.waterY - 40);
  run(s, 0.1, 0.5);
  assert.ok(!s.dead);
});

test('a giant wave kills when it reaches the bird; the calm phase does not', () => {
  const { s, hz } = hazardSim('wave');
  let t = 0;
  while (waveHeight(hz, hz.xc, t) < hz.amp * 0.95) t += 0.01;
  s.time = t;
  placeInAir(s, hz.xc, cfg.field.waterY - hz.amp * 0.6);
  run(s, 0.05, 0.4, (x) => x.dead);
  assert.ok(s.dead);
  assert.equal(s.bird.deathCause, 'wave');

  const s2 = sim(6);
  const hz2 = findIn(s2, 'hazards', (h) => h.type === 'wave');
  let t2 = 0;
  while (waveHeight(hz2, hz2.xc, t2) > 0) t2 += 0.01;
  s2.time = t2 + 0.05;
  placeInAir(s2, hz2.xc, cfg.field.waterY - hz2.amp * 0.6);
  run(s2, 0.1, 0.4);
  assert.ok(!s2.dead);
});

test('a waterspout kills on contact and pulls the bird in; when off it is harmless', () => {
  const { s, hz } = hazardSim('spout');
  const st = {};
  let t = 0;
  while (spoutAt(hz, t, st).mode !== 'hold') t += 0.01;
  s.time = t;
  placeInAir(s, st.x - 30, 200);
  const x0 = s.bird.x;
  run(s, 0.05, 0.4);
  assert.ok(s.bird.x > x0, 'pulled towards the column');
  placeInAir(s, spoutAt(hz, s.time, st).x, 200);
  run(s, 0.05, 0.4, (x) => x.dead);
  assert.ok(s.dead);
  assert.equal(s.bird.deathCause, 'spout');

  const s2 = sim(6);
  const hz2 = findIn(s2, 'hazards', (h) => h.type === 'spout');
  let t2 = 0;
  while (spoutAt(hz2, t2, st).mode !== 'off') t2 += 0.01;
  s2.time = t2;
  placeInAir(s2, spoutAt(hz2, t2, st).x, 200);
  run(s2, 0.1, 0.4);
  assert.ok(!s2.dead);
});


test('a striking eel kills; its warning bubbles do not', () => {
  const { s, hz } = hazardSim('eel');
  const st = {};
  let t = 0;
  while (eelAt(hz, t, st).mode !== 'bubbles') t += 0.01;
  s.time = t + 0.05;
  placeInAir(s, hz.xe, cfg.field.waterY - 30);
  run(s, 0.05, 0.4);
  assert.ok(!s.dead, 'bubbles are harmless');
  while (eelAt(hz, t, st).mode !== 'strike' || st.u < 0.45) t += 0.01;
  s.time = t;
  placeInAir(s, hz.xe, st.headY + 2);
  const seen = run(s, 0.05, 0.4, (x) => x.dead);
  assert.ok(seen.includes('snap'));
  assert.ok(s.dead);
  assert.equal(s.bird.deathCause, 'eel');
});

/** Flies straight at a fixed height until the first falcon dive is over. */
function falconRun(dodge) {
  const s = sim(9);
  // open sky: nothing to bump into but the falcon
  const w = s.world;
  w.platforms.splice(0, w.platforms.length, { x: 1e6, y: 260, w: 50, h: 20, visited: true });
  w.ceilings.splice(0, w.ceilings.length, { x: -1e6, w: 2e6, y: 20, kind: 'normal' });
  w.hazards.length = 0;
  w.update = () => {};
  s.pred.t = 0.01;
  placeInAir(s, 500, 150);
  s.bird.startX = -1e4; // far enough to unlock the falcon
  let hold = 150, seen = [];
  for (let i = 0; i < 60 * 4; i++) {
    // ideal altitude hold around `hold` (test harness: we move the bird directly)
    if (dodge && s.pred.state === 'warn' && s.pred.t < cfg.predator.lockAt) hold = s.pred.targetY - 40;
    s.bird.y += (hold - s.bird.y) * 0.25;
    s.bird.vy = 0; s.bird.speed = 70; s.bird.apexY = s.bird.y;
    s.step(1 / 60, 0.3, true);
    for (let e = 0; e < s.eventCount; e++) seen.push(s.events[e].type);
    s.clearEvents();
    if (seen.includes('falconHit') || (seen.includes('falconDive') && s.pred.state === 'off')) break;
  }
  return { s, seen };
}

test('the falcon warns, then dives at the height it locked; changing height dodges it', () => {
  const still = falconRun(false);
  assert.ok(still.seen.includes('falconWarn') && still.seen.includes('falconDive'));
  assert.ok(still.seen.includes('falconHit'), 'holding your height gets you hit');
  assert.equal(still.s.bird.lives, 2);
  assert.equal(still.s.bird.hurtCause, 'falcon');
  const moved = falconRun(true);
  assert.ok(moved.seen.includes('falconDive'));
  assert.ok(!moved.seen.includes('falconHit'), 'changing height after the "!" dodges it');
  assert.equal(moved.s.bird.lives, 3);
});

test('the falcon ignores a perched (frozen) kakapo', () => {
  const s = sim(9);
  s.bird.startX = -1e4;
  s.bird.maxX = s.bird.x;
  s.metres = 999;
  s.pred.state = 'warn';
  s.pred.t = 0.8;
  const seen = run(s, 3, 0);
  assert.equal(s.bird.state, 'rest');
  assert.ok(seen.includes('falconGone'));
  assert.ok(!seen.includes('falconDive'));
  assert.equal(s.bird.lives, 3);
});
