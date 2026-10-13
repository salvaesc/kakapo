// The kakapo: sprite parts as pixel grids, composed per frame into one small canvas.
// Parts (body, eyes, beak, wings, feet) are separate so expressions combine freely.
// To switch to a hand-drawn sprite sheet later, replace `buildParts` / `composeKakapo`.
import { gridToCanvas, makeCanvas } from './pixel.js';

export const KAKAPO_PALETTE = {
  o: '#16363a', // outline (dark blue-green)
  G: '#2d7334', // deep green shade
  g: '#57a53d', // moss green
  y: '#9fd04a', // speckle highlight
  l: '#bfe06c', // facial disc / chest lime
  L: '#e4f2a0', // face highlight
  k: '#0e1719', // eye
  w: '#ffffff',
  b: '#f1e4c0', // beak
  B: '#a8875e', // beak shade
  r: '#d84a5e', // mouth
  f: '#e9997a', // feet
  F: '#b8694f',
  p: '#f59a8c', // blush
  D: '#1f5a30', // far wing
  s: '#8fe3ff', // sweat drop
  Y: '#ffd84a', // star
};

const BODY = [
  '.....oooooo.......',
  '...oogGgggggoo....',
  '..ogGgygggggggo...',
  '.oggggGgggllllo...',
  '.oGgyggglllllllo..',
  'oGgggGgglllLlllo..',
  'oGgGgggglllllllo..',
  'oGggggyglllllllo..',
  'oGGgggggggllllo...',
  'oGgGgggggglllo....',
  'oGGggGggggglllo...',
  '.oGGgggggglllllo..',
  '.oGGGgggggllllo...',
  '..oGGGggggllllo...',
  '...ooGGGGGGGoo....',
  '.....ooooooo......',
];

// Eyes are 3x3, placed at two spots on the facial disc. Each entry: [left, right].
const EYES = {
  normal: [['wkk', 'kkk', 'kkk'], ['wkk', 'kkk', 'kkk']],
  blink: [['...', 'kkk', '...'], ['...', 'kkk', '...']],
  happy: [['.k.', 'k.k', '...'], ['.k.', 'k.k', '...']],
  determined: [['k..', 'wkk', 'kkk'], ['..k', 'wkk', 'kkk']],
  panic: [['www', 'wkw', 'www'], ['www', 'wkw', 'www']],
  dizzy: [['k.k', '.k.', 'k.k'], ['k.k', '.k.', 'k.k']],
  sleepy: [['...', 'kkk', '.k.'], ['...', 'kkk', '.k.']],
  look: [['kkw', 'kkk', 'kkk'], ['kkw', 'kkk', 'kkk']],
};
// Near eye is 3 px wide, the far eye shows 2 px (three-quarter view).
const EYE_POS = [[8, 4], [13, 4]];

const BEAKS = {
  closed: ['obbo', '.bBo', '..o.'],
  open: ['obbo', 'orro', '.bBo', '..o.'],
  wide: ['obbbo', 'orrro', 'orrro', '.obBo', '...o.'],
  smile: ['obbo', '.rBo', '..o.'],
};
const BEAK_POS = [10, 7];

// Wings: grids + anchor (the pixel that sits on the shoulder). Shoulder is on the body's back edge,
// so raised wings extend outside the silhouette and read clearly at small sizes.
const SHOULDER = [3, 7];
const WINGS = {
  folded: { g: ['.oo..', 'oyGo.', 'oyGGo', 'oyGGo', '.oyGo', '..oo.'], a: [0, 0], fixed: [3, 6] },
  up: { g: ['oo.....', 'oyo....', 'oyGo...', '.oyGo..', '.oyGGo.', '..oyGGo', '...oooo'], a: [6, 6] },
  mid: { g: ['ooooo...', 'oyyyGoo.', '.ooGGGGo', '....ooo.'], a: [7, 2] },
  down: { g: ['...oooo', '..oyGGo', '.oyGGo.', '.oyGo..', 'oyGo...', 'oo.....'], a: [6, 0] },
  bigUp: { g: ['o.......', 'oo......', 'oyo.....', 'oyGo....', '.oyGo...', '.oyGGo..', '..oyGGo.', '..oyGGGo', '...ooooo'], a: [7, 8] },
  bigDown: { g: ['....oooo', '...oyGGo', '..oyGGo.', '.oyGGo..', '.oyGo...', 'oyGo....', 'oyo.....', 'oo......'], a: [7, 0] },
};

