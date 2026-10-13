// Canvas renderer. Draws the whole game into a low-resolution buffer at the
// pixel-art grid size, then blits it to the screen with an integer scale and
// no smoothing — so every art pixel is a crisp square on every device.
//
// The renderer only *reads* simulation state. A future capture module can grab
// `renderer.display` (or compose it with camera video) without touching the game.
import { makeCanvas, rect, gridToCanvas } from './pixel.js';
import { createPose, poseFor, drawKakapo } from './kakapo.js';
import { drawText } from './pixelfont.js';
import { sharkAt, spoutAt, eelAt } from '../game/hazards.js';
import { sinkDepth } from '../game/sim.js';

const SH = { mode: 'hidden', x: 0, y: 0, dir: 1, u: 0 };
const SP = { mode: 'off', x: 0, top: 0, k: 0 };
const EL = { mode: 'hidden', x: 0, headY: 0, u: 0 };

export class Renderer {
  constructor(display, config, biome) {
    this.display = display;
    this.cfg = config;
    this.biome = biome;
    this.dctx = display.getContext('2d', { alpha: false });
    this.camSharp = false; // this frame: sharp camera behind a transparent game buffer
    this.pose = createPose();
    this.W = 180; this.H = 320; this.scale = 1; this.yOff = 0;
    this.buffer = null;
    this.sky = null;
    this.birdScreenX = 52;
    this.cssWidth = 0; this.cssHeight = 0;
    const heart = ['.oo.oo.', 'orwrrro', 'orrrrro', '.orrro.', '..oro..', '...o...'];
    this.heartFull = gridToCanvas(heart, { o: '#16363a', r: '#ff4f6a', w: '#ffd0d6' });
    this.heartEmpty = gridToCanvas(heart, { o: '#16363a', r: '#3a4a4c', w: '#4d5f61' });
    this.heartFlash = gridToCanvas(heart, { o: '#16363a', r: '#ffffff', w: '#ffffff' });
  }

  setBiome(biome) {
    this.biome = biome;
    this.sky = null;
  }

  /** Recomputes the logical resolution and integer scale for the viewport. */
  resize(viewW, viewH, dpr) {
    const V = this.cfg.view;
    const devW = Math.round(viewW * dpr);
    const devH = Math.round(viewH * dpr);
    let scale = Math.max(1, Math.floor(devH / V.playHeight));
    let W = Math.ceil(devW / scale);
    while (W < V.minWidth && scale > 1) { scale--; W = Math.ceil(devW / scale); }
    W = Math.min(W, V.maxWidth);
    const H = Math.max(V.playHeight, Math.ceil(devH / scale));
    this.W = W; this.H = H; this.scale = scale;
    this.yOff = Math.floor((H - V.playHeight) * 0.4);
    this.birdScreenX = Math.min(V.maxBirdScreenX, Math.round(W * V.birdScreenX));
    this.display.width = W * scale;
    this.display.height = H * scale;
    this.cssWidth = (W * scale) / dpr;
    this.cssHeight = (H * scale) / dpr;
    this.display.style.width = this.cssWidth + 'px';
    this.display.style.height = this.cssHeight + 'px';
    this.buffer = makeCanvas(W, H);
    this.surf = new Int16Array(W);
    this.ctx = this.buffer.getContext('2d'); // with alpha: the sharp camera shows through
    this.ctx.imageSmoothingEnabled = false;
    this.dctx.imageSmoothingEnabled = false;
    this.sky = null;
  }

