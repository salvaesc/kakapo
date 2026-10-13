// River hazards: sharks, giant waves and waterspouts. Pure functions of (hazard, time),
// shared by the simulation (collisions) and the renderer (drawing), so what you see is
// exactly what hits you. Every hazard is cyclic: the player can rest on an island,
// watch the rhythm and cross at the right moment.

const TAU = Math.PI * 2;

/** Position in the cycle, 0..period. */
function cycle(hz, t) {
  const p = hz.period;
  return (((t + hz.phase) % p) + p) % p;
}

/**
 * Shark. Hidden most of the cycle, then a fin circles for `fin` seconds (warning),
 * then it leaps across the gap in an arc.
 * Writes into `out`: { mode: 'hidden'|'fin'|'leap', x, y, dir, u }.
 */
export function sharkAt(hz, t, out) {
  const c = cycle(hz, t);
  const leapStart = hz.period - hz.leap;
  const finStart = leapStart - hz.fin;
  out.dir = hz.dir;
  if (c >= leapStart) {
    const u = (c - leapStart) / hz.leap;
    out.mode = 'leap';
    out.u = u;
    out.x = hz.xa + (hz.xb - hz.xa) * u;
    out.y = hz.waterY - hz.height * 4 * u * (1 - u);
  } else if (c >= finStart) {
    const u = (c - finStart) / hz.fin;
    out.mode = 'fin';
    out.u = u;
    // the fin slides towards the take-off point
    out.x = hz.xa - hz.dir * (1 - u) * 22;
    out.y = hz.waterY;
  } else {
    out.mode = 'hidden';
    out.u = 0;
    out.x = hz.xa;
    out.y = hz.waterY;
  }
  return out;
}

/**
 * Tuna (eel). Hidden, then bubbles at the spot (warning), then it shoots straight up and
 * drops back. Writes into `out`: { mode: 'hidden'|'bubbles'|'strike', x, headY, u }.
 */
export function eelAt(hz, t, out) {
  const c = cycle(hz, t);
  const strikeStart = hz.period - hz.strike;
  const warnStart = strikeStart - hz.warn;
  out.x = hz.xe;
  if (c >= strikeStart) {
    const u = (c - strikeStart) / hz.strike;
    out.mode = 'strike';
    out.u = u;
    out.headY = hz.waterY - hz.height * Math.sin(Math.PI * u);
  } else if (c >= warnStart) {
    out.mode = 'bubbles';
    out.u = (c - warnStart) / hz.warn;
    out.headY = hz.waterY;
  } else {
    out.mode = 'hidden';
    out.u = 0;
    out.headY = hz.waterY;
  }
  return out;
}

/** Height (px above the river) of a giant wave at world x. 0 = calm. */
export function waveHeight(hz, x, t) {
  const u = cycle(hz, t) / hz.period;
  const s = Math.sin(u * TAU);
  if (s <= 0) return 0;
  const d = (x - hz.xc) / hz.sigma;
  if (d > 3 || d < -3) return 0;
  return hz.amp * Math.pow(s, 1.4) * Math.exp(-d * d);
}

/** Wave intensity 0..1 over the cycle (for the "swell building" warning). */
export function waveCharge(hz, t) {
  const u = cycle(hz, t) / hz.period;
  return Math.max(0, Math.sin(u * TAU));
}

/**
 * Waterspout. Off → grows from the river up to the canopy → holds → fades.
 * Writes into `out`: { mode: 'off'|'forming'|'grow'|'hold'|'fade', x, top, k }.
 * `top` is the y of the column's tip (waterY when nothing is above water).
 * `k` is how much of the column exists (0..1).
 */
export function spoutAt(hz, t, out) {
  const c = cycle(hz, t);
  const off = hz.period - hz.grow - hz.hold - hz.fade;
  out.x = hz.xc + Math.sin((t + hz.phase) * 0.8) * hz.sway;
  let k;
  if (c < off) {
    k = 0;
    out.mode = c > off - 1.2 ? 'forming' : 'off'; // ripples + dark cloud before it rises
  } else if (c < off + hz.grow) {
    k = (c - off) / hz.grow;
    out.mode = 'grow';
  } else if (c < off + hz.grow + hz.hold) {
    k = 1;
    out.mode = 'hold';
  } else {
    k = 1 - (c - off - hz.grow - hz.hold) / hz.fade;
    out.mode = 'fade';
  }
  out.k = k;
  out.top = hz.waterY - (hz.waterY - hz.ceilY) * k;
  return out;
}