const FEET = {
  tucked: { g: ['ff.ff'], at: [7, 15] },
  down: { g: ['f..f.', 'ff.ff'], at: [7, 15] },
  long: { g: ['f..f.', 'f..f.', 'ff.ff'], at: [7, 15] },
};

// Frame canvas size and where the body's top-left goes inside it.
export const FRAME_W = 32;
export const FRAME_H = 30;
const OX = 8;
const OY = 7;
// Bird "centre" inside the frame (matches the simulation hitbox centre).
export const FRAME_CX = OX + 9;
export const FRAME_CY = OY + 9;

let parts = null;
function buildParts() {
  const P = KAKAPO_PALETTE;
  const toC = (g, flip) => gridToCanvas(g, P, { flipX: flip });
  const wingSet = (pal) => {
    const out = {};
    for (const k in WINGS) out[k] = { c: gridToCanvas(WINGS[k].g, pal), a: WINGS[k].a, fixed: WINGS[k].fixed };
    return out;
  };
  const farPal = { ...P, G: P.D, y: P.G };
  parts = {
    body: toC(BODY),
    eyes: Object.fromEntries(Object.entries(EYES).map(([k, [l, r]]) => [k, [toC(l), toC(r)]])),
    beaks: Object.fromEntries(Object.entries(BEAKS).map(([k, g]) => [k, toC(g)])),
    wings: wingSet(P),
    farWings: wingSet(farPal),
    feet: Object.fromEntries(Object.entries(FEET).map(([k, v]) => [k, { c: toC(v.g), at: v.at }])),
    star: toC(['.Y.', 'YYY', '.Y.']),
    sweat: toC(['.s', 'ss', 'ss']),
    blush: toC(['pp']),
    frame: makeCanvas(FRAME_W, FRAME_H),
  };
  return parts;
}

/** Reusable pose object; filled by poseFor() each frame (no per-frame allocation). */
export function createPose() {
  return {
    eyes: 'normal', beak: 'closed', wing: 'folded', farWing: null, feet: 'down',
    squash: 0, offY: 0, flipY: false, sweat: false, blush: false, stars: 0, t: 0,
  };
}

/**
 * Chooses the visual state from simulation state. All 8 required states map here:
 * idle, takeoff, flight, powerful flight, landing, falling, death, victory.
 */
