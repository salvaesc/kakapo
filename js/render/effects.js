// Lightweight visual effects: pooled particles, score popups, screen shake, banners.
// Everything is preallocated — nothing is created inside the game loop.
import { drawText } from './pixelfont.js';

const MAX_PARTICLES = 160;
const MAX_POPUPS = 12;

export class Effects {
  constructor() {
    this.p = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.p.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, color: '#fff', size: 1, kind: 0 });
    }
    this.pop = [];
    for (let i = 0; i < MAX_POPUPS; i++) this.pop.push({ on: false, x: 0, y: 0, life: 0, text: '', color: '#fff' });
    this.shake = 0;
    this.flash = 0;
    this.banner = { text: '', life: 0, color: '#fff' };
    this._cursor = 0;
  }

  reset() {
    for (const p of this.p) p.on = false;
    for (const p of this.pop) p.on = false;
    this.shake = 0; this.flash = 0; this.banner.life = 0;
  }

  spawn(x, y, vx, vy, g, life, color, size = 1, kind = 0) {
    // round-robin over the pool: oldest particle is recycled when full
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const i = (this._cursor + n) % MAX_PARTICLES;
      if (!this.p[i].on || n === MAX_PARTICLES - 1) {
        const p = this.p[i];
        p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.g = g;
        p.life = life; p.max = life; p.color = color; p.size = size; p.kind = kind;
        this._cursor = (i + 1) % MAX_PARTICLES;
        return p;
      }
    }
    return null;
  }

  burst(x, y, n, colors, speed, up, g, life, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.6 - up, g, life * (0.6 + Math.random() * 0.4),
        colors[i % colors.length], size);
    }
  }

  popup(x, y, text, color = '#fff') {
    let slot = this.pop[0];
    for (const p of this.pop) { if (!p.on) { slot = p; break; } if (p.life < slot.life) slot = p; }
    slot.on = true; slot.x = x; slot.y = y; slot.life = 1.1; slot.text = text; slot.color = color;
  }

  showBanner(text, color = '#ffd84a', life = 1.6) {
    this.banner.text = text; this.banner.life = life; this.banner.max = life; this.banner.color = color;
  }

  addShake(amount) { this.shake = Math.max(this.shake, amount); }

  update(dt) {
    for (const p of this.p) {
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      p.vy += p.g * dt;
      if (p.kind === 1) p.vx = Math.sin(p.life * 8) * 12; // feathers sway
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const p of this.pop) {
      if (!p.on) continue;
      p.life -= dt;
      p.y -= 14 * dt;
      if (p.life <= 0) p.on = false;
    }
    this.shake = Math.max(0, this.shake - dt * 18);
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.banner.life > 0) this.banner.life -= dt;
  }

  /** World-space particles; camX is subtracted, yOff added. */
  draw(ctx, camX, yOff) {
    for (const p of this.p) {
      if (!p.on) continue;
      const s = p.life < p.max * 0.3 && p.size > 1 ? p.size - 1 : p.size;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y + yOff), s, s);
    }
    for (const p of this.pop) {
      if (!p.on) continue;
      if (p.life < 0.25 && ((p.life * 20) | 0) % 2) continue; // blink out
      drawText(ctx, p.text, p.x - camX, p.y + yOff, { color: p.color, outline: '#16363a', align: 'center' });
    }
  }

  drawBanner(ctx, W, y) {
    const b = this.banner;
    if (b.life <= 0) return;
    const t = b.max - b.life;
    const scale = 2;
    const pop = t < 0.15 ? Math.round((0.15 - t) * 40) : 0;
    if (b.life < 0.3 && ((b.life * 20) | 0) % 2) return;
    drawText(ctx, b.text, W / 2, y - pop, { scale, color: b.color, outline: '#16363a', shadow: '#16363a', align: 'center' });
  }
}