  /** Converts a client (CSS) coordinate to logical game pixels. */
  toLogical(clientX, clientY) {
    const r = this.display.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.W, y: ((clientY - r.top) / r.height) * this.H };
  }

  _drawLayers(ctx, camX, t, skip = 0) {
    const B = this.biome;
    const TW = B.tileW;
    for (let li = skip; li < B.layers.length; li++) {
      const L = B.layers[li];
      const scroll = camX * L.factor + (L.drift ? t * L.drift : 0);
      const off = -(((scroll % TW) + TW) % TW);
      for (let x = Math.floor(off); x < this.W; x += TW) {
        ctx.drawImage(L.canvas, x, this.yOff + L.y);
        if (L.falls) for (const f of L.falls) B.paintFall(ctx, x + f.x, this.yOff + f.y, f.w, f.h, t);
      }
    }
  }

  render(sim, t, fx, hud) {
    if (!this.buffer) return;
    const ctx = this.ctx;
    const W = this.W, H = this.H, yOff = this.yOff;
    const C = this.cfg;
    const B = this.biome;
    const bird = sim.bird;

    // Screen shake (integer pixels only)
    const sh = fx.shake > 0.5 ? Math.round((Math.random() - 0.5) * fx.shake) : 0;
    const sv = fx.shake > 0.5 ? Math.round((Math.random() - 0.5) * fx.shake) : 0;
    const camX = Math.round(bird.x - this.birdScreenX) + sh;

    if (!this.sky) {
      this.sky = makeCanvas(W, H);
      B.paintSky(this.sky.getContext('2d'), W, H, yOff);
    }
    // The sky is the player's camera when it is on (see capture/camera.js)
    let cam = false;
    this.camSharp = false;
    if (this.camera && this.camera.on) {
      if (this.cfg.camera.pixelated) {
        cam = this.camera.draw(ctx, W, H);
      } else {
        ctx.clearRect(0, 0, W, H); // leave the sky transparent; the sharp video goes behind
        cam = this.camSharp = true;
      }
    }
    if (!cam) ctx.drawImage(this.sky, 0, 0);
    this._drawLayers(ctx, camX, t, cam ? this.cfg.camera.hideLayers : 0);

    const Y = yOff + sv; // world→screen vertical offset

    // Platforms
    const plats = sim.world.platforms;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      const sx = p.x - camX;
      if (sx > W + 4 || sx + p.w < -4) continue;
      if (!p.art) p.art = B.paintPlatform(p);
      ctx.drawImage(p.art.c, sx + p.art.ox, p.y + Y + p.art.oy);
      if (p.fire) B.drawFlames(ctx, sx, p.y + Y, p.w, t, p.id);
      if (p.checkpoint) {
        const fxp = sx + Math.round(p.w * 0.72);
        const sway = Math.round(Math.sin(t * 2 + p.id) * 0.6);
        ctx.drawImage(B.flower, fxp - 2 + sway, p.y + Y - 7);
        if (p.visited && ((t * 6) | 0) % 3 === 0) rect(ctx, fxp + 3, p.y + Y - 9, 1, 1, '#fff6c2');
      }
    }

    // Waterspouts (behind the bird)
    const hzs = sim.world.hazards;
    const st = sim.time;
    for (let i = 0; i < hzs.length; i++) {
      const hz = hzs[i];
      if (hz.type !== 'spout' || hz.x1 - camX < -20 || hz.x0 - camX > W + 20) continue;
      spoutAt(hz, st, SP);
      B.drawSpout(ctx, SP.x - camX, SP.top + Y, C.field.waterY + Y, hz.ceilY + Y, SP.k, SP.mode, t);
    }

    // Shadow under a flying bird: makes landing precise and readable.
    if (bird.state === 'fly') {
      let best = null;
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (bird.x >= p.x && bird.x <= p.x + p.w && p.y >= bird.y && (!best || p.y < best.y)) best = p;
      }
      if (best) {
        const dist = best.y - bird.y;
        const w = Math.max(2, 10 - Math.floor(dist / 18));
        ctx.globalAlpha = 0.45;
        rect(ctx, Math.round(bird.x - camX - w / 2), best.y + Y, w, 2, '#1b4a2a');
        ctx.globalAlpha = 1;
      }
    }

    // Rimu berries
    const berries = sim.world.berries;
    for (let i = 0; i < berries.length; i++) {
      const b = berries[i];
      if (b.taken) continue;
      const sx = b.x - camX;
      if (sx < -8 || sx > W + 8) continue;
      const bob = Math.round(Math.sin(t * 3 + b.phase) * 1.5);
      ctx.drawImage(B.berry, sx - 2, b.y + Y - 3 + bob);
    }

    // Resting indicator: soft glowing dots on the platform under the bird.
    if (bird.state === 'rest' && bird.victoryT <= 0 && !hud.hideBird) {
      const pulse = ((t * 2) | 0) % 2;
      const bx = Math.round(bird.x - camX);
      const fy = Math.round(bird.y + C.flight.hitHalfH) + Y;
      ctx.fillStyle = '#e8ffb0';
      ctx.fillRect(bx - 9 - pulse, fy + 1, 1, 1);
      ctx.fillRect(bx + 9 + pulse, fy + 1, 1, 1);
      // takeoff charge pips
      if (bird.holdT > 0) {
        const n = Math.min(5, Math.ceil((bird.holdT / C.rest.takeoffHold) * 5));
        for (let i = 0; i < n; i++) rect(ctx, bx - 5 + i * 2, fy - 24, 1, 2, '#ffd84a');
      }
      if (bird.restT > C.rest.sleepAfter) {
        const zt = (t * 0.8) % 1;
        drawText(ctx, 'Z', bx + 6 + Math.round(zt * 4), fy - 22 - Math.round(zt * 8), { color: '#ffffff', outline: '#16363a' });
      }
    }

    // The kakapo
    poseFor(this.pose, bird, t);
    const blinkOut = bird.invulnT > 0 && bird.state !== 'dead' && bird.state !== 'ko' && ((t * 14) | 0) % 2 === 0;
    const bsx = Math.round(bird.x - camX), bsy = Math.round(bird.y) + Y;
    if (!hud.hideBird && !blinkOut) drawKakapo(ctx, bsx, bsy, this.pose);
    if (!hud.hideBird && bird.burnT < 0.7) B.drawFlames(ctx, bsx - 5, bsy + C.flight.hitHalfH + 1, 11, t * 1.5, 3);

    // Leaping sharks (in front of the bird)
    for (let i = 0; i < hzs.length; i++) {
      const hz = hzs[i];
      if (hz.type !== 'shark' || hz.x1 - camX < -20 || hz.x0 - camX > W + 20) continue;
      if (sharkAt(hz, st, SH).mode === 'leap') B.drawShark(ctx, SH.x - camX, SH.y + Y, SH.dir, SH.u);
    }

    // Free-fall warning: "!" from warnFraction, red and blinking once the landing will hurt.
    const danger = sim.fallDanger;
    if (!hud.hideBird && danger >= C.lives.warnFraction) {
      const hurts = danger >= 1;
      if (!hurts || ((t * 8) | 0) % 2) {
        drawText(ctx, hurts ? '!!' : '!', bsx, bsy - 24, { scale: 2, color: hurts ? '#ff4f6a' : '#ffd84a', outline: '#16363a', align: 'center' });
      }
    }

    fx.draw(ctx, camX, Y);

    // Foreground: river (with giant waves) and the canopy maze
    const waterY = C.field.waterY + Y;
    B.paintWater(ctx, W, waterY, H, camX, t);
    const surf = this.surf;
    let anyWave = false;
    for (let x = 0; x < W; x++) {
      surf[x] = Math.round(sim.world.waterAt(camX + x, st)) + Y;
      if (surf[x] < waterY) anyWave = true;
    }
    if (anyWave) B.paintWaves(ctx, surf, waterY, W, t);
    for (let i = 0; i < hzs.length; i++) {
      const hz = hzs[i];
      if (hz.type !== 'shark' || hz.x1 - camX < -30 || hz.x0 - camX > W + 30) continue;
      if (sharkAt(hz, st, SH).mode === 'fin') B.drawFin(ctx, SH.x - camX, waterY, t, SH.dir);
    }
    for (let i = 0; i < hzs.length; i++) {
      const hz = hzs[i];
      if (hz.type !== 'eel' || hz.x1 - camX < -20 || hz.x0 - camX > W + 20) continue;
      eelAt(hz, st, EL);
      B.drawEel(ctx, EL.x - camX, EL.headY + Y, waterY, EL.mode, EL.u, t);
    }
    if (bird.state === 'dead' && !bird.deadOnGround && !hud.hideBird) this._drawUnderwater(ctx, bird, bsx, bsy, waterY, camX, t);
    this._drawCanopy(ctx, sim, camX, Y, yOff);

    // Kārearea: warning at the right edge, then the dive (in front of everything)
    const pr = sim.pred;
    if (pr.state === 'warn' && !hud.hideBird) {
      B.drawFalconWarning(ctx, W - 9, Math.round(pr.targetY) + Y, t, pr.t < C.predator.lockAt);
    } else if (pr.state === 'dive') {
      B.drawFalcon(ctx, pr.x - camX, pr.y + Y, t, true);
    }

    this._drawHud(ctx, sim, fx, hud, t);

    if (fx.flash > 0) {
      ctx.globalAlpha = fx.flash * 0.35;
      rect(ctx, 0, 0, W, H, '#ffffff');
      ctx.globalAlpha = 1;
    }

    if (this.camSharp && !this.camera.drawSharp(this.dctx, this.display.width, this.display.height)) {
      this.dctx.drawImage(this.sky, 0, 0, W * this.scale, H * this.scale);
    }
    this.dctx.drawImage(this.buffer, 0, 0, W * this.scale, H * this.scale);
  }

  /** The drowning kakapo seen through the water, plus his trail of bubbles. */
  _drawUnderwater(ctx, bird, bsx, bsy, waterY, camX, t) {
    const S = this.cfg.sink;
    const depth = bsy - waterY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, waterY + 1, this.W, this.H - waterY);
    ctx.clip();
    const fadeOut = Math.max(0, Math.min(1, (2.6 - bird.deadT) / 0.8));
    ctx.globalAlpha = Math.max(0, 0.75 * (1 - depth / (S.maxDepth * 2.2)) * fadeOut);
    drawKakapo(ctx, bsx, bsy, this.pose);
    ctx.globalAlpha = 1;
    // bubbles: one every bubbleEvery s, rising from his beak to the surface
    const n = Math.floor(Math.min(bird.deadT, S.bubbleFor) / S.bubbleEvery);
    for (let k = 0; k < n; k++) {
      const born = S.delay + k * S.bubbleEvery;
      const age = bird.deadT - born;
      if (age < 0) continue;
      const y0 = waterY + 2 + sinkDepth(born, S) - 6;
      const y = y0 - age * S.bubbleRise * (1 + (k % 3) * 0.25);
      const x = bsx + 3 + Math.round(Math.sin(k * 2.1 + age * 7) * 2);
      if (y > waterY + 1) {
        const big = k % 3 === 0;
        rect(ctx, x, Math.round(y), big ? 2 : 1, big ? 2 : 1, '#e9fbfd');
        if (big) rect(ctx, x, Math.round(y), 1, 1, '#ffffff');
      }
    }
    ctx.restore();
    // pops at the surface
    for (let k = 0; k < n; k++) {
      const born = S.delay + k * S.bubbleEvery;
      const y0 = waterY + 2 + sinkDepth(born, S) - 6;
      const tSurf = born + (y0 - waterY) / (S.bubbleRise * (1 + (k % 3) * 0.25));
      const since = bird.deadT - tSurf;
      if (since >= 0 && since < 0.18) {
        const r = 1 + Math.round(since * 14);
        rect(ctx, bsx + 3 - r, waterY - 1, 1, 1, '#ffffff');
        rect(ctx, bsx + 3 + r, waterY - 1, 1, 1, '#ffffff');
        rect(ctx, bsx + 3, waterY - 1 - r, 1, 1, '#ffffff');
      }
    }
  }

  _drawCanopy(ctx, sim, camX, Y, yOff) {
    const B = this.biome;
    const W = this.W;
    const normal = this.cfg.field.ceilingY;
    const coff = -(((camX % B.tileW) + B.tileW) % B.tileW);
    const cs = sim.world.ceilings;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const sx = c.x - camX;
      if (sx > W || sx + c.w < 0) continue;
      const x0 = Math.max(0, sx), x1 = Math.min(W, sx + c.w);
      // canopy leaves end ~4 px below the tile's row 32: align them with the underside
      const leafY = c.y + Y - 34;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, this.H);
      ctx.clip();
      if (leafY > 0) rect(ctx, x0, 0, x1 - x0, leafY + 1, B.PAL.canopyDark);
      for (let x = coff; x < W; x += B.tileW) ctx.drawImage(B.canopy, x, leafY);
      ctx.restore();
      if (c.kind === 'drop') {
        if (!c.art) c.art = B.paintHanging(c, normal);
        ctx.drawImage(c.art.c, sx + c.art.ox, Y + c.art.oy);
      }
    }
  }

  _drawHud(ctx, sim, fx, hud, t) {
    const W = this.W, H = this.H;
    if (hud.showScore) {
      drawText(ctx, String(sim.score), W / 2, this.yOff + 6, { scale: 2, color: '#ffffff', outline: '#16363a', shadow: '#16363a', align: 'center' });
      drawText(ctx, `${sim.metres}M`, 6, this.yOff + 8, { color: '#e4f2a0', outline: '#16363a' });
      // Hearts
      const b = sim.bird;
      for (let i = 0; i < this.cfg.lives.max; i++) {
        let img = i < b.lives ? this.heartFull : this.heartEmpty;
        let dy = 0;
        if (i === b.lives && b.hurtT < 0.8) {           // the heart just lost
          if (((b.hurtT * 10) | 0) % 2 === 0) img = this.heartFlash;
          dy = b.hurtT < 0.3 ? -1 : 0;
        }
        if (i === b.lives - 1 && b.lives === 1 && ((t * 3) | 0) % 2) dy = -1; // last heart throbs
        ctx.drawImage(img, 5 + i * 15, this.yOff + 17 + dy * 2, 14, 12);
      }
      if (hud.best > 0) drawText(ctx, `BEST ${hud.best}`, W - 6, this.yOff + 8, { color: '#ffd84a', outline: '#16363a', align: 'right' });
    }
    fx.drawBanner(ctx, W, this.yOff + 70);

    if (!hud.showMeter) return;
    // Voice meter: a stereo-style wedge of bars. Taller and redder to the right says
    // "more voice = more speed". A peak marker hangs at the top for a moment.
    const lvl = Math.max(0, Math.min(1, hud.level));
    const dtH = Math.min(0.1, Math.max(0, t - (this._meterT || t)));
    this._meterT = t;
    this._peak = Math.max(lvl, (this._peak || 0) - dtH * 0.45);
    const mx = 20, mw = W - 26, base = H - 3, maxH = 14;
    const n = Math.max(8, Math.floor(mw / 4));
    const lit = Math.round(lvl * n);
    const peakI = Math.min(n - 1, Math.round(this._peak * n) - 1);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const h = 2 + Math.round(u * (maxH - 2));
      const x = mx + i * 4;
      const col = u < 0.42 ? ['#8fdc4a', '#c6f06a'] : u < 0.74 ? ['#ffd84a', '#fff0a0'] : ['#ff5a3a', '#ffb08a'];
      rect(ctx, x - 1, base - h - 1, 5, h + 2, '#16363a');
      if (i < lit) {
        rect(ctx, x, base - h, 3, h, col[0]);
        rect(ctx, x, base - h, 3, 1, col[1]);
      } else {
        rect(ctx, x, base - h, 3, h, '#0d4552');
        if (i === peakI && this._peak > 0.04) rect(ctx, x, base - h, 3, 2, col[0]);
      }
    }
    // takeoff threshold while resting: a blinking caret under the bar you must reach
    if (sim.resting) {
      const ti = Math.min(n - 1, Math.ceil(this.cfg.rest.takeoffLevel * n));
      const blink = ((t * 3) | 0) % 2;
      const tx = mx + ti * 4 + 1;
      const th = 2 + Math.round((ti / (n - 1)) * (maxH - 2));
      rect(ctx, tx - 1, base - th - 4, 3, 1, blink ? '#ffffff' : '#ffd84a');
      rect(ctx, tx, base - th - 3, 1, 1, blink ? '#ffffff' : '#ffd84a');
    }
    // input icon: a music note for pitch control, otherwise a label
    if (hud.pitchIcon) {
      const c = hud.inputOk ? '#e4f2a0' : '#ff9a8a';
      rect(ctx, 5, base - 12, 7, 12, '#16363a');
      rect(ctx, 9, base - 11, 1, 8, c);
      rect(ctx, 10, base - 11, 2, 1, c);
      rect(ctx, 11, base - 10, 1, 2, c);
      rect(ctx, 6, base - 4, 4, 3, c);
    } else {
      drawText(ctx, hud.inputLabel, 4, base - 6, { color: hud.inputOk ? '#e4f2a0' : '#ff9a8a', outline: '#16363a' });
    }
    // speaking but not high enough: tell them
    if (hud.tooLow && ((t * 4) | 0) % 2 === 0) {
      drawText(ctx, 'HIGHER!', mx + 2, base - maxH - 10, { color: '#ffd84a', outline: '#16363a' });
      const ax = mx + 33, ay = base - maxH - 11;   // up arrow
      rect(ctx, ax - 1, ay - 1, 5, 8, '#16363a');
      rect(ctx, ax + 1, ay, 1, 1, '#ffd84a');
      rect(ctx, ax, ay + 1, 3, 1, '#ffd84a');
      rect(ctx, ax + 1, ay + 2, 1, 4, '#ffd84a');
    }
    if (sim.resting && hud.showScore) {
      drawText(ctx, 'SAFE', mx + n * 4 - 1, base - maxH - 10, { color: '#bdeee6', outline: '#16363a', align: 'right' });
    }
  }
}
