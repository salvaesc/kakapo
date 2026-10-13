import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { Sim } from '../js/game/sim.js';
import { World } from '../js/game/world.js';
import { autopilotLevel } from './autopilot.mjs';

const cfg = structuredClone(CONFIG);

test('platforms stay inside the playfield and never overlap', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const w = new World(cfg);
    w.reset(seed);
    w.update(0, 6000);
    const ps = w.platforms;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      assert.ok(p.y >= cfg.field.platformMinY && p.y <= cfg.field.platformMaxY);
      assert.ok(p.w >= 30);
      if (i) assert.ok(p.x > ps[i - 1].x + ps[i - 1].w, 'gap between platforms');
    }
    for (const b of w.berries) {
      assert.ok(b.y > w.ceilAt(b.x) + 8 && b.y < cfg.field.waterY, `berry ${b.x},${b.y} below canopy`);
    }
  }
});

test('difficulty ramps: later gaps are wider on average', () => {
  const w = new World(cfg);
  w.reset(7);
  w.update(0, 20000);
  const gaps = [];
  for (let i = 1; i < w.platforms.length; i++) gaps.push(w.platforms[i].x - (w.platforms[i - 1].x + w.platforms[i - 1].w));
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(gaps.slice(30, 50)) > avg(gaps.slice(0, 10)) + 20);
});

test('generated levels are reachable by a simple scripted player (canopy maze, fire; no river hazards)', () => {
  const noHz = structuredClone(cfg);
  noHz.hazards.enabled = false;
  const results = [];
  for (let seed = 1; seed <= 30; seed++) {
    const sim = new Sim(noHz);
    sim.reset(seed);
    let landings = 0;
    for (let i = 0; i < 60 * 300 && !sim.dead && landings < 45; i++) {
      sim.update(1 / 60, autopilotLevel(sim));
      for (let e = 0; e < sim.eventCount; e++) if (sim.events[e].type === 'land' && sim.events[e].a > 0) landings++;
      sim.clearEvents();
    }
    results.push(landings);
  }
  const min = Math.min(...results);
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  console.log('autopilot new-platform landings per seed:', results.join(' '), `avg=${avg.toFixed(1)}`);
  // The autopilot is crude; we require that it gets well past the difficulty ramp on average.
  assert.ok(avg >= 30, `average landings ${avg}`);
  assert.ok(min >= 8, `worst seed ${min}`);
});

test('canopy: contiguous, hanging masses only over gaps and always leave room underneath', () => {
  const C = cfg.ceiling;
  let drops = 0, clearings = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(cfg);
    w.reset(seed);
    w.update(0, 8000);
    const cs = w.ceilings;
    for (let i = 1; i < cs.length; i++) assert.equal(cs[i].x, cs[i - 1].x + cs[i - 1].w, 'no holes between segments');
    const ps = w.platforms;
    for (const c of cs) {
      if (c.kind === 'clearing') clearings++;
      if (c.kind !== 'drop') continue;
      drops++;
      const over = ps.filter((p) => p.x < c.x + c.w && p.x + p.w > c.x);
      assert.equal(over.length, 0, 'never directly over an island');
      const left = ps.filter((p) => p.x + p.w <= c.x).pop();
      const right = ps.find((p) => p.x >= c.x + c.w);
      assert.ok(c.y <= Math.min(left.y, right.y) - C.clearGap, 'room to fly under it');
    }
  }
  assert.ok(drops > 100 && clearings > 30, `variety: ${drops} drops, ${clearings} clearings`);
});

test('burning islands: never checkpoints, never two in a row, no hazard in the gap before them', () => {
  let fires = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(cfg);
    w.reset(seed);
    w.update(0, 8000);
    const ps = w.platforms;
    for (let i = 1; i < ps.length; i++) {
      if (!ps[i].fire) continue;
      fires++;
      assert.ok(!ps[i].checkpoint);
      assert.ok(!ps[i - 1].fire);
      const gx0 = ps[i - 1].x + ps[i - 1].w;
      assert.ok(!w.hazards.some((h) => h.x0 === gx0), 'gap into a burning island is calm');
    }
  }
  assert.ok(fires > 40, `fires: ${fires}`);
});

