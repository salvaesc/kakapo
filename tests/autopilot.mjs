// A scripted "player" used by tests to prove generated levels are reachable with the
// configured physics. It only produces the same 0..1 level a microphone would give.
// It is a simple height controller: pick a safe cruising height between the canopy and
// the islands ahead, turn "how fast do I want to climb" into a volume, go quiet to drop
// onto the target island, brake long falls. With river hazards it does what a patient
// player does: waits on the island until the gaps ahead are clear while it would cross them.
import { sharkAt, spoutAt, waveHeight, eelAt } from '../js/game/hazards.js';

const TMP = { mode: '', x: 0, y: 0, dir: 1, u: 0, top: 0, k: 0, headY: 0 };

/** True if no hazard between x0 and x1 is dangerous while the bird would be over it. */
function hazardClear(sim, x0, x1, now, speed) {
  for (const hz of sim.world.hazards) {
    if (hz.x1 < x0 || hz.x0 > x1) continue;
    const from = now + 0.3 + Math.max(0, hz.x0 - 20 - x0) / speed;
    const to = now + 0.3 + (hz.x1 + 20 - x0) / speed + 0.4;
    for (let t = from; t < to; t += 0.05) {
      if (hz.type === 'shark' && sharkAt(hz, t, TMP).mode === 'leap') return false;
      if (hz.type === 'spout' && spoutAt(hz, t, TMP).k > 0) return false;
      if (hz.type === 'wave' && waveHeight(hz, hz.xc, t) > 6) return false;
      if (hz.type === 'eel' && eelAt(hz, t, TMP).mode === 'strike') return false;
    }
  }
  return true;
}

/** Inverse of the game's level → climb-speed mapping. */
function levelForClimb(climb, C) {
  const F = C.flight, K = C.control;
  const k = Math.min(1, Math.max(0, (climb - F.minClimb) / (F.maxClimb - F.minClimb)));
  return K.deadzone + 0.01 + (1 - K.deadzone - 0.01) * Math.pow(k, 1 / K.curve);
}

export function autopilotLevel(sim) {
  const b = sim.bird;
  const C = sim.cfg;
  const hh = C.flight.hitHalfH;
  const plats = sim.world.platforms;
  if (b.state === 'rest') {
    const next = plats.find((p) => !p.visited && !p.fire && p.x > b.x);
    if (next && !hazardClear(sim, b.x, next.x + next.w, sim.time, 80)) return 0;
    // a falcon about to attack? stay frozen on the island
    if (sim.pred.state === 'warn' || sim.pred.state === 'dive') return 0;
    return 0.45;
  }
  // Target: first unvisited, non-burning platform ahead.
  let t = null;
  for (const p of plats) {
    if (!p.visited && !p.fire && p.x + p.w > b.x) { t = p; break; }
  }
  if (!t) return 0.4;
  const centre = t.x + t.w / 2;
  const look = b.x + 14 + Math.max(20, b.speed * 0.5);

  // Over the target and past the stop point: go quiet and drop, braking if it gets long.
  const pr = sim.pred;
  const dodging = (pr.state === 'warn' && pr.t < C.predator.lockAt + 0.15) || (pr.state === 'dive' && pr.x > b.x);
  const stopAt = centre - Math.min(14, t.w * 0.25) - b.speed * 0.18;
  if (!dodging && b.x >= stopAt && b.x <= t.x + t.w - 4 && b.y + hh < t.y + 1) {
    if (b.vy > 0 && b.fallHeight > C.lives.hardFallHeight * 0.55) return levelForClimb(60, C);
    return 0;
  }

  // Safe band: under the lowest canopy ahead, above every island ahead (incl. the target edge).
  const ceil = sim.world.ceilMax(b.x - 8, Math.min(look, centre));
  let floor = Infinity;
  for (const p of plats) {
    if (p.x < Math.min(look, t.x + 6) && p.x + p.w > b.x - 8) floor = Math.min(floor, p.y);
  }
  const top = ceil + hh + 7;
  const bottom = Math.min(floor === Infinity ? C.field.waterY - 40 : floor, t.y) - hh - 8;
  let desired = Math.min(bottom, Math.max(top, t.y - 24));
  if (top > bottom) desired = (top + bottom) / 2;
  // falcon committed to a height: get away from it
  if (dodging) {
    const up = pr.targetY - 36, down = pr.targetY + 36;
    // pick the side with room (prefer up: falling is fast but hurts if long)
    if (up >= top) desired = up;
    else if (down <= bottom) desired = down;
    else desired = Math.abs(top - pr.targetY) > Math.abs(bottom - pr.targetY) ? top : bottom;
  }

  // Move towards `desired`: climb speed proportional to the error.
  const err = b.y - desired; // positive = too low
  if (err > 0) {
    const climb = Math.min(C.flight.maxClimb, 25 + err * 5);
    return levelForClimb(climb, C);
  }
  // Too high: let gravity work, but brake before the fall gets long or we overshoot.
  if (b.vy > 0 && (b.fallHeight > C.lives.hardFallHeight * 0.55 || b.vy > -err * 6)) return levelForClimb(60, C);
  return 0;
}

/** Simulates a run; returns how many distinct platforms were landed on. */
export function runAutopilot(sim, seconds = 240, fps = 60) {
  const dt = 1 / fps;
  for (let i = 0; i < seconds * fps; i++) {
    sim.update(dt, autopilotLevel(sim), true);
    sim.clearEvents();
    if (sim.dead) break;
  }
  return sim.world.platforms.filter((p) => p.visited).length; // lower bound (old ones are dropped)
}
