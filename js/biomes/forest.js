// Biome 1: New Zealand native forest.
// A biome provides: palette, parallax layers (pre-rendered tiles), platform art,
// foreground canopy, water, collectible sprite. Future biomes (coast, alpine, fjords)
// implement the same shape — see biomes/index.js.
import { createRng } from '../core/rng.js';
import { makeCanvas, rect, dither, disc, gridToCanvas } from '../render/pixel.js';

export const PAL = {
  sky: ['#4fc4e3', '#6fd3e8', '#94e2ea', '#bdeee6', '#e2f7dc'],
  sun: '#fff6c2', sunRing: '#ffe48a',
  cloud: '#ffffff', cloudShade: '#d3eff3', cloudDark: '#b4dfe8',
  mtnFar: '#8cc2dc', mtnFarShade: '#79b2d0', snow: '#f1fbfc', snowShade: '#cfe8f0',
  mtnNear: '#5d9fc2', mtnNearShade: '#4c8bb0',
  hill: '#3f957f', hillShade: '#32806e', treeFar: '#2c7766', treeFarHi: '#3e9a7f',
  cliff: '#5f7f6c', cliffShade: '#4b6a5a', cliffHi: '#86a983',
  fall: '#d6fbfb', fall2: '#8fe6ec', fallDark: '#5fcfdb', mist: '#e8fdfd',
  trunk: '#2a4a3f', trunkShade: '#1d382f', moss: '#4a9a4c', mossHi: '#70bf54',
  leaf: '#2f7a45', leafHi: '#4ea04a', leafDark: '#21603a', fern: '#3d9447', fernHi: '#6cc14f',
  pohutu: '#e8404a', pohutuHi: '#ff7a5c', pohutuDark: '#a82640', stamen: '#ffd34a',
  // Foreground platform palette: warmer and higher contrast than the background.
  outline: '#1b2b28', grass: '#7fd23f', grassHi: '#c6f06a', grassDark: '#3f9a35',
  soil: '#8e5b3a', soilDark: '#6a422c', soilDeep: '#4b2d22', rock: '#909ca6', rockHi: '#c3ced4', rockDark: '#5e6a74',
  root: '#c08a5a', rootDark: '#83583a',
  water: ['#c4faf3', '#46d3d6', '#24b4c4', '#168fa9', '#0f6c86'], foam: '#ffffff',
  canopy: '#1f5d37', canopyHi: '#3c8c43', canopyDark: '#164a2d', vine: '#2f7a3a',
  berry: '#e2364a', berryDark: '#8f1f33', seed: '#2c2a3a', stem: '#4fa04a',
  // Hazards
  char: '#3b2b2b', charHi: '#5a3a30', ember: '#ff7a2a', emberHi: '#ffd04a',
  flame: ['#e8402a', '#ff8a2a', '#ffd04a', '#fff3b0'], smoke: '#7c7f86',
  shark: '#5d7a8c', sharkDark: '#3e5566', sharkHi: '#86a3b3', belly: '#eef6f6', teeth: '#ffffff',
  spout: ['#e9fbfd', '#b5e6ee', '#7fcbd9'], storm: '#4d5a66', stormDark: '#38434d',
  eel: '#3f4a26', eelHi: '#6b7a3a', eelBelly: '#a9a66a',
  falcon: '#5a3c2a', falconDark: '#2e1f17', falconChest: '#ead6ae', falconBar: '#8a6a4a', falconLeg: '#c8693a', beakY: '#ffcf3a',
  rootMass: '#5b4a3a', rootMassDark: '#3e3128', rootHi: '#8a6d4f',
};

const TILE_W = 320;

function cloudLayer(rng, H) {
  const c = makeCanvas(TILE_W, 120);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const cx = Math.round(rng.range(20, TILE_W - 20));
    const cy = Math.round(rng.range(22, 100));
    const n = rng.int(3, 5);
    for (let k = 0; k < n; k++) {
      const ox = Math.round((k - n / 2) * rng.range(6, 9));
      const r = rng.int(5, 9);
      disc(ctx, cx + ox, cy - Math.round(r * 0.4), r, PAL.cloudShade);
    }
    for (let k = 0; k < n; k++) {
      const ox = Math.round((k - n / 2) * rng.range(6, 9));
      const r = rng.int(4, 7);
      disc(ctx, cx + ox, cy - Math.round(r * 0.7) - 1, r, PAL.cloud);
    }
    rect(ctx, cx - n * 5, cy, n * 10, 1, PAL.cloudDark);
  }
  return { canvas: c, factor: 0.06, drift: 4, y: 0 };
}

function ridge(rng, base, amp, roughness) {
  // Periodic ridge line so the tile wraps seamlessly.
  const ys = new Float32Array(TILE_W);
  const waves = [];
  for (let i = 0; i < 4; i++) waves.push({ f: rng.int(1, 3 + i * 2), p: rng.range(0, 6.28), a: amp / (i + 1) });
  for (let x = 0; x < TILE_W; x++) {
    let y = base;
    for (const w of waves) y -= Math.sin((x / TILE_W) * Math.PI * 2 * w.f + w.p) * w.a;
    y += (rng.next() - 0.5) * roughness;
    ys[x] = Math.round(y);
  }
  return ys;
}

