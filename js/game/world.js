// World and platform generation. Platforms, the canopy above them and the hazards in
// the river stream in ahead of the camera and are dropped behind it. Difficulty ramps
// with the platform index.
//
// Fairness rules the generator always keeps:
//  - hanging canopy masses only hang over gaps, and stay `clearGap` above the lower
//    neighbouring island, so there is always a way underneath;
//  - a burning island is never a checkpoint, never follows another burning island,
//    and the gap leading into it has no river hazard;
//  - every river hazard is cyclic, so waiting on an island always opens a window.
import { createRng, lerp, clamp } from '../core/rng.js';
import { waveHeight } from './hazards.js';

export class World {
  constructor(config) {
    this.cfg = config;
    this.platforms = [];
    this.berries = [];
    this.ceilings = [];  // contiguous segments { x, w, y, kind: 'normal'|'clearing'|'drop' }
    this.hazards = [];   // { type: 'shark'|'wave'|'spout', x0, x1, ... }
    this.rng = createRng(1);
    this.nextIndex = 0;
  }

  reset(seed) {
    this.rng = createRng(seed);
    this.seed = seed;
    this.platforms.length = 0;
    this.berries.length = 0;
    this.ceilings.length = 0;
    this.hazards.length = 0;
    this.nextIndex = 0;
    const f = this.cfg.world.firstPlatform;
    this._add(f.x, f.y, f.w, f.h, false, false);
    this._ceil(f.x - 400, f.w + 400, this.cfg.field.ceilingY, 'normal');
  }

  difficulty(index) {
    return clamp(index / this.cfg.world.rampPlatforms, 0, 1);
  }

  _add(x, y, w, h, checkpoint, fire) {
    const p = {
      id: this.nextIndex,
      index: this.nextIndex,
      x, y, w, h,
      checkpoint,
      fire,
      visited: this.nextIndex === 0,
      artSeed: Math.floor(this.rng.next() * 1e9),
      art: null, // render cache, owned by the renderer
    };
    this.nextIndex++;
    this.platforms.push(p);
    return p;
  }

  _ceil(x, w, y, kind) {
    const s = { x: Math.round(x), w: Math.round(w), y: Math.round(y), kind, artSeed: Math.floor(this.rng.next() * 1e9), art: null };
    this.ceilings.push(s);
    return s;
  }

  /** Picks a canopy height for a span whose hanging masses must stay above `limit`. */
  _pickCeiling(index, limit) {
    const C = this.cfg.ceiling;
    const normal = this.cfg.field.ceilingY;
    if (index < C.startAfter) return { y: normal, kind: 'normal' };
    const d = this.difficulty(index);
    const r = this.rng.next();
    const pClear = lerp(C.clearingChance[0], C.clearingChance[1], d);
    const pDrop = lerp(C.dropChance[0], C.dropChance[1], d);
    if (r < pClear) return { y: C.clearingY, kind: 'clearing' };
    if (r < pClear + pDrop) {
      const lo = normal + C.minDrop;
      const hi = Math.min(limit, normal + lerp(C.maxDrop[0], C.maxDrop[1], d));
      if (hi >= lo) return { y: Math.round(this.rng.range(lo, hi)), kind: 'drop' };
    }
    return { y: normal, kind: 'normal' };
  }