test('hazards sit inside gaps and unlock progressively', () => {
  const firstIndex = { shark: Infinity, wave: Infinity, spout: Infinity, eel: Infinity };
  let n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(cfg);
    w.reset(seed);
    w.update(0, 8000);
    const ps = w.platforms;
    for (const h of w.hazards) {
      n++;
      const i = ps.findIndex((p) => p.x === h.x1);
      assert.ok(i > 0, 'hazard sits in exactly one gap');
      assert.equal(h.x0, ps[i - 1].x + ps[i - 1].w);
      firstIndex[h.type] = Math.min(firstIndex[h.type], ps[i].index);
    }
  }
  assert.ok(n > 300, `hazards: ${n}`);
  assert.ok(firstIndex.shark >= cfg.hazards.shark.unlock);
  assert.ok(firstIndex.wave >= cfg.hazards.wave.unlock);
  assert.ok(firstIndex.spout >= cfg.hazards.spout.unlock);
  assert.ok(firstIndex.eel >= cfg.hazards.eel.unlock && firstIndex.eel < Infinity);
});

test('more river danger: most gaps have a hazard, some wide gaps have two different ones', () => {
  let gaps = 0, withHz = 0, doubles = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = new World(cfg);
    w.reset(seed);
    w.update(0, 8000);
    const ps = w.platforms;
    for (let i = 8; i < ps.length; i++) {
      if (ps[i].fire) continue;
      gaps++;
      const x0 = ps[i - 1].x + ps[i - 1].w;
      const hs = w.hazards.filter((h) => h.x0 === x0);
      if (hs.length) withHz++;
      if (hs.length === 2) { doubles++; assert.notEqual(hs[0].type, hs[1].type); }
      assert.ok(hs.length <= 2);
    }
  }
  console.log(`gaps with hazards: ${(100 * withHz / gaps).toFixed(0)}%, doubles: ${doubles}`);
  assert.ok(withHz / gaps > 0.7);
  assert.ok(doubles > 20);
});

test('river hazards always leave windows: a patient scripted player survives them', () => {
  const noFalcon = structuredClone(cfg);
  noFalcon.predator.enabled = false;
  let alive = 0, landings = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const sim = new Sim(noFalcon);
    sim.reset(seed);
    for (let i = 0; i < 60 * 150 && !sim.dead; i++) { sim.update(1 / 60, autopilotLevel(sim)); sim.clearEvents(); }
    if (!sim.dead) alive++;
    landings += sim.bird.landings;
  }
  console.log(`patient player, river hazards: ${alive}/15 alive, ${landings} landings`);
  assert.ok(alive >= 13, `alive ${alive}`);
  assert.ok(landings >= 100);
});

test('gentle start: the first islands are close, level and safe', () => {
  const E = cfg.world.easyStart;
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(cfg);
    w.reset(seed);
    w.update(0, 3000);
    const ps = w.platforms;
    const end = ps[E.islands].x + ps[E.islands].w;
    for (let i = 1; i <= E.islands; i++) {
      const p = ps[i], q = ps[i - 1];
      assert.ok(p.x - (q.x + q.w) <= E.gap[1] + 1, 'short gap');
      assert.ok(Math.abs(p.y - q.y) <= E.step + 1, 'almost level');
      assert.ok(!p.fire, 'no fire');
    }
    assert.ok(!w.hazards.some((h) => h.x0 < end), 'no river hazards');
    assert.ok(!w.ceilings.some((c) => c.kind === 'drop' && c.x < end), 'no hanging canopy');
  }
});

test('gentle start lasts only a few seconds of play', () => {
  const times = [];
  for (let seed = 1; seed <= 12; seed++) {
    const s = new Sim(structuredClone(cfg));
    s.reset(seed);
    const end = s.world.platforms[cfg.world.easyStart.islands];
    let t = 0, flying = 0;
    while (t < 40 && s.bird.x < end.x + end.w) {
      s.update(1 / 60, autopilotLevel(s), true);
      s.clearEvents();
      t += 1 / 60;
      if (s.bird.state === 'fly') flying += 1 / 60;
    }
    times.push(flying);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  // flying time (the autopilot also stops to rest on islands, a player doesn't have to)
  assert.ok(avg > 4 && avg < 8, `about 5–7 s of flying: avg ${avg.toFixed(1)} s`);
});
