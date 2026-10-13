// Game simulation: the kakapo, the world, scoring. No DOM, no rendering —
// fully deterministic for a given seed and input sequence, so it is testable in Node.
import { World } from './world.js';
import { shapeLevel, stepVertical, stepScroll } from './physics.js';
import { hitFace, footOverlap, circleHitsBox } from './collision.js';
import { sharkAt, spoutAt, eelAt } from './hazards.js';
import { createRng, clamp, lerp } from '../core/rng.js';

const MAX_EVENTS = 32;

/** How far below the surface a drowned kakapo has sunk, deadT seconds after the splash. */
export function sinkDepth(deadT, S) {
  const t = deadT - S.delay;
  if (t <= 0) return 0;
  // eases in: starts slow, like he's still trying to stay afloat
  return Math.min(S.maxDepth, S.speed * t * Math.min(1, 0.4 + t));
}
const CEIL_BOX = { x: 0, y: -1000, w: 0, h: 0 };
const SHARK = { mode: 'hidden', x: 0, y: 0, dir: 1, u: 0 };
const SPOUT = { mode: 'off', x: 0, top: 0, k: 0 };
const EEL = { mode: 'hidden', x: 0, headY: 0, u: 0 };

export class Sim {
  constructor(config) {
    this.cfg = config;
    this.world = new World(config);
    this.bird = {};
    this.events = [];
    for (let i = 0; i < MAX_EVENTS; i++) this.events.push({ type: '', x: 0, y: 0, a: 0 });
    this.eventCount = 0;
    this.time = 0;
    this._acc = 0;
    // the falcon: 'off' (waiting) → 'warn' ("!" at the screen edge) → 'dive'
    this.pred = { state: 'off', t: 0, x: 0, y: 0, vx: 0, vy: 0, targetY: 0, flap: 0 };
  }

  reset(seed = 1) {
    this.world.reset(seed);
    const f = this.cfg.world.firstPlatform;
    const hh = this.cfg.flight.hitHalfH;
    const startX = f.x + 46;
    Object.assign(this.bird, {
      x: startX, y: f.y - hh, vy: 0, speed: 0,
      state: 'rest',            // 'rest' | 'fly' | 'ko' (out of hearts, tumbling) | 'dead'
      restPlatform: this.world.platforms[0],
      stun: 0, landT: -0.4, holdT: 0, restT: 0, flyT: 0,
      victoryT: 0, deadT: 0, bonkT: 10, takeoffT: 10,
      level: 0, intensity: 0, flapPhase: 0,
      startX, maxX: startX, takeoffs: 0, landings: 0,
      lives: this.cfg.lives.max, invulnT: 0, hurtT: 10, hurtCause: '', burnT: 10,
      apexY: f.y - hh, fallHeight: 0,
      deathCause: '', deadOnGround: false,
    });
    this.bonus = 0;
    this.berries = 0;
    this.metres = 0;
    this.nextMilestone = this.cfg.score.milestoneMetres;
    this.time = 0;
    this._acc = 0;
    this.eventCount = 0;
    this.world.update(this.bird.x - 100, this.bird.x + 300);
    this.predRng = createRng((seed ^ 0x5bd1e995) >>> 0);
    const pr = this.pred;
    pr.state = 'off';
    pr.t = this._nextAttack();
    pr.attacks = 0;
  }

  _nextAttack() {
    const P = this.cfg.predator;
    const d = clamp(this.metres / P.rampMetres, 0, 1);
    return lerp(P.every[0], P.every[1], d) * this.predRng.range(0.75, 1.25);
  }