  /** Generates the platform that follows `prev`. Pure function of the RNG stream. */
  _generateNext(prev) {
    const W = this.cfg.world;
    const F = this.cfg.field;
    const Hz = this.cfg.hazards;
    const CL = this.cfg.ceiling;
    const r = this.rng;
    const index = this.nextIndex;
    const d = this.difficulty(index);
    const checkpoint = index % W.checkpointEvery === 0;

    const E = W.easyStart;
    const easy = !!E && index <= E.islands;

    let gap = lerp(W.gapMin[0], W.gapMin[1], d) + r.next() * lerp(W.gapRand[0], W.gapRand[1], d);
    let w = lerp(W.widthMin[0], W.widthMin[1], d) + r.next() * lerp(W.widthRand[0], W.widthRand[1], d);
    if (checkpoint) w = Math.max(w, 64);
    const rise = easy ? E.step : lerp(W.riseMax[0], W.riseMax[1], d);
    const drop = easy ? E.step : lerp(W.dropMax[0], W.dropMax[1], d);
    if (easy) {
      gap = r.range(E.gap[0], E.gap[1]);
      w = r.range(E.width[0], E.width[1]);
    }
    let y = prev.y + r.range(-rise, drop);
    y = clamp(y, F.platformMinY, F.platformMaxY);
    const h = Math.round(r.range(W.thickness[0], W.thickness[1]));
    const x = prev.x + prev.w + gap;
    const fire = !easy && Hz.enabled && index >= Hz.fire.unlock && !checkpoint && !prev.fire
      && r.chance(lerp(Hz.fire.chance[0], Hz.fire.chance[1], d));
    const p = this._add(Math.round(x), Math.round(y), Math.round(w), h, checkpoint, fire);

    // Canopy over the gap, then over the new island.
    const gx0 = prev.x + prev.w, gx1 = p.x;
    const gapLimit = Math.min(prev.y, p.y) - CL.clearGap;
    const ceilIndex = easy ? -1 : index; // gentle start: flat canopy
    let cg = this._pickCeiling(ceilIndex, gapLimit);
    if (gx1 - gx0 >= CL.splitGap) {
      // wide gap: two canopy pieces at different heights (a zig-zag through the maze)
      const split = Math.round(gx0 + (gx1 - gx0) * r.range(0.35, 0.65));
      this._ceil(gx0, split - gx0, cg.y, cg.kind);
      const cg2 = this._pickCeiling(ceilIndex, gapLimit);
      this._ceil(split, gx1 - split, cg2.y, cg2.kind);
      if (cg2.y < cg.y) cg = cg2; // berries and spout clouds use the higher piece
    } else {
      this._ceil(gx0, gx1 - gx0, cg.y, cg.kind);
    }
    // Over an island only a normal canopy or a clearing: a hanging mass right overhead
    // would make every takeoff hit it.
    const cp = this._pickCeiling(ceilIndex, -Infinity);
    this._ceil(p.x, p.w, cp.y, cp.kind);

    // River hazard in the gap.
    if (!easy && Hz.enabled && !p.fire && gx1 - gx0 >= Hz.minGap && r.chance(lerp(Hz.chance[0], Hz.chance[1], d))) {
      const types = [];
      if (index >= Hz.shark.unlock) types.push('shark');
      if (index >= Hz.wave.unlock) types.push('wave');
      if (index >= Hz.spout.unlock) types.push('spout');
      if (index >= Hz.eel.unlock) types.push('eel');
      if (types.length) {
        const first = r.pick(types);
        this._addHazard(first, gx0, gx1, Math.min(prev.y, p.y), d, cg.y);
        // wide gaps can get a second, different one (never two columns: spout + wave are fine)
        const others = types.filter((t) => t !== first);
        if (gx1 - gx0 >= Hz.doubleMinGap && others.length && r.chance(lerp(Hz.doubleChance[0], Hz.doubleChance[1], d))) {
          this._addHazard(r.pick(others), gx0, gx1, Math.min(prev.y, p.y), d, cg.y);
        }
      }
    }

    // Rimu berries in a gentle arc over the gap, kept below the canopy.
    if (r.chance(lerp(W.berryChance[0], W.berryChance[1], d))) {
      const n = r.int(1, 3);
      const topY = Math.min(prev.y, p.y) - r.range(26, 60);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / (n + 1);
        const bx = Math.round(gx0 + gap * t);
        const arc = Math.sin(t * Math.PI) * 14;
        const by = clamp(topY - arc, this.ceilMax(bx - 6, bx + 6) + 14, F.waterY - 30);
        this.berries.push({ x: bx, y: Math.round(by), taken: false, phase: r.next() * 6.28 });
      }
    }
    return p;
  }

  _addHazard(type, x0, x1, lowTop, d, ceilY) {
    const r = this.rng;
    const H = this.cfg.hazards;
    const waterY = this.cfg.field.waterY;
    const gw = x1 - x0;
    const hz = { type, x0, x1, waterY, phase: r.range(0, 10) };
    if (type === 'shark') {
      const S = H.shark;
      hz.period = r.range(S.period[0], S.period[1]);
      hz.leap = S.leap;
      hz.fin = S.fin;
      hz.dir = r.chance(0.5) ? 1 : -1;
      const m = Math.min(10, gw * 0.2);
      hz.xa = hz.dir > 0 ? x0 + m : x1 - m;
      hz.xb = hz.dir > 0 ? x1 - m : x0 + m;
      hz.height = lerp(S.height[0], S.height[1], d) * r.range(0.85, 1);
      hz.radius = S.radius;
    } else if (type === 'wave') {
      const V = H.wave;
      hz.period = r.range(V.period[0], V.period[1]);
      hz.xc = (x0 + x1) / 2;
      hz.sigma = gw / 4;
      // never taller than the lower island (the crest must stay inside the gap visually)
      hz.amp = Math.min(lerp(V.amp[0], V.amp[1], d), waterY - lowTop + 10);
    } else if (type === 'eel') {
      const E = H.eel;
      hz.period = r.range(E.period[0], E.period[1]);
      hz.warn = E.warn;
      hz.strike = E.strike;
      hz.xe = Math.round(r.range(x0 + Math.min(12, gw * 0.25), x1 - Math.min(12, gw * 0.25)));
      // never reaches the lower island's height + a bit (so it stays a river thing)
      hz.height = Math.min(lerp(E.height[0], E.height[1], d) * r.range(0.85, 1), waterY - lowTop + 30);
      hz.halfW = E.halfW;
    } else {
      const P = H.spout;
      hz.period = r.range(P.period[0], P.period[1]);
      hz.grow = P.grow; hz.hold = P.hold; hz.fade = P.fade;
      hz.xc = (x0 + x1) / 2;
      hz.sway = Math.max(0, gw / 2 - 16) * 0.6;
      hz.halfW = P.halfW;
      hz.ceilY = ceilY + 4;
    }
    this.hazards.push(hz);
    return hz;
  }

  /** Underside of the canopy at world x. */
  ceilAt(x) {
    const cs = this.ceilings;
    for (let i = cs.length - 1; i >= 0; i--) if (x >= cs[i].x) return cs[i].y;
    return this.cfg.field.ceilingY;
  }

  /** Lowest canopy underside (largest y) across [x0, x1]. */
  ceilMax(x0, x1) {
    let m = -Infinity;
    for (const c of this.ceilings) if (c.x < x1 && c.x + c.w > x0 && c.y > m) m = c.y;
    return m === -Infinity ? this.cfg.field.ceilingY : m;
  }

  /** River surface y at world x (giant waves raise it locally). */
  waterAt(x, t) {
    let y = this.cfg.field.waterY;
    for (let i = 0; i < this.hazards.length; i++) {
      const hz = this.hazards[i];
      if (hz.type === 'wave' && x > hz.x0 - 10 && x < hz.x1 + 10) y -= waveHeight(hz, x, t);
    }
    return y;
  }

  /** Ensures content exists up to `toX` and drops what is far behind `fromX`. */
  update(fromX, toX) {
    let last = this.platforms[this.platforms.length - 1];
    while (last.x + last.w < toX + this.cfg.world.lookAhead) {
      last = this._generateNext(last);
    }
    // Keep a couple of platforms behind for side bonks after knock-back.
    while (this.platforms.length > 2 && this.platforms[1].x + this.platforms[1].w < fromX - 80) {
      this.platforms.shift();
    }
    while (this.ceilings.length > 2 && this.ceilings[1].x + this.ceilings[1].w < fromX - 80) {
      this.ceilings.shift();
    }
    while (this.hazards.length && this.hazards[0].x1 < fromX - 80) this.hazards.shift();
    while (this.berries.length && (this.berries[0].x < fromX - 40)) {
      this.berries.shift();
    }
  }
}
