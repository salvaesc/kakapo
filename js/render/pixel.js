// Pixel-art helpers: sprite grids → cached canvases, crisp drawing primitives.

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return c;
}

/**
 * Turns a sprite definition (array of strings, one char per pixel) into a canvas.
 * '.' and ' ' are transparent; other chars are looked up in `palette`.
 * This is the single swap point if hand-made sprite sheets replace procedural art.
 */
export function gridToCanvas(grid, palette, { flipX = false } = {}) {
  const h = grid.length;
  let w = 0;
  for (const row of grid) w = Math.max(w, row.length);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(flipX ? w - 1 - x : x, y, 1, 1);
    }
  }
  return c;
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

/** Ordered 2x2 dither between two colours across a rectangle (pattern p: 0..4 pixels of 4). */
const BAYER2 = [0, 2, 3, 1];
export function dither(ctx, x0, y0, w, h, colorB, p) {
  ctx.fillStyle = colorB;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (BAYER2[((y0 + y) & 1) * 2 + ((x0 + x) & 1)] < p) ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

/** Filled pixel circle (no anti-aliasing). */
export function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y) + 0.3);
    ctx.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}
