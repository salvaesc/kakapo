// The end card burnt into the run video: title, score, distance and record, so whoever
// receives the clip on WhatsApp knows how it went. Drawn only on the recording canvas
// (the player sees the normal results screen).
import { drawText, textWidth } from '../render/pixelfont.js';

const INK = '#0d2326';
const PANEL = '#16363a';
const LIME = '#c6f06a';
const GOLD = '#ffd84a';
const PALE = '#e8f4d8';

/** Largest integer scale (≤ max) at which `str` fits in `width` pixels. */
function fit(str, width, max) {
  const one = textWidth(str, 1);
  return Math.max(1, Math.min(max, Math.floor(width / Math.max(1, one))));
}

function centered(ctx, str, cx, y, scale, color) {
  drawText(ctx, str, Math.round(cx), Math.round(y), { scale, color, shadow: INK, align: 'center' });
  return 5 * scale;
}

/**
 * card: { title, score, metres, best, newBest }
 * alpha: 0..1 fade-in.
 */
export function drawEndCard(ctx, w, h, card, alpha) {
  if (!card || alpha <= 0) return;
  const u = Math.max(2, Math.floor(w / 80));     // base pixel size (~4 on a 334 px wide video)
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = Math.min(1, alpha);

  // darken the game behind
  ctx.fillStyle = 'rgba(8, 24, 26, 0.55)';
  ctx.fillRect(0, 0, w, h);

  // panel
  const pw = Math.round(w * 0.86);
  const inner = pw - 6 * u;
  const title = String(card.title || 'KAKAPO').toUpperCase();
  const score = String(card.score | 0);
  const stats = `${card.metres | 0} M  -  BEST ${card.best | 0}`;
  const sT = fit(title, inner, 3 * u);
  const sS = fit(score, inner, 5 * u);
  const sM = fit(stats, inner, u + Math.floor(u / 2));
  const sF = fit('SHOUT TO FLY', inner, u);
  const gap = 3 * u;
  const ph = 4 * u + 5 * sT + gap + 5 * sS + u * 2 + 5 * u + gap + 5 * sM + gap * 2 + 5 * 2 * u + u * 2 + 5 * sF + 4 * u;
  const px = Math.round((w - pw) / 2);
  const py = Math.round(h * 0.52 - ph / 2);
  ctx.fillStyle = INK;
  ctx.fillRect(px + u, py + u, pw, ph);           // drop shadow
  ctx.fillStyle = PANEL;
  ctx.fillRect(px, py, pw, ph);
  ctx.fillStyle = LIME;                           // pixel border
  ctx.fillRect(px, py, pw, u);
  ctx.fillRect(px, py + ph - u, pw, u);
  ctx.fillRect(px, py, u, ph);
  ctx.fillRect(px + pw - u, py, u, ph);

  const cx = w / 2;
  let y = py + 4 * u;
  y += centered(ctx, title, cx, y, sT, card.newBest ? GOLD : LIME) + gap;
  y += centered(ctx, score, cx, y, sS, '#ffffff') + u * 2;
  y += centered(ctx, 'POINTS', cx, y, u, PALE) + gap;
  y += centered(ctx, stats, cx, y, sM, card.newBest ? GOLD : PALE) + gap * 2;
  y += centered(ctx, 'KAKAPO', cx, y, 2 * u, LIME) + u * 2;
  centered(ctx, 'SHOUT TO FLY', cx, y, sF, PALE);
  ctx.restore();
}