export function poseFor(pose, bird, t) {
  pose.t = t;
  pose.squash = 0; pose.offY = 0; pose.flipY = false;
  pose.sweat = false; pose.blush = false; pose.stars = 0; pose.farWing = null;
  const blinking = (t % 3.3) < 0.12;

  if (bird.state === 'ko') {
    // Out of hearts in mid-air: cartwheels down, flailing.
    const spin = Math.floor(bird.deadT * 7) % 2;
    pose.flipY = spin === 1;
    pose.eyes = 'dizzy';
    pose.beak = 'wide';
    pose.wing = (t * 16) % 2 < 1 ? 'bigUp' : 'bigDown';
    pose.feet = 'long';
    pose.sweat = true;
    return pose;
  }

  if (bird.state === 'dead' && bird.deadOnGround) {
    // Flat on his back on the island, feet up, seeing stars.
    pose.flipY = bird.deadT > 0.15;
    pose.offY = pose.flipY ? 6 : 0;
    pose.squash = bird.deadT < 0.15 ? 3 : 0;
    pose.eyes = 'dizzy';
    pose.beak = 'open';
    pose.wing = 'mid';
    pose.feet = 'long';
    pose.stars = 3;
    return pose;
  }

  if (bird.state === 'dead') {
    // In the river: a panicked splash, then he sinks slowly, wings up, cheeks puffed.
    if (bird.deadT < 0.3) {
      pose.eyes = 'panic';
      pose.beak = 'wide';
      pose.wing = (t * 16) % 2 < 1 ? 'bigUp' : 'bigDown';
      pose.feet = 'long';
      return pose;
    }
    pose.eyes = bird.deadT < 1.2 ? 'panic' : 'dizzy';
    pose.beak = 'closed';
    pose.blush = true;            // holding his breath
    pose.wing = (t * 2.5) % 2 < 1 ? 'up' : 'bigUp';
    pose.feet = 'long';
    pose.offY = 0;
    return pose;
  }

  if (bird.state === 'rest') {
    if (bird.victoryT > 0) {
      // Victory: little hop, both wings up, happy eyes, blush.
      const hop = Math.abs(Math.sin(bird.victoryT * 9));
      pose.offY = -Math.round(hop * 3);
      pose.eyes = 'happy';
      pose.beak = 'smile';
      pose.wing = (bird.victoryT * 8) % 2 < 1 ? 'up' : 'bigUp';
      pose.farWing = pose.wing;
      pose.feet = hop > 0.3 ? 'long' : 'down';
      pose.blush = true;
      return pose;
    }
    if (bird.hurtT < 0.9 && bird.hurtCause === 'fall') {
      // Hard landing: pancake squash, then dazed.
      pose.squash = bird.hurtT < 0.2 ? 4 : 1;
      pose.eyes = 'dizzy';
      pose.beak = 'open';
      pose.wing = bird.hurtT < 0.2 ? 'bigDown' : 'mid';
      pose.feet = 'down';
      pose.stars = bird.hurtT > 0.15 ? 2 : 0;
      return pose;
    }
    if (bird.landT >= 0 && bird.landT < 0.18) {
      // Landing: squash on impact.
      const k = 1 - bird.landT / 0.18;
      pose.squash = Math.round(3 * k);
      pose.eyes = 'normal';
      pose.beak = 'closed';
      pose.wing = 'mid';
      pose.feet = 'down';
      return pose;
    }
    if (bird.holdT > 0) {
      // Winding up for takeoff: crouch & open wings.
      pose.squash = bird.holdT > 0.08 ? 2 : 1;
      pose.eyes = 'determined';
      pose.beak = 'open';
      pose.wing = 'mid';
      pose.feet = 'down';
      return pose;
    }
    const sleeping = bird.restT > 6;
    pose.squash = Math.sin(t * 2.6) > 0.6 ? 1 : 0; // breathing
    pose.eyes = sleeping ? 'sleepy' : blinking ? 'blink' : ((t % 7) > 5 ? 'look' : 'normal');
    pose.beak = 'closed';
    pose.wing = 'folded';
    pose.feet = 'down';
    return pose;
  }

  // Flying
  const s = bird.intensity;
  if (bird.takeoffT < 0.22) {
    // Takeoff: stretch upward with wings opening.
    pose.squash = -2;
    pose.eyes = 'determined';
    pose.beak = 'open';
    pose.wing = bird.takeoffT < 0.1 ? 'mid' : 'bigUp';
    pose.feet = 'long';
    return pose;
  }
  if (bird.burnT < 0.6) {
    // Hot feet! Eyes wide, beak open, legs kicking.
    pose.eyes = 'panic';
    pose.beak = 'wide';
    pose.wing = (t * 18) % 2 < 1 ? 'bigUp' : 'up';
    pose.feet = (t * 14) % 2 < 1 ? 'long' : 'down';
    pose.sweat = true;
    pose.offY = -1;
    return pose;
  }
  if (bird.stun > 0) {
    pose.eyes = 'dizzy';
    pose.beak = 'open';
    pose.wing = (t * 20) % 2 < 1 ? 'up' : 'down';
    pose.feet = 'long';
    pose.stars = 2;
    return pose;
  }
  const phase = bird.flapPhase % 1;
  if (s <= 0) {
    if (bird.vy > 120) {
      // Falling: panic, flailing, sweat.
      pose.eyes = 'panic';
      pose.beak = 'open';
      const f = Math.floor(t * 18) % 4;
      pose.wing = f === 0 ? 'bigUp' : f === 1 ? 'down' : f === 2 ? 'up' : 'bigDown';
      pose.feet = 'long';
      pose.sweat = true;
    } else {
      // Gliding down: wings out.
      pose.eyes = blinking ? 'blink' : 'normal';
      pose.beak = 'closed';
      pose.wing = 'mid';
      pose.feet = 'down';
    }
    return pose;
  }
  if (s > 0.62) {
    // Powerful flight: big wings, determined eyes, beak wide open.
    pose.eyes = 'determined';
    pose.beak = 'wide';
    pose.wing = phase < 0.5 ? 'bigUp' : 'bigDown';
    pose.feet = 'tucked';
    pose.offY = phase < 0.5 ? -1 : 0;
    pose.sweat = bird.flyT > 2.5 && s > 0.85;
    return pose;
  }
  // Normal flight: flap speed follows intensity.
  pose.eyes = blinking ? 'blink' : 'normal';
  pose.beak = s > 0.3 ? 'open' : 'closed';
  pose.wing = phase < 0.33 ? 'up' : phase < 0.66 ? 'mid' : 'down';
  pose.feet = 'tucked';
  pose.offY = phase < 0.5 ? 0 : 1;
  return pose;
}

