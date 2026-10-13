import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { Sim } from '../js/game/sim.js';
import { shapeLevel, stepVertical, stepScroll } from '../js/game/physics.js';
import { hitFace } from '../js/game/collision.js';
import { autopilotLevel } from './autopilot.mjs';

const cfg = structuredClone(CONFIG);

function freshFlying(seed = 3) {
  const sim = new Sim(cfg);
  sim.reset(seed);
  // take off first
  for (let i = 0; i < 60 && sim.resting; i++) sim.update(1 / 60, 0.8);
  assert.equal(sim.bird.state, 'fly');
  return sim;
}

test('level shaping: deadzone, monotonic, capped', () => {
  assert.equal(shapeLevel(0, cfg.control), 0);
  assert.equal(shapeLevel(cfg.control.deadzone, cfg.control), 0);
  let prev = 0;
  for (let l = 0.1; l <= 1; l += 0.1) {
    const s = shapeLevel(l, cfg.control);
    assert.ok(s >= prev);
    prev = s;
  }
  assert.ok(Math.abs(shapeLevel(1, cfg.control) - 1) < 1e-9);
});

test('silence makes the bird descend and slows progress', () => {
  let vy = -50, speed = 80;
  for (let i = 0; i < 120; i++) {
    vy = stepVertical(vy, 0, 1 / 120, cfg.flight, false);
    speed = stepScroll(speed, 0, 1 / 120, cfg.scroll, false);
  }
  assert.ok(vy > 100, `falling after 1s of silence (vy=${vy})`);
  assert.ok(vy <= cfg.flight.maxFall);
  assert.ok(speed <= cfg.scroll.silent + 1e-6, `progress nearly stops (speed=${speed})`);
});

test('soft and loud sound produce clearly different climb and speed', () => {
  const run = (level) => {
    let vy = 0, speed = 0;
    const s = shapeLevel(level, cfg.control);
    for (let i = 0; i < 240; i++) {
      vy = stepVertical(vy, s, 1 / 120, cfg.flight, false);
      speed = stepScroll(speed, s, 1 / 120, cfg.scroll, false);
    }
    return { vy, speed };
  };
  const soft = run(0.2), med = run(0.5), loud = run(1);
  assert.ok(soft.vy < 0, 'soft sound ascends');
  assert.ok(-loud.vy > -soft.vy * 1.8, `loud climbs much faster (${soft.vy} vs ${loud.vy})`);
  assert.ok(loud.speed > soft.speed * 2.5, `loud scrolls much faster (${soft.speed} vs ${loud.speed})`);
  assert.ok(med.speed > soft.speed && med.speed < loud.speed);
});

test('a shout never exceeds the climb cap', () => {
  let vy = 0;
  for (let i = 0; i < 600; i++) vy = stepVertical(vy, 1, 1 / 120, cfg.flight, false);
  assert.ok(vy >= -cfg.flight.maxClimb - 1e-6);
});

test('collision faces are resolved from the previous position', () => {
  const p = { x: 100, y: 200, w: 60, h: 20 };
  assert.equal(hitFace(130, 190, 130, 195, 6, 7, p), 'top');
  assert.equal(hitFace(130, 228, 130, 225, 6, 7, p), 'bottom');
  assert.equal(hitFace(92, 210, 96, 210, 6, 7, p), 'left');
  assert.equal(hitFace(130, 150, 130, 160, 6, 7, p), null);
});

test('bird lands, stays perched in silence, does not sink', () => {
  const sim = freshFlying();
  // climb a bit then go silent above the first platform? Use autopilot until first landing.
  let landed = false;
  for (let i = 0; i < 60 * 20 && !landed; i++) {
    sim.update(1 / 60, autopilotLevel(sim));
    for (let e = 0; e < sim.eventCount; e++) if (sim.events[e].type === 'land') landed = true;
    sim.clearEvents();
  }
  assert.ok(landed, 'autopilot lands on a platform');
  const p = sim.bird.restPlatform;
  const x0 = sim.bird.x;
  for (let i = 0; i < 60 * 30; i++) sim.update(1 / 60, 0);
  assert.equal(sim.bird.state, 'rest');
  assert.equal(sim.bird.x, x0, 'world does not scroll while resting');
  assert.equal(sim.bird.y, p.y - cfg.flight.hitHalfH, 'feet exactly on the platform top');
});

test('ambient noise below threshold / short blips do not trigger takeoff', () => {
  const sim = new Sim(cfg);
  sim.reset(5);
  for (let i = 0; i < 60 * 10; i++) sim.update(1 / 60, cfg.rest.takeoffLevel * 0.8);
  assert.equal(sim.bird.state, 'rest', 'steady ambient noise below threshold');
  for (let k = 0; k < 20; k++) {
    for (let i = 0; i < 5; i++) sim.update(1 / 60, 1); // 83 ms blip
    for (let i = 0; i < 30; i++) sim.update(1 / 60, 0);
  }
  assert.equal(sim.bird.state, 'rest', 'short loud blips (claps, clicks)');
  for (let i = 0; i < 30; i++) sim.update(1 / 60, 0.5);
  assert.equal(sim.bird.state, 'fly', 'sustained sound takes off');
});

test('takeoff is blocked while a sound effect is playing', () => {
  const sim = new Sim(cfg);
  sim.reset(5);
  for (let i = 0; i < 60; i++) sim.update(1 / 60, 1, false);
  assert.equal(sim.bird.state, 'rest');
});

test('canopy bonk keeps the bird on screen', () => {
  const sim = freshFlying();
  for (let i = 0; i < 60 * 6 && sim.bird.state === 'fly'; i++) {
    sim.update(1 / 60, 1);
    const b = sim.bird;
    assert.ok(b.y - cfg.flight.hitHalfH >= sim.world.ceilAt(b.x) - 1e-6, 'never inside the canopy');
  }
});

test('falling into the river ends the run', () => {
  const sim = freshFlying();
  const p0 = sim.world.platforms[0], p1 = sim.world.platforms[1];
  Object.assign(sim.bird, { x: (p0.x + p0.w + p1.x) / 2, y: 200, vy: 0, speed: 0, apexY: 200 });
  for (let i = 0; i < 60 * 5 && !sim.dead; i++) sim.update(1 / 60, 0);
  assert.ok(sim.dead);
});

test('same seed + same input = same run (determinism)', () => {
  const a = new Sim(cfg), b = new Sim(cfg);
  a.reset(42); b.reset(42);
  for (let i = 0; i < 60 * 30; i++) {
    a.update(1 / 60, autopilotLevel(a)); a.clearEvents();
    b.update(1 / 60, autopilotLevel(b)); b.clearEvents();
  }
  assert.equal(a.score, b.score);
  assert.equal(a.bird.x, b.bird.x);
});

test('lowering your voice brakes the climb quickly (no runaway climbs)', () => {
  let vy = 0;
  for (let i = 0; i < 120; i++) vy = stepVertical(vy, 1, 1 / 120, cfg.flight, false); // full climb
  const full = vy;
  let t = 0;
  while (vy < full * 0.6 && t < 1) { vy = stepVertical(vy, shapeLevel(0.15, cfg.control), 1 / 120, cfg.flight, false); t += 1 / 120; }
  assert.ok(t < 0.12, `40% of the climb speed is gone ${t.toFixed(3)} s after lowering the voice`);
});