  /** The kārearea. Only hunts a flying kakapo: a perched one freezes and is not seen. */
  _predator(h) {
    const P = this.cfg.predator;
    const b = this.bird;
    const pr = this.pred;
    if (!P.enabled || !this.cfg.hazards.enabled || this.metres < P.unlockMetres) return;
    if (b.state === 'dead' || b.state === 'ko') { if (pr.state === 'warn') pr.state = 'off'; }
    pr.flap += h;
    if (pr.state === 'off') {
      pr.t -= h;
      if (pr.t <= 0 && b.state === 'fly') {
        pr.state = 'warn';
        pr.t = P.warn;
        pr.targetY = b.y;
        this.emit('falconWarn', b.x, b.y);
      }
    } else if (pr.state === 'warn') {
      if (b.state !== 'fly') { // froze on an island: the falcon loses interest
        pr.state = 'off';
        pr.t = this._nextAttack() * 0.6;
        this.emit('falconGone', b.x, b.y);
        return;
      }
      pr.t -= h;
      if (pr.t > P.lockAt) pr.targetY = b.y; // tracks you, then commits
      if (pr.t <= 0) {
        // dive from up-right towards where the bird is now, at the locked height
        pr.x = b.x + P.spawnAhead;
        pr.y = clamp(pr.targetY - 55, 20, this.cfg.field.waterY - 40);
        const tx = b.x + 20, ty = pr.targetY;
        const dx = tx - pr.x, dy = ty - pr.y;
        const len = Math.hypot(dx, dy) || 1;
        pr.vx = (dx / len) * P.speed;
        pr.vy = (dy / len) * P.speed;
        pr.state = 'dive';
        pr.attacks++;
        this.emit('falconDive', pr.x, pr.y);
      }
    } else if (pr.state === 'dive') {
      pr.x += pr.vx * h;
      pr.y += pr.vy * h;
      if (b.state === 'fly') {
        const hw = this.cfg.flight.hitHalfW, hh = this.cfg.flight.hitHalfH;
        if (b.invulnT <= 0 && circleHitsBox(pr.x, pr.y, P.radius, b.x - hw, b.y - hh, b.x + hw, b.y + hh)) {
          this.emit('falconHit', b.x, b.y);
          b.vy = P.knock;
          b.speed = -30;
          b.stun = this.cfg.bonk.stun;
          if (this._hurt('falcon', b.x, b.y)) return;
        }
      }
      if (pr.x < b.x - 220 || pr.y > this.cfg.field.waterY + 40) {
        pr.state = 'off';
        pr.t = this._nextAttack();
      }
    }
  }

  get score() { return this.metres + this.bonus; }
  get resting() { return this.bird.state === 'rest'; }
  get dead() { return this.bird.state === 'dead'; }
  /** 0..1+: how close the current free fall is to costing a heart. */
  get fallDanger() {
    const b = this.bird;
    return b.state === 'fly' ? b.fallHeight / this.cfg.lives.hardFallHeight : 0;
  }

  emit(type, x, y, a = 0) {
    if (this.eventCount >= MAX_EVENTS) return;
    const e = this.events[this.eventCount++];
    e.type = type; e.x = x; e.y = y; e.a = a;
  }

  clearEvents() { this.eventCount = 0; }

  /**
   * Advances the simulation by a frame.
   * @param {number} dt seconds since last frame
   * @param {number} level smoothed input level 0..1 (mic or fallback)
   * @param {boolean} allowTakeoff false briefly after our own sound effects
   */
  update(dt, level, allowTakeoff = true) {
    const S = this.cfg.sim;
    this._acc += Math.min(dt, S.maxFrameDt);
    while (this._acc >= S.fixedStep) {
      this._acc -= S.fixedStep;
      this.step(S.fixedStep, level, allowTakeoff);
    }
  }