function mountainLayer(rng) {
  const c = makeCanvas(TILE_W, 320);
  const ctx = c.getContext('2d');
  const far = ridge(rng, 170, 34, 0);
  const near = ridge(rng, 205, 26, 0);
  for (let x = 0; x < TILE_W; x++) {
    const y = far[x];
    rect(ctx, x, y, 1, 320 - y, PAL.mtnFar);
    // shade the right-hand slopes
    const fShade = far[(x + 4) % TILE_W] > y + 1;
    if (fShade) rect(ctx, x, y + 2, 1, 320 - y, PAL.mtnFarShade);
    // snow caps on high ground
    if (y < 150) {
      const depth = Math.min(10, 150 - y + 2);
      rect(ctx, x, y, 1, depth, fShade ? PAL.snowShade : PAL.snow);
    }
  }
  for (let x = 0; x < TILE_W; x++) {
    const y = near[x];
    rect(ctx, x, y, 1, 320 - y, PAL.mtnNear);
    if (near[(x + 4) % TILE_W] > y + 1) rect(ctx, x, y + 1, 1, 320 - y, PAL.mtnNearShade);
  }
  return { canvas: c, factor: 0.12, y: 0 };
}

function farForestLayer(rng) {
  const c = makeCanvas(TILE_W, 320);
  const ctx = c.getContext('2d');
  const hills = ridge(rng, 238, 10, 0);
  const falls = [];
  // Cliff with a waterfall somewhere in the tile.
  const fx = rng.int(60, TILE_W - 80);
  const cliffTop = 176;
  for (let x = fx - 22; x < fx + 30; x++) {
    const edge = Math.abs(x - fx - 4);
    const top = cliffTop + Math.max(0, edge - 16) * 2 + ((x * 7) % 3);
    rect(ctx, x, top, 1, 320 - top, x < fx + 4 ? PAL.cliff : PAL.cliffShade);
    if ((x + top) % 5 === 0) rect(ctx, x, top + 6 + (x % 9), 1, 3, PAL.cliffHi);
  }
  // trees on top of the cliff
  for (let x = fx - 20; x < fx + 28; x += rng.int(5, 8)) {
    disc(ctx, x, cliffTop - 2, rng.int(4, 6), PAL.treeFar);
    disc(ctx, x - 1, cliffTop - 4, 2, PAL.treeFarHi);
  }
  falls.push({ x: fx, y: cliffTop + 2, w: 8, h: 240 - cliffTop });
  rect(ctx, fx, cliffTop + 2, 8, 240 - cliffTop, PAL.fall2);
  // rolling hills + tree line
  for (let x = 0; x < TILE_W; x++) rect(ctx, x, hills[x], 1, 320 - hills[x], PAL.hill);
  for (let x = 0; x < TILE_W; x += 3) {
    const r = rng.int(3, 7);
    const y = hills[x] - rng.int(0, 4);
    disc(ctx, x, y, r, PAL.treeFar);
    if (rng.chance(0.5)) disc(ctx, x - 1, y - r + 2, Math.max(1, r - 4), PAL.treeFarHi);
  }
  // tree-fern silhouettes poking above
  for (let i = 0; i < 6; i++) {
    const x = rng.int(0, TILE_W - 1);
    const top = hills[x] - rng.int(14, 22);
    rect(ctx, x, top, 1, hills[x] - top, PAL.treeFar);
    for (let k = -3; k <= 3; k++) rect(ctx, x + k * 2, top + Math.abs(k), 2, 1, PAL.treeFar);
  }
  // pool at the waterfall base
  rect(ctx, fx - 6, 238, 20, 3, PAL.fallDark);
  rect(ctx, fx - 4, 238, 16, 1, PAL.fall);
  return { canvas: c, factor: 0.25, y: 0, falls };
}

function drawTreeFern(ctx, x, base, height, rng) {
  rect(ctx, x, base - height, 2, height, PAL.trunk);
  rect(ctx, x + 1, base - height, 1, height, PAL.trunkShade);
  const top = base - height;
  for (let k = 0; k < 7; k++) {
    const dir = k - 3;
    const len = 10 - Math.abs(dir);
    for (let i = 0; i < len; i++) {
      const fx = x + Math.round(dir * i * 0.9);
      const fy = top + Math.round((i * i) / 12) - (Math.abs(dir) < 2 ? 2 : 0);
      rect(ctx, fx, fy, 2, 1, i % 3 === 0 ? PAL.fernHi : PAL.fern);
    }
  }
  disc(ctx, x + 1, top, 2, PAL.leafDark);
}