/** Renders the pose into the shared frame canvas and returns it. */
export function composeKakapo(pose) {
  const P = parts || buildParts();
  const fc = P.frame;
  const c = fc.getContext('2d');
  c.clearRect(0, 0, FRAME_W, FRAME_H);
  const sq = pose.squash; // + squash = shorter/wider
  const bodyH = 16 - sq;
  const bodyW = 18 + (sq > 0 ? sq : 0);
  const by = OY + sq; // keep the feet line fixed
  const bx = OX - (sq > 0 ? Math.floor(sq / 2) : 0);
  const faceDy = sq;

  const wingAt = (set, name, dx, dy) => {
    const w = set[name];
    if (w.fixed) { c.drawImage(w.c, bx + w.fixed[0] + dx, by + w.fixed[1] + dy); return; }
    c.drawImage(w.c, bx + SHOULDER[0] - w.a[0] + dx, by + SHOULDER[1] - w.a[1] + dy);
  };

  if (pose.farWing) wingAt(P.farWings, pose.farWing, 5, -2);
  const ft = P.feet[pose.feet];
  c.drawImage(ft.c, OX + ft.at[0], OY + ft.at[1]);
  c.drawImage(P.body, bx, by, bodyW, bodyH);
  const eyes = P.eyes[pose.eyes];
  c.drawImage(eyes[0], bx + EYE_POS[0][0], by + EYE_POS[0][1] - Math.min(faceDy, 1));
  c.drawImage(eyes[1], 0, 0, 2, 3, bx + EYE_POS[1][0], by + EYE_POS[1][1] - Math.min(faceDy, 1), 2, 3);
  if (pose.blush) {
    c.drawImage(P.blush, bx + 7, by + 8);
    c.drawImage(P.blush, bx + 14, by + 8);
  }
  c.drawImage(P.beaks[pose.beak], bx + BEAK_POS[0], by + BEAK_POS[1] - Math.min(faceDy, 1));
  wingAt(P.wings, pose.wing, 0, 0);
  if (pose.sweat) c.drawImage(P.sweat, bx + 4, by - 1 + ((pose.t * 6) % 2 < 1 ? 0 : 1));
  return fc;
}

/** Draws the kakapo centred at (x, y) in logical pixels. */
export function drawKakapo(ctx, x, y, pose) {
  const fc = composeKakapo(pose);
  const dx = Math.round(x - FRAME_CX);
  const dy = Math.round(y - FRAME_CY + pose.offY);
  if (pose.flipY) {
    ctx.save();
    ctx.translate(dx, dy + FRAME_H - 6);
    ctx.scale(1, -1);
    ctx.drawImage(fc, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(fc, dx, dy);
  }
  if (pose.stars) {
    const P = parts;
    for (let i = 0; i < pose.stars; i++) {
      const a = pose.t * 4 + (i * Math.PI * 2) / pose.stars;
      ctx.drawImage(P.star, Math.round(x + Math.cos(a) * 9 - 1), Math.round(y - 13 + Math.sin(a) * 3 - 1));
    }
  }
}