  step(h, level, allowTakeoff) {
    const C = this.cfg;
    const b = this.bird;
    this.time += h;
    b.level = level;
    b.intensity = shapeLevel(level, C.control);
    b.victoryT = Math.max(0, b.victoryT - h);
    b.bonkT += h;
    b.takeoffT += h;
    b.hurtT += h;
    b.burnT += h;
    b.invulnT = Math.max(0, b.invulnT - h);

    this._predator(h);

    if (b.state === 'dead') {
      b.deadT += h;
      if (!b.deadOnGround) {
        b.y = C.field.waterY + 2 + sinkDepth(b.deadT, C.sink);
        b.x += Math.sin(b.deadT * 2.2) * 6 * h; // gentle sway in the current
      }
      return;
    }
    if (b.state === 'ko') { this._stepKo(h); return; }

    if (b.state === 'rest') {
      b.landT += h;
      b.restT += h;
      b.flapPhase += h * 2;
      const R = C.rest;
      if (allowTakeoff && b.landT > R.landGrace && level >= R.takeoffLevel) b.holdT += h;
      else b.holdT = Math.max(0, b.holdT - h * 2);
      if (level >= R.takeoffLevel) b.restT = 0;
      if (b.holdT >= R.takeoffHold) this._takeoff();
      return;
    }

    // ---- flying ----
    const F = C.flight;
    const hw = F.hitHalfW, hh = F.hitHalfH;
    const stunned = b.stun > 0;
    b.stun = Math.max(0, b.stun - h);
    b.flyT += h;
    b.flapPhase += h * (3 + b.intensity * 14);

    // Canopy cushion: the climb eases off as the head nears the canopy, so a squeak that is
    // a bit too high doesn't slam you into it. (Sideways hits still count.)
    b.vy = stepVertical(b.vy, b.intensity, h, F, stunned);
    if (b.vy < 0 && F.ceilingCushion > 0) {
      const room = b.y - F.hitHalfH - this.world.ceilAt(b.x);
      const cap = F.maxClimb * clamp(room / F.ceilingCushion, F.cushionMin, 1);
      if (b.vy < -cap) b.vy = -cap;
    }
    b.speed = stepScroll(b.speed, b.intensity, h, C.scroll, stunned);

    const px = b.x, py = b.y;
    b.x += b.speed * h;
    b.y += b.vy * h;

    // Track the free fall: the apex resets whenever the bird is going up,
    // so making sound to brake a dive also "resets" the fall height.
    if (b.vy <= 0 || b.y < b.apexY) b.apexY = b.y;
    b.fallHeight = b.y - b.apexY;

    // Canopy maze: its underside and the sides of hanging masses both cost a heart.
    const ceils = this.world.ceilings;
    for (let i = 0; i < ceils.length; i++) {
      const c = ceils[i];
      if (c.x > b.x + hw + 2) break;
      if (c.x + c.w < b.x - hw - 2) continue;
      CEIL_BOX.x = c.x; CEIL_BOX.w = c.w; CEIL_BOX.h = c.y + 1000;
      const face = hitFace(px, py, b.x, b.y, hw, hh, CEIL_BOX);
      if (!face) continue;
      if (face === 'left') {
        b.x = c.x - hw;
        b.speed = -C.bonk.sideKnockback;
        this._bonk(b.x + hw, b.y, 0);
      } else if (face === 'right') {
        b.x = c.x + c.w + hw;
        b.speed = Math.max(b.speed, 0);
        this._bonk(b.x - hw, b.y, 0);
      } else {
        b.y = c.y + hh;
        if (b.vy < C.bonk.ceilingPush) b.vy = C.bonk.ceilingPush;
        this._bonk(b.x, b.y - hh, 0);
      }
      if (this._hurt('ceiling', b.x, b.y - hh)) return;
    }

    // Platforms
    const plats = this.world.platforms;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.x > b.x + 40) break;
      let face = hitFace(px, py, b.x, b.y, hw, hh, p);
      if (!face) continue;
      if (face === 'top' && footOverlap(b.x, hw, p) < 3) face = b.x < p.x + p.w / 2 ? 'left' : 'right';
      if (face === 'top' && p.fire) {
        // Burning island: hot feet! Bounce straight back up, no resting here.
        b.y = p.y - hh;
        b.vy = -C.hazards.fire.bounce;
        b.apexY = b.y; b.fallHeight = 0;
        b.burnT = 0;
        this.emit('burn', b.x, p.y);
        if (this._hurt('fire', b.x, p.y)) return;
        continue;
      }
      if (face === 'top') { b.y = p.y - hh; this._land(p); return; }
      if (face === 'bottom') {
        b.y = p.y + p.h + hh;
        b.vy = Math.max(b.vy, 40);
        this._bonk(b.x, b.y - hh, 1);
        if (this._hurt('underside', b.x, b.y - hh)) return;
      } else if (face === 'left') {
        b.x = p.x - hw;
        b.speed = -C.bonk.sideKnockback;
        this._bonk(b.x + hw, b.y, 2);
      } else {
        b.x = p.x + p.w + hw;
        b.speed = Math.max(b.speed, 0);
      }
    }

    // Rimu berries
    const berries = this.world.berries;
    for (let i = 0; i < berries.length; i++) {
      const be = berries[i];
      if (be.taken || be.x > b.x + 20) continue;
      if (circleHitsBox(be.x, be.y, 5, b.x - hw, b.y - hh, b.x + hw, b.y + hh)) {
        be.taken = true;
        this.bonus += C.score.berryBonus;
        this.berries++;
        this.emit('berry', be.x, be.y, C.score.berryBonus);
      }
    }

    // River hazards: all of them take every heart.
    if (this._hazards(h)) return;

    // River (a giant wave raises it locally): takes every heart at once.
    const surface = this.world.waterAt(b.x, this.time);
    if (surface < C.field.waterY - 4 && b.y + hh > surface + 2) {
      this._kill('wave');
      return;
    }
    if (b.y - hh > C.field.waterY - 6) {
      this._kill('water');
      return;
    }

    // Distance score and milestones
    if (b.x > b.maxX) b.maxX = b.x;
    this.metres = Math.max(0, Math.floor((b.maxX - b.startX) / C.score.pxPerMetre));
    if (this.metres >= this.nextMilestone) {
      this.emit('milestone', b.x, b.y, this.nextMilestone);
      this.nextMilestone += C.score.milestoneMetres;
    }

    this.world.update(b.x - 120, b.x + 200);
  }

  /** Collisions with sharks and waterspouts near the bird. Returns true if it died. */
  _hazards(h) {
    const C = this.cfg;
    const b = this.bird;
    const hw = C.flight.hitHalfW, hh = C.flight.hitHalfH;
    const hzs = this.world.hazards;
    for (let i = 0; i < hzs.length; i++) {
      const hz = hzs[i];
      if (hz.x1 + 40 < b.x || hz.x0 - 40 > b.x) continue;
      if (hz.type === 'shark') {
        sharkAt(hz, this.time, SHARK);
        if (SHARK.mode === 'leap' && circleHitsBox(SHARK.x, SHARK.y, hz.radius, b.x - hw, b.y - hh, b.x + hw, b.y + hh)) {
          this.emit('chomp', SHARK.x, SHARK.y);
          this._kill('shark');
          return true;
        }
      } else if (hz.type === 'eel') {
        eelAt(hz, this.time, EEL);
        if (EEL.mode === 'strike' && b.x + hw > EEL.x - hz.halfW && b.x - hw < EEL.x + hz.halfW
          && b.y + hh > EEL.headY - 3) {
          this.emit('snap', EEL.x, EEL.headY);
          this._kill('eel');
          return true;
        }
      } else if (hz.type === 'spout') {
        spoutAt(hz, this.time, SPOUT);
        if (SPOUT.k <= 0) continue;
        const dx = SPOUT.x - b.x;
        const adx = Math.abs(dx);
        // the wind around the column drags the bird towards it
        const P = C.hazards.spout;
        if (adx < P.pullRadius && b.y + hh > SPOUT.top) b.x += Math.sign(dx) * P.pull * (1 - adx / P.pullRadius) * h;
        if (adx < hz.halfW + hw && b.y + hh > SPOUT.top) {
          this.emit('sucked', SPOUT.x, b.y);
          this._kill('spout');
          return true;
        }
      }
    }
    return false;
  }

  /** Instant death: every heart lost, bird ends in the river. */
  _kill(cause) {
    this.bird.lives = 0;
    this.bird.deathCause = cause;
    this._die(cause, false);
  }

  /**
   * Loses a heart unless the bird is still blinking from the previous hit.
   * @returns {boolean} true when that was the last heart (bird is now KO).
   */
  _hurt(cause, x, y) {
    const b = this.bird;
    if (b.invulnT > 0 || b.lives <= 0) return false;
    b.lives--;
    b.hurtT = 0;
    b.hurtCause = cause;
    b.invulnT = this.cfg.lives.invulnerable;
    this.emit('hurt', x, y, b.lives);
    if (b.lives > 0) return false;
    if (b.state === 'rest') {
      this._die(cause, true);
    } else {
      // Out of hearts mid-air: tumble down, out of the player's control.
      b.state = 'ko';
      b.deathCause = cause;
      b.deadT = 0;
      // a little hop of despair, unless he just hit the canopy (then straight down)
      b.vy = cause === 'ceiling' ? Math.max(b.vy, 40) : Math.min(b.vy, -40);
      b.stun = 0;
    }
    return true;
  }

  _stepKo(h) {
    const C = this.cfg;
    const b = this.bird;
    b.deadT += h;
    b.vy = Math.min(b.vy + C.flight.gravity * h, C.flight.maxFall);
    b.speed *= Math.exp(-3 * h);
    const py = b.y;
    b.x += b.speed * h;
    b.y += b.vy * h;
    const hh = C.flight.hitHalfH, hw = C.flight.hitHalfW;
    const ceil = this.world.ceilAt(b.x);
    if (b.y - hh < ceil) { b.y = ceil + hh; b.vy = Math.max(b.vy, 0); }
    const plats = this.world.platforms;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (b.vy > 0 && py + hh <= p.y + 0.5 && b.y + hh >= p.y && b.x + hw > p.x && b.x - hw < p.x + p.w) {
        b.y = p.y - hh;
        this.emit('thud', b.x, p.y);
        this._die(b.deathCause, true);
        return;
      }
    }
    if (b.y - hh > C.field.waterY - 6) this._die(b.deathCause || 'water', false);
  }

  /** Final state. onGround: lying on a platform; otherwise floating in the river. */
  _die(cause, onGround) {
    const C = this.cfg;
    const b = this.bird;
    b.state = 'dead';
    b.deathCause = b.deathCause || cause;
    b.deadOnGround = onGround;
    b.deadT = 0;
    b.vy = 0;
    b.speed = 0;
    b.invulnT = 0;
    if (!onGround) {
      b.y = C.field.waterY + 2;
      this.emit('splash', b.x, C.field.waterY);
    }
    this.emit('dead', b.x, b.y, 0);
  }

  _takeoff() {
    const b = this.bird;
    b.state = 'fly';
    b.apexY = b.y;
    b.fallHeight = 0;
    b.vy = this.cfg.rest.takeoffVy;
    b.speed = this.cfg.scroll.min * 0.6;
    b.restPlatform = null;
    b.holdT = 0;
    b.flyT = 0;
    b.takeoffT = 0;
    b.takeoffs++;
    this.emit('takeoff', b.x, b.y + this.cfg.flight.hitHalfH, b.takeoffs === 1 ? 1 : 0);
  }

  _land(p) {
    const C = this.cfg;
    const b = this.bird;
    const hardFall = b.fallHeight >= C.lives.hardFallHeight;
    b.state = 'rest';
    b.fallHeight = 0;
    b.apexY = b.y;
    b.vy = 0;
    b.speed = 0;
    b.stun = 0;
    b.restPlatform = p;
    b.landT = 0;
    b.holdT = 0;
    b.restT = 0;
    b.landings++;
    let gained = 0;
    let perfect = 0;
    if (!p.visited) {
      p.visited = true;
      gained += C.score.landBonus;
      const centre = p.x + p.w / 2;
      if (Math.abs(b.x - centre) <= (p.w / 2) * C.score.perfectZone + 2) {
        gained += C.score.perfectBonus;
        perfect = 1;
      }
      if (p.checkpoint) {
        gained += C.score.checkpointBonus;
        b.victoryT = 1.8;
      }
    }
    this.bonus += gained;
    this.emit('land', b.x, p.y, gained);
    if (perfect) this.emit('perfect', b.x, p.y, gained);
    if (p.checkpoint && gained) this.emit('checkpoint', b.x, p.y, C.score.checkpointBonus);
    if (hardFall) this._hurt('fall', b.x, p.y);
    this.world.update(b.x - 120, b.x + 200);
  }

  _bonk(x, y, kind) {
    const b = this.bird;
    b.stun = this.cfg.bonk.stun;
    if (b.bonkT > 0.25) this.emit('bonk', x, y, kind);
    b.bonkT = 0;
  }
}