function drawPohutukawa(ctx, x, base, rng) {
  rect(ctx, x, base - 30, 3, 30, PAL.trunk);
  rect(ctx, x - 4, base - 26, 4, 2, PAL.trunk);
  rect(ctx, x + 3, base - 22, 5, 2, PAL.trunkShade);
  for (let i = 0; i < 9; i++) {
    const cx = x + rng.int(-14, 16);
    const cy = base - 34 + rng.int(-6, 8);
    disc(ctx, cx, cy, rng.int(5, 8), PAL.leafDark);
  }
  for (let i = 0; i < 7; i++) disc(ctx, x + rng.int(-12, 14), base - 38 + rng.int(-4, 6), rng.int(3, 5), PAL.leaf);
  // crimson blossom clusters with yellow stamens
  for (let i = 0; i < 14; i++) {
    const cx = x + rng.int(-14, 16);
    const cy = base - 42 + rng.int(-2, 14);
    rect(ctx, cx - 1, cy, 3, 2, PAL.pohutuDark);
    rect(ctx, cx - 1, cy - 1, 3, 2, PAL.pohutu);
    rect(ctx, cx, cy - 2, 1, 1, PAL.pohutuHi);
    if (i % 3 === 0) rect(ctx, cx + 1, cy - 2, 1, 1, PAL.stamen);
  }
}

function nearForestLayer(rng) {
  const c = makeCanvas(TILE_W, 320);
  const ctx = c.getContext('2d');
  const ground = ridge(rng, 286, 4, 0);
  // big mossy trunks reaching up into the canopy
  for (let i = 0; i < 3; i++) {
    const x = Math.round((i + rng.range(0.1, 0.8)) * (TILE_W / 3));
    const w = rng.int(7, 11);
    rect(ctx, x, 0, w, ground[x] - 0, PAL.trunk);
    rect(ctx, x + w - 3, 0, 3, ground[x], PAL.trunkShade);
    rect(ctx, x + 1, 0, 1, ground[x], '#35584b');
    for (let y = 30; y < ground[x]; y += rng.int(14, 26)) {
      rect(ctx, x - 1, y, rng.int(3, 6), rng.int(3, 6), PAL.moss);
      rect(ctx, x - 1, y, 2, 1, PAL.mossHi);
    }
    // roots
    rect(ctx, x - 4, ground[x] - 3, w + 8, 3, PAL.trunk);
    rect(ctx, x - 6, ground[x] - 1, 3, 2, PAL.trunkShade);
    rect(ctx, x + w + 3, ground[x] - 1, 3, 2, PAL.trunkShade);
  }
  drawPohutukawa(ctx, rng.int(30, TILE_W - 40), ground[100] + 2, rng);
  for (let i = 0; i < 5; i++) {
    const x = rng.int(4, TILE_W - 8);
    drawTreeFern(ctx, x, ground[x], rng.int(26, 46), rng);
  }
  // undergrowth
  for (let x = 0; x < TILE_W; x++) rect(ctx, x, ground[x], 1, 320 - ground[x], PAL.leafDark);
  for (let x = 0; x < TILE_W; x += 4) {
    const r = rng.int(3, 6);
    disc(ctx, x, ground[x] - 1, r, PAL.leaf);
    if (rng.chance(0.4)) rect(ctx, x - 1, ground[x] - r, 2, 1, PAL.leafHi);
  }
  // fern fronds
  for (let i = 0; i < 18; i++) {
    const x = rng.int(0, TILE_W - 1);
    const y = ground[x] - 2;
    for (let k = 0; k < 6; k++) {
      rect(ctx, x - k, y - 6 + (k * k) / 6, 1, 1, PAL.fern);
      rect(ctx, x + k, y - 6 + (k * k) / 6, 1, 1, PAL.fernHi);
    }
  }
  return { canvas: c, factor: 0.5, y: 0 };
}

function canopyTile(rng) {
  const c = makeCanvas(TILE_W, 64);
  const ctx = c.getContext('2d');
  rect(ctx, 0, 0, TILE_W, 34, PAL.canopyDark);
  for (let x = 0; x < TILE_W; x += 5) {
    const r = rng.int(5, 9);
    const y = 30 + rng.int(-6, 3);
    disc(ctx, x, y, r, PAL.canopy);
    disc(ctx, x - 1, y - 2, Math.max(2, r - 4), PAL.canopyHi);
  }
  // hanging vines
  for (let i = 0; i < 9; i++) {
    const x = rng.int(0, TILE_W - 2);
    const len = rng.int(6, 22);
    for (let y = 34; y < 34 + len; y++) rect(ctx, x + ((y >> 2) & 1), y, 1, 1, PAL.vine);
    rect(ctx, x - 1, 34 + len, 3, 2, PAL.canopyHi);
  }
  // a few pōhutukawa blossoms in the canopy
  for (let i = 0; i < 6; i++) {
    const x = rng.int(4, TILE_W - 4);
    const y = rng.int(26, 36);
    rect(ctx, x, y, 3, 2, PAL.pohutu);
    rect(ctx, x + 1, y - 1, 1, 1, PAL.stamen);
  }
  return c;
}

