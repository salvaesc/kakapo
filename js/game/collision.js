// Collision detection between the bird's box and solid platforms.
// Resolution uses the previous position to decide which face was crossed,
// so a landing can never leave the bird sunk into a platform.

export function overlaps(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

/**
 * @returns {null | 'top' | 'bottom' | 'left' | 'right'} the platform face that was hit.
 * prevX/prevY and curX/curY are the bird centre positions; hw/hh the hitbox half sizes.
 */
export function hitFace(prevX, prevY, curX, curY, hw, hh, p) {
  if (!overlaps(curX - hw, curY - hh, curX + hw, curY + hh, p.x, p.y, p.x + p.w, p.y + p.h)) return null;
  const prevBottom = prevY + hh;
  const prevTop = prevY - hh;
  if (prevBottom <= p.y + 0.5) return 'top';
  if (prevTop >= p.y + p.h - 0.5) return 'bottom';
  if (prevX + hw <= p.x + 0.5) return 'left';
  if (prevX - hw >= p.x + p.w - 0.5) return 'right';
  // Started inside (rare: spawned/teleported). Push out along the smallest penetration.
  const pen = [
    ['top', curY + hh - p.y],
    ['bottom', p.y + p.h - (curY - hh)],
    ['left', curX + hw - p.x],
    ['right', p.x + p.w - (curX - hw)],
  ];
  pen.sort((a, b) => a[1] - b[1]);
  return pen[0][0];
}

/** A landing needs some foot overlap, not just the corner of the hitbox. */
export function footOverlap(x, hw, p) {
  return Math.min(x + hw, p.x + p.w) - Math.max(x - hw, p.x);
}

export function circleHitsBox(cx, cy, r, x0, y0, x1, y1) {
  const nx = cx < x0 ? x0 : cx > x1 ? x1 : cx;
  const ny = cy < y0 ? y0 : cy > y1 ? y1 : cy;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}