export function createForestBiome(seed = 7) {
  const rng = createRng(seed);
  const layers = [cloudLayer(rng), mountainLayer(rng), farForestLayer(rng), nearForestLayer(rng)];
  const canopy = canopyTile(rng);
  const berry = gridToCanvas(['..s..', '.sss.', '.rRr.', 'rRRRr', 'rRRWr', '.rrr.'],
    { s: PAL.seed, r: PAL.berryDark, R: PAL.berry, W: '#ffd0d4' });
  const flower = gridToCanvas([
    '.p.p.',
    'pPyPp',
    '.pPp.',
    '..t..',
    '..t..',
    '.ltl.',
    '..t..',
  ], { p: PAL.pohutuDark, P: PAL.pohutu, y: PAL.stamen, t: PAL.trunk, l: PAL.leafHi });

  return {
    id: 'forest',
    name: 'Native Forest',
    PAL,
    tileW: TILE_W,
    layers,
    canopy,
    berry,
    flower,

    /** Static sky gradient for the current screen size (cached by the renderer). */
    paintSky(ctx, W, H, yOff) {
      const bands = PAL.sky;
      const horizon = yOff + 230;
      const bandH = Math.ceil(horizon / bands.length);
      for (let i = 0; i < bands.length; i++) rect(ctx, 0, i * bandH, W, bandH + 1, bands[i]);
      rect(ctx, 0, bands.length * bandH, W, H, bands[bands.length - 1]);
      for (let i = 1; i < bands.length; i++) dither(ctx, 0, i * bandH - 3, W, 3, bands[i], 2);
      for (let i = 1; i < bands.length; i++) dither(ctx, 0, i * bandH, W, 2, bands[i - 1], 1);
      // sun
      const sx = Math.round(W * 0.75), sy = yOff + 52;
      disc(ctx, sx, sy, 15, bands[2]);
      dither(ctx, sx - 15, sy - 15, 31, 31, bands[3], 0);
      disc(ctx, sx, sy, 11, PAL.sunRing);
      disc(ctx, sx, sy, 9, PAL.sun);
    },

    /** Builds (once) the cached art for a platform. */
    paintPlatform(p) {
      const r = createRng(p.artSeed);
      // Burning islands: charred top and glowing embers instead of grass.
      const G = p.fire
        ? { grass: PAL.char, grassHi: PAL.ember, grassDark: PAL.charHi, tuft: PAL.ember, tuftHi: PAL.emberHi }
        : { grass: PAL.grass, grassHi: PAL.grassHi, grassDark: PAL.grassDark, tuft: PAL.grass, tuftHi: PAL.grassHi };
      const w = p.w, h = p.h;
      const top = 4;
      const c = makeCanvas(w + 2, h + top + 14);
      const ctx = c.getContext('2d');
      const depth = new Int16Array(w);
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5 - w / 2) / (w / 2);
        depth[x] = Math.round(h * (0.62 + 0.38 * Math.sqrt(Math.max(0, 1 - u * u))) + (r.next() - 0.5) * 3);
      }
      // outline pass (1px larger)
      for (let x = 0; x < w; x++) rect(ctx, x, top - 1, 3, depth[x] + 2, PAL.outline);
      // soil body with strata
      for (let x = 0; x < w; x++) {
        const d = depth[x];
        rect(ctx, x + 1, top, 1, d, PAL.soil);
        rect(ctx, x + 1, top + Math.round(d * 0.55), 1, Math.ceil(d * 0.45), PAL.soilDark);
        rect(ctx, x + 1, top + d - 3, 1, 3, PAL.soilDeep);
        if (x === 0 || x === w - 1) rect(ctx, x + 1, top + 4, 1, d - 4, PAL.soilDark);
      }
      // embedded rocks
      const nRocks = Math.max(1, Math.round(w / 22));
      for (let i = 0; i < nRocks; i++) {
        const rx = r.int(4, Math.max(5, w - 8));
        const ry = top + r.int(6, Math.max(7, depth[Math.min(w - 1, rx)] - 6));
        const rw = r.int(4, 7), rh = r.int(3, 4);
        rect(ctx, rx, ry, rw, rh, PAL.rockDark);
        rect(ctx, rx, ry, rw - 1, rh - 1, PAL.rock);
        rect(ctx, rx, ry, rw - 2, 1, PAL.rockHi);
      }
      // hanging roots
      for (let x = 3; x < w - 3; x += r.int(5, 10)) {
        const len = r.int(3, 11);
        const d = depth[x];
        for (let y = 0; y < len; y++) rect(ctx, x + 1 + (y > len / 2 ? 1 : 0), top + d + y, 1, 1, y % 3 ? PAL.root : PAL.rootDark);
      }
      // grass cap (exactly at the gameplay surface: canvas row `top` == platform y)
      rect(ctx, 0, top - 1, w + 2, 1, PAL.outline);
      rect(ctx, 1, top, w, 3, G.grass);
      rect(ctx, 1, top, w, 1, G.grassHi);
      rect(ctx, 1, top + 3, w, 1, G.grassDark);
      // moss drips down the sides and front
      for (let x = 0; x < w; x += r.int(2, 5)) rect(ctx, x + 1, top + 4, 1, r.int(1, 4), G.grassDark);
      rect(ctx, 0, top, 1, 6, G.grassDark);
      rect(ctx, w + 1, top, 1, 6, G.grassDark);
      if (p.fire) {
        for (let x = 2; x < w - 2; x += r.int(2, 4)) rect(ctx, x, top + 1, 1, 1, r.chance(0.5) ? PAL.emberHi : PAL.ember);
        return { c, ox: -1, oy: -top };
      }
      // tufts and tiny ferns poking up
      for (let x = 2; x < w - 2; x += r.int(3, 7)) {
        rect(ctx, x, top - 2, 1, 2, G.tuft);
        rect(ctx, x + 1, top - 3, 1, 3, G.tuftHi);
      }
      if (w > 50 && r.chance(0.7)) {
        const fx = r.chance(0.5) ? 4 : w - 8;
        for (let k = 0; k < 4; k++) {
          rect(ctx, fx - k, top - 3 + (k * k) / 4, 1, 1, PAL.fern);
          rect(ctx, fx + k, top - 3 + (k * k) / 4, 1, 1, PAL.fernHi);
        }
      }
      return { c, ox: -1, oy: -top };
    },

    paintWater(ctx, W, yWater, yEnd, camX, t) {
      const cols = PAL.water;
      rect(ctx, 0, yWater, W, yEnd - yWater, cols[2]);
      rect(ctx, 0, yWater, W, 1, cols[0]);
      rect(ctx, 0, yWater + 1, W, 3, cols[1]);
      dither(ctx, 0, yWater + 4, W, 2, cols[1], 2);
      rect(ctx, 0, yWater + 10, W, yEnd - yWater - 10, cols[3]);
      dither(ctx, 0, yWater + 8, W, 2, cols[3], 2);
      if (yEnd - yWater > 22) rect(ctx, 0, yWater + 22, W, yEnd - yWater - 22, cols[4]);
      // drifting foam dashes (scroll with the world + current)
      const off = Math.floor(camX + t * 14);
      ctx.fillStyle = PAL.foam;
      for (let i = -1; i < W / 23 + 1; i++) {
        const x = i * 23 - (off % 23);
        const row = (i + Math.floor(off / 23)) & 3;
        ctx.fillRect(x, yWater + 2 + row * 2, 4 + (row & 1) * 2, 1);
      }
      ctx.fillStyle = cols[1];
      for (let i = -1; i < W / 31 + 1; i++) {
        const x = i * 31 - (Math.floor(camX * 0.9 + t * 9) % 31);
        ctx.fillRect(x, yWater + 13 + (i & 1) * 4, 6, 1);
      }
    },

    /** Flames licking the top of a burning island (drawn every frame). */
    drawFlames(ctx, sx, y, w, t, id) {
      const F = PAL.flame;
      for (let x = 2; x < w - 1; x += 3) {
        const n = Math.sin(t * 13 + x * 1.7 + id) + Math.sin(t * 7.3 + x * 0.6);
        const hgt = 3 + Math.round((n + 2) * 1.6);
        const fx = sx + x;
        rect(ctx, fx, y - hgt, 2, hgt, F[0]);
        rect(ctx, fx, y - hgt + 1, 2, Math.max(1, hgt - 3), F[1]);
        rect(ctx, fx + ((x >> 1) & 1), y - hgt, 1, Math.max(1, hgt - 4), F[2]);
        if (hgt > 7) rect(ctx, fx, y - hgt - 1, 1, 1, F[3]);
      }
      // smoke wisps rising
      ctx.fillStyle = PAL.smoke;
      for (let k = 0; k < 3; k++) {
        const life = (t * 0.9 + k * 0.37 + id * 0.13) % 1;
        const px = sx + ((k * 37 + id * 11) % Math.max(1, w - 6)) + 3 + Math.round(Math.sin(life * 9) * 2);
        ctx.globalAlpha = 0.7 * (1 - life);
        ctx.fillRect(px, Math.round(y - 10 - life * 26), 2, 2);
      }
      ctx.globalAlpha = 1;
    },

    /** Giant-wave crests on top of the calm river. surf[x] = surface y per screen column. */
    paintWaves(ctx, surf, yWater, W, t) {
      const cols = PAL.water;
      for (let x = 0; x < W; x++) {
        const top = surf[x];
        const lift = yWater - top;
        if (lift < 1) continue;
        rect(ctx, x, top, 1, lift + 2, cols[1]);
        if (lift > 6) rect(ctx, x, top + 4, 1, lift - 2, cols[2]);
        if (lift > 18) dither(ctx, x, top + 10, 1, lift - 10, cols[3], 1);
        rect(ctx, x, top, 1, lift > 10 ? 2 : 1, PAL.foam);
        // spray flicking off the crest
        if (lift > 14 && ((x * 7 + ((t * 20) | 0)) % 11) === 0) rect(ctx, x, top - 2 - ((x + ((t * 30) | 0)) % 3), 1, 1, PAL.foam);
      }
    },

    sharkSprite: null,
    finSprite: null,

    /** Draws a leaping shark centred at (x, y); dir 1 = moving right; u 0..1 through the leap. */
    drawShark(ctx, x, y, dir, u) {
      if (!this.sharkSprite) {
        const grid = [
          '........oo..........',
          '.......oGGo.........',
          '......oGGGo.......oo',
          '..oooooGGGGooooo.oGo',
          '.oHHHHHGGGGGGGGGoGGo',
          'oHHkHHGGGGGGGGGGGGo.',
          'oWWWWWWGGGGGGGGGGGGo',
          '.oWtWtWWWWWWGGGoooGo',
          '..oWWWWWWWWoooo..oo.',
          '...oooooooo.........',
        ];
        const pal = { o: '#1d2a33', G: PAL.shark, H: PAL.sharkHi, W: PAL.belly, k: '#0b1014', t: PAL.teeth };
        this.sharkSprite = [gridToCanvas(grid, pal), gridToCanvas(grid, pal, { flipX: true })];
      }
      // head-first: tilt up on the way up, down on the way down (2-frame pixel tilt)
      const img = this.sharkSprite[dir > 0 ? 1 : 0];
      const tilt = u < 0.4 ? -1 : u > 0.6 ? 1 : 0;
      const dx = Math.round(x - 10), dy = Math.round(y - 5);
      if (tilt === 0) { ctx.drawImage(img, dx, dy); return; }
      // shear by drawing the sprite in two halves offset vertically
      const lead = dir > 0 ? 10 : 0, trail = dir > 0 ? 0 : 10;
      ctx.drawImage(img, lead, 0, 10, 10, dx + lead, dy + tilt * 2, 10, 10);
      ctx.drawImage(img, trail, 0, 10, 10, dx + trail, dy - tilt * 1, 10, 10);
    },

    /** Dorsal fin cutting the surface: the warning before a leap. */
    drawFin(ctx, x, yWater, t, dir = 1) {
      if (!this.finSprite) {
        const g = ['....o', '...oG', '..oGG', '.oGGG', 'oGGGG', 'oGGGG', 'GGGGG'];
        const pal = { o: '#1d2a33', G: PAL.sharkDark };
        this.finSprite = [gridToCanvas(g, pal, { flipX: true }), gridToCanvas(g, pal)];
      }
      x = Math.round(x);
      const bob = ((t * 6) | 0) % 2;
      // shadow of the shark under the surface
      ctx.globalAlpha = 0.45;
      rect(ctx, x - 9, yWater + 3, 18, 3, PAL.sharkDark);
      rect(ctx, x - 6, yWater + 2, 12, 1, PAL.sharkDark);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.finSprite[dir > 0 ? 1 : 0], x - 2, yWater - 6 + bob);
      // wake
      const wk = ((t * 10) | 0) % 3;
      rect(ctx, x - dir * (5 + wk), yWater, 3, 1, PAL.foam);
      rect(ctx, x - dir * (9 + wk * 2), yWater + 1, 2, 1, PAL.foam);
      rect(ctx, x + dir * 3, yWater, 2, 1, PAL.foam);
    },

    /** Tuna (eel): bubbles + shadow while it lurks, then a lunge straight out of the river. */
    drawEel(ctx, x, headY, yWater, mode, u, t) {
      x = Math.round(x);
      if (mode === 'bubbles') {
        // dark coil under the surface + a boil of bubbles that gets stronger
        ctx.globalAlpha = 0.6;
        rect(ctx, x - 5, yWater + 3, 11, 4, PAL.eel);
        rect(ctx, x - 3, yWater + 7, 7, 2, PAL.eel);
        ctx.globalAlpha = 1;
        const nb = 4 + Math.round(u * 5);
        for (let k = 0; k < nb; k++) {
          const ph = (t * 3 + k * 0.23) % 1;
          const bx = x - 5 + ((k * 7) % 11);
          const big = k % 3 !== 1;
          rect(ctx, bx, Math.round(yWater + 1 - ph * 8), big ? 2 : 1, big ? 2 : 1, PAL.foam);
        }
        rect(ctx, x - 6, yWater, 13, 1, PAL.foam);
        if (u > 0.6 && ((t * 12) | 0) % 2) rect(ctx, x - 8, yWater - 1, 17, 1, PAL.foam);
        return;
      }
      if (mode !== 'strike') return;
      const top = Math.round(headY);
      const len = yWater - top;
      // wriggling body
      for (let y = top + 5; y < yWater + 2; y++) {
        const wob = Math.round(Math.sin(y * 0.25 + t * 18) * 1.2);
        rect(ctx, x - 2 + wob, y, 5, 1, PAL.eel);
        rect(ctx, x - 2 + wob, y, 1, 1, PAL.falconDark);
        rect(ctx, x + 2 + wob, y, 1, 1, PAL.falconDark);
        if (y % 3 === 0) rect(ctx, x + wob, y, 1, 1, PAL.eelBelly);
      }
      // head with open jaws
      rect(ctx, x - 3, top, 7, 6, PAL.falconDark);
      rect(ctx, x - 2, top + 1, 5, 5, PAL.eel);
      rect(ctx, x - 2, top + 1, 5, 1, PAL.eelHi);
      rect(ctx, x - 1, top - 2, 1, 3, PAL.eel);      // upper jaw
      rect(ctx, x + 2, top - 2, 1, 3, PAL.eel);      // lower jaw
      rect(ctx, x, top - 1, 2, 2, '#8a2033');        // mouth
      rect(ctx, x - 1, top - 2, 1, 1, '#ffffff');    // teeth
      rect(ctx, x + 2, top - 2, 1, 1, '#ffffff');
      rect(ctx, x - 2, top + 2, 1, 1, PAL.beakY);    // eye
      // splash where it breaks the surface
      if (len > 4) {
        const sp = ((t * 14) | 0) % 2;
        rect(ctx, x - 6 - sp, yWater - 1, 3, 1, PAL.foam);
        rect(ctx, x + 4 + sp, yWater - 1, 3, 1, PAL.foam);
        rect(ctx, x - 4, yWater - 3 - sp, 1, 1, PAL.foam);
        rect(ctx, x + 4, yWater - 3 - sp, 1, 1, PAL.foam);
      }
    },

    falconSprites: null,

    /** Kārearea (NZ falcon) flying left, wings beating; `dive` tilts it nose-down. */
    drawFalcon(ctx, x, y, t, dive) {
      if (!this.falconSprites) {
        const pal = { o: PAL.falconDark, B: PAL.falcon, C: PAL.falconChest, b: PAL.falconBar, y: PAL.beakY, k: '#0b0b0b', w: '#ffffff', L: PAL.falconLeg };
        const up = [
          '.......oo.........',
          '......oBBo........',
          '.....oBBBo........',
          '....oBBBo.........',
          '.oo.oBBo..........',
          'oykoooBooooooo....',
          'oyoBBCCbCbBBBBBoo.',
          '.ooBCbCCbCBBBBoBBo',
          '...ooCbCCbBBoo..oo',
          '.....oLooLoo......',
        ];
        const down = [
          '..................',
          '..................',
          '..................',
          '.oo...............',
          'oykoooooooooooo...',
          'oyoBBCCbCbBBBBBoo.',
          '.ooBCbCCbCBBBBoBBo',
          '...ooCbCCBBBBoo.oo',
          '.....oLBBBBo......',
          '.......oBBBo......',
          '........oBBo......',
          '.........oo.......',
        ];
        this.falconSprites = [gridToCanvas(up, pal), gridToCanvas(down, pal)];
      }
      const img = this.falconSprites[((t * 10) | 0) % 2];
      const dx = Math.round(x - 9), dy = Math.round(y - 6);
      if (!dive) { ctx.drawImage(img, dx, dy); return; }
      // nose-down: draw in vertical slices offset by a small slope
      for (let sx = 0; sx < 18; sx += 3) ctx.drawImage(img, sx, 0, 3, 12, dx + sx, dy - Math.round((sx - 9) / 4), 3, 12);
    },

    /** Edge-of-screen warning: where the falcon will come from. `locked`: committed height. */
    drawFalconWarning(ctx, x, y, t, locked) {
      const on = locked ? ((t * 10) | 0) % 2 : ((t * 5) | 0) % 2;
      const col = locked ? '#ff3a4a' : '#ffd84a';
      disc(ctx, x, y, 6, '#16363a');
      disc(ctx, x, y, 5, on ? col : '#16363a');
      rect(ctx, x - 1, y - 3, 2, 4, on ? '#16363a' : col);
      rect(ctx, x - 1, y + 2, 2, 1, on ? '#16363a' : col);
      // arrow pointing at the bird's lane
      rect(ctx, x - 10, y, 3, 1, col);
      rect(ctx, x - 9, y - 1, 1, 3, col);
    },

    /** Waterspout column from the river (yWater) up to `top`, with a storm cloud under the canopy. */
    drawSpout(ctx, x, top, yWater, ceilY, k, mode, t) {
      x = Math.round(x);
      const S = PAL.spout;
      // storm cloud gathers under the canopy whenever the spout is forming or active
      if (mode !== 'off') {
        const cr = mode === 'forming' ? 5 : 8;
        disc(ctx, x - 6, ceilY + 2, cr, PAL.stormDark);
        disc(ctx, x + 5, ceilY + 3, cr - 1, PAL.stormDark);
        disc(ctx, x, ceilY + 1, cr, PAL.storm);
      }
      if (mode === 'forming' || mode === 'grow') {
        // ripples spinning on the surface
        const ring = ((t * 10) | 0) % 6;
        rect(ctx, x - 4 - ring, yWater + 1, 3, 1, PAL.foam);
        rect(ctx, x + 2 + ring, yWater + 1, 3, 1, PAL.foam);
      }
      if (k <= 0) return;
      const height = yWater - top;
      for (let y = Math.round(top); y < yWater; y++) {
        const up = (yWater - y) / Math.max(1, yWater - ceilY);
        const hw = 3 + Math.round(up * 4);
        const wob = Math.round(Math.sin(y * 0.15 + t * 6) * 1.5);
        const stripe = ((y + ((t * 70) | 0)) % 6) < 3;
        rect(ctx, x - hw + wob, y, hw * 2 + 1, 1, stripe ? S[1] : S[2]);
        rect(ctx, x - hw + wob + (stripe ? 1 : hw), y, 2, 1, S[0]);
      }
      // spray at the base
      const sp = ((t * 12) | 0) % 3;
      disc(ctx, x, yWater, 4 + sp, PAL.foam);
      if (height > 20) rect(ctx, x - 8 - sp, yWater - 3 - sp, 1, 1, PAL.foam);
      if (height > 20) rect(ctx, x + 8 + sp, yWater - 2 - sp, 1, 1, PAL.foam);
    },

    /**
     * Art for a hanging canopy mass (cached per segment), drawn over the canopy fill that the
     * renderer extends down to the mass's underside: leaf clusters, vines with pōhutukawa
     * blossoms, and outlined leafy sides so its walls read clearly.
     */
    paintHanging(c, normalY) {
      const r = createRng(c.artSeed);
      const w = c.w;
      const cv = makeCanvas(w + 4, c.y + 4);
      const ctx = cv.getContext('2d');
      const top = Math.max(0, normalY - 6);
      const bottom = c.y - 6;
      // leaf clusters texturing the body
      const n = Math.max(3, Math.round((w * (bottom - top)) / 70));
      for (let i = 0; i < n; i++) {
        const x = r.int(4, Math.max(5, w - 2));
        const y = r.int(top, Math.max(top + 1, bottom));
        disc(ctx, x, y, r.int(2, 3), r.chance(0.6) ? PAL.canopy : PAL.leafDark);
        if (r.chance(0.4)) rect(ctx, x - 1, y - 2, 2, 1, PAL.canopyHi);
      }
      // a few vines with blossoms
      for (let i = 0; i < Math.max(1, Math.round(w / 30)); i++) {
        const x = r.int(5, Math.max(6, w - 3));
        const y0 = r.int(top, Math.max(top + 1, bottom - 20));
        const len = r.int(8, 20);
        for (let y = y0; y < Math.min(bottom, y0 + len); y++) rect(ctx, x + ((y >> 2) & 1), y, 1, 1, PAL.vine);
        if (r.chance(0.6)) {
          const fy = Math.min(bottom - 2, y0 + len);
          rect(ctx, x - 1, fy, 3, 2, PAL.pohutu);
          rect(ctx, x, fy - 1, 1, 1, PAL.stamen);
        }
      }
      // leafy, outlined sides
      for (const side of [0, 1]) {
        const ex = side ? w + 2 : 1;
        rect(ctx, ex, top, 1, c.y - top + 1, PAL.outline);
        for (let y = top + 2; y < c.y - 2; y += 4) {
          const bx = side ? ex - 2 : ex + 2;
          disc(ctx, bx, y + ((y >> 2) & 1), 2, (y >> 3) & 1 ? PAL.canopy : PAL.canopyHi);
        }
      }
      // underside outline and leaf tips
      rect(ctx, 1, c.y, w + 2, 1, PAL.outline);
      for (let x = 3; x < w; x += r.int(3, 6)) rect(ctx, x, c.y + 1, 2, 1, PAL.canopy);
      return { c: cv, ox: -2, oy: 0 };
    },

    /** Animated foam stripes over the background waterfalls. */
    paintFall(ctx, x, y, w, h, t) {
      const off = Math.floor(t * 40);
      for (let yy = 0; yy < h; yy++) {
        const k = (yy + off) % 9;
        if (k < 2) rect(ctx, x + ((yy * 3) % w), y + yy, 2, 1, PAL.fall);
        if (k === 5) rect(ctx, x + w - 2 - ((yy * 5) % (w - 1)), y + yy, 1, 1, PAL.fallDark);
      }
      rect(ctx, x, y, 1, h, PAL.fall);
      // mist puffs at the base
      const m = Math.floor(t * 5) & 1;
      disc(ctx, x + 1, y + h - 1, 3 + m, PAL.mist);
      disc(ctx, x + w - 1, y + h, 3 + (1 - m), PAL.mist);
    },
  };
}
