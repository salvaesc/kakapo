// KAKAPO — game loop and state management.
// Owns the single requestAnimationFrame loop and wires simulation, input,
// rendering, effects, sound and UI together.
import { CONFIG } from './config.js';
import { Sim } from './game/sim.js';
import { Renderer } from './render/renderer.js';
import { Effects } from './render/effects.js';
import { createPose, poseFor, drawKakapo } from './render/kakapo.js';
import { createBiome } from './biomes/index.js';
import { Mic } from './input/mic.js';
import { TouchControl } from './input/touch.js';
import { Sfx } from './audio/sfx.js';
import { resumeAudio } from './audio/audioContext.js';
import { UI } from './ui/ui.js';
import { load, save } from './core/storage.js';
import { frameHooks } from './capture/capture.js';
import { Camera } from './capture/camera.js';
import { Recorder } from './capture/recorder.js';
import { getAudioContext } from './audio/audioContext.js';

const TEST = new URLSearchParams(location.search).has('test');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const stage = document.getElementById('stage');
const biome = createBiome('forest');
const renderer = new Renderer(canvas, CONFIG, biome);
const sim = new Sim(CONFIG);
const fx = new Effects();
const sfx = new Sfx(CONFIG);
const mic = new Mic(CONFIG);
const touch = new TouchControl(CONFIG, stage);
const camera = new Camera(CONFIG);
renderer.camera = camera;
const recorder = new Recorder(CONFIG);
frameHooks.push((display) => recorder.frame(display));

/**
 * Game states:
 *  menu → permission → calibrating → ready ⇄ playing (resting is a sub-state of the sim)
 *  playing → dying → results → ready (restart)
 *  any in-game state → paused; mic failures → micError
 */
const game = {
  mode: 'menu',
  input: 'mic',        // 'mic' | 'touch'
  best: load('best', 0),
  level: 0,
  testLevel: null,     // automated tests can drive the input
  dyingT: 0,
  firstFlightT: -1,
  calib: null,
  hintsShown: {},      // each damage tip is shown once per session
  sessionCalibrated: false,
  time: 0,
};

const ui = new UI({
  play: onPlay,
  playTouch: () => {
    game.input = 'touch';
    ui.setMicStatus(game.input, mic);
    startCameraIfWanted();
    newRun();
  },
  allowMic: requestMic,
  recalibrate: () => (mic.on ? startCalibration() : (game.mode = 'permission', ui.show('permission'))),
  settings: openSettings,
  toggleRecord: () => { recorder.setEnabled(!recorder.enabled); refreshSettings(); },
  shareVideo,
  saveVideo,
  toMenu: toMenu,
  pause: pauseGame,
  resume: resumeGame,
  again: newRun,
  toggleMute: () => { sfx.setMuted(!sfx.muted); ui.setMuted(sfx.muted); refreshSettings(); },
  toggleCamera,
});
ui.setMuted(sfx.muted);
ui.setBest(game.best);
ui.setMicStatus(game.input, mic);
const refreshSettings = () => ui.setSettings(camera, recorder, sfx.muted);
camera.onStatus = refreshSettings;
mic.onStatus = () => {
  ui.setMicStatus(game.input, mic);
  if (game.mode === 'playing' || game.mode === 'ready' || game.mode === 'calibrating') {
    game.mode = 'micError';
    ui.showMicError(mic);
  }
};

sim.reset(1);

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
/** The game is made to be played with the camera on; Settings can turn it off. */
function startCameraIfWanted() {
  if (camera.wanted && camera.status !== 'on' && camera.status !== 'requesting') {
    camera.start().then((st) => {
      refreshSettings();
      if (st !== 'on' && (game.mode === 'ready' || game.mode === 'playing')) {
        ui.hint(st === 'denied' ? 'Camera blocked — playing with the normal sky. You can allow it later.' : 'No camera — playing with the normal sky.', 3.5);
      }
    });
  }
}

async function toggleCamera() {
  if (camera.wanted) {
    camera.stop();
    camera.setWanted(false);
  } else {
    camera.setWanted(true);
    refreshSettings();
    await camera.start();
  }
  refreshSettings();
}

function openSettings() {
  game.mode = 'settings';
  refreshSettings();
  ui.show('settings');
}

function onPlay() {
  resumeAudio();
  if (mic.on) {
    game.input = 'mic';
    startCameraIfWanted();
    if (game.sessionCalibrated) newRun(); else startCalibration();
    return;
  }
  game.mode = 'permission';
  ui.show('permission');
}

async function requestMic() {
  ui.setMicStatus(game.input, mic);
  const status = await mic.start();
  ui.setMicStatus(game.input, mic);
  // camera right after the microphone (two prompts; a "no" to the camera still lets you play)
  if (camera.wanted && camera.status !== 'on') { await camera.start(); refreshSettings(); }
  if (status === 'on') {
    game.input = 'mic';
    startCalibration();
  } else {
    game.mode = 'micError';
    ui.showMicError(mic);
  }
}

function startCalibration() {
  game.input = 'mic';
  game.mode = 'calibrating';
  game.calib = { phase: 'quiet', t: 0, quiet: [], loud: [], normal: [], high: [] };
  ui.calib('quiet', 0, 0, 'This sets the noise floor so background sounds don’t make him fly.');
  ui.show('calib');
}

/** Position of a pitch on the calibration meter (log scale, 80 Hz → 0, 1200 Hz → 1). */
const pitchMeter = (hz) => (hz > 0 ? Math.max(0, Math.min(1, Math.log2(hz / 80) / Math.log2(1200 / 80))) : 0);

function updateCalibration(dt) {
  const c = game.calib;
  const M = CONFIG.mic;
  mic.sample(dt);
  c.t += dt;
  const pitch = mic.pitchMode;
  const total = M.calibQuietSec + (pitch ? M.calibNormalSec + M.calibHighSec : M.calibLoudSec);
  const progress = c.t / total;
  if (c.phase === 'quiet') {
    c.quiet.push(mic.db);
    ui.calib('quiet', progress, Math.max(0, (mic.db + 80) / 80));
    if (c.t >= M.calibQuietSec) {
      c.floorGuess = Math.max(...c.quiet.slice(-20));
      if (pitch) {
        // the noise gate is needed right away to tell voice from room noise
        mic.applyCalibration(c.quiet, null);
        c.phase = 'normal';
      } else {
        c.phase = 'loud';
      }
    }
  } else if (c.phase === 'normal') {
    c.normal.push(mic.pitchHz);
    ui.calib('normal', progress, pitchMeter(mic.pitchHz), mic.pitchHz ? `${Math.round(mic.pitchHz)} Hz` : ' ');
    if (c.t >= M.calibQuietSec + M.calibNormalSec) c.phase = 'high';
  } else if (c.phase === 'high') {
    c.high.push(mic.pitchHz);
    ui.calib('high', progress, pitchMeter(mic.pitchHz), mic.pitchHz ? `${Math.round(mic.pitchHz)} Hz` : ' ');
    if (c.t >= total) {
      const cal = mic.applyPitchCalibration(c.quiet, c.normal, c.high);
      game.sessionCalibrated = true;
      c.phase = 'done';
      newRun();
      if (!cal.pitchOk) ui.hint('Didn’t catch your voice well — using standard pitches. You can recalibrate from the menu.', 4);
    }
  } else if (c.phase === 'loud') {
    c.loud.push(mic.db);
    const lvl = Math.max(0, (mic.db - c.floorGuess) / 30);
    ui.calib('loud', progress, lvl);
    if (c.t >= total) {
      const cal = mic.applyCalibration(c.quiet, c.loud);
      game.sessionCalibrated = true;
      c.phase = 'done';
      newRun();
      if (!cal.loudOk) ui.hint('Didn’t hear much — using normal sensitivity. You can recalibrate from the menu.', 4);
    }
  }
}

/** Audio for the run video: the microphone (your squeaks) mixed with the game's effects. */
let recordDest = null;
function recordingAudioTracks() {
  const ctx = getAudioContext();
  if (!ctx || !ctx.createMediaStreamDestination) return [];
  if (!recordDest) recordDest = ctx.createMediaStreamDestination();
  sfx.recordTo(recordDest);
  if (mic.source && mic._recordedSource !== mic.source) {
    mic.source.connect(recordDest);
    mic._recordedSource = mic.source;
  }
  return recordDest.stream.getAudioTracks();
}

function startRecording() {
  if (!recorder.enabled || !recorder.supported) { recorder.discard(); return; }
  recorder.start(renderer.display, recordingAudioTracks());
}

async function finishRecording(score) {
  if (recorder.state !== 'recording' && recorder.state !== 'paused') { ui.setVideo('off'); return; }
  ui.setVideo('preparing');
  const blob = await recorder.stop();
  if (game.mode !== 'results') return; // the player already moved on
  if (!blob) { ui.setVideo('failed'); return; }
  const file = recorder.file(score);
  const canShare = !!(navigator.canShare && file && navigator.canShare({ files: [file] }));
  game.videoFile = file;
  ui.setVideo('ready', recorder.url, canShare);
}

async function shareVideo() {
  const file = game.videoFile;
  if (!file) return;
  try {
    await navigator.share({ files: [file], title: 'KAKAPO', text: `I squeaked my way to ${sim.score} points in KAKAPO!` });
  } catch (e) {
    if (e && e.name !== 'AbortError') saveVideo();
  }
}

async function saveVideo() {
  if (!recorder.url || !game.videoFile) return;
  // Inside a Claude page, files are offered through the viewer's own save dialog.
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename: game.videoFile.name, data: game.videoFile }); return; }
    } catch (e) {
      if (e && e.code === 'declined') return;
    }
  }
  const a = document.createElement('a');
  a.href = recorder.url;
  a.download = game.videoFile.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function newRun() {
  resumeAudio();
  sim.reset((Math.random() * 1e9) | 0);
  fx.reset();
  touch.reset();
  game.mode = 'ready';
  game.dyingT = 0;
  game.firstFlightT = -1;
  game.videoFile = null;
  ui.setVideo('off');
  ui.show('game');
  startRecording();
  ui.hint(game.input === 'mic' ? TAKEOFF_HINT() : 'Press & hold to fly!');
}

function toMenu() {
  if (game.mode !== 'settings') recorder.discard();
  game.videoFile = null;
  game.mode = 'menu';
  sim.reset(1);
  fx.reset();
  ui.setBest(game.best);
  ui.setMicStatus(game.input, mic);
  ui.show('menu');
}

function pauseGame() {
  if (game.mode !== 'playing' && game.mode !== 'ready') return;
  game.pausedFrom = game.mode;
  game.mode = 'paused';
  recorder.pause();
  ui.show('pause');
}

function resumeGame() {
  resumeAudio();
  touch.reset();
  game.mode = game.pausedFrom || 'playing';
  recorder.resume();
  ui.show('game');
  if (game.mode === 'ready') ui.hint(game.input === 'mic' ? TAKEOFF_HINT() : 'Press & hold to fly!');
}

function endRun() {
  const score = sim.score;
  const newBest = score > game.best;
  if (newBest) { game.best = score; save('best', score); }
  game.mode = 'results';
  ui.showResults({
    score, metres: sim.metres, landings: sim.bird.landings, berries: sim.berries, best: game.best, newBest,
    cause: sim.bird.deathCause,
  });
  finishRecording(score);
}

// ---------------------------------------------------------------------------
// Simulation events → feedback
// ---------------------------------------------------------------------------
const DUST = ['#c9a37a', '#8e5b3a', '#e8d6a8'];
const LEAVES = ['#57a53d', '#9fd04a', '#2d7334'];
const WATER = ['#ffffff', '#c4faf3', '#46d3d6'];
const SPARK = ['#ffd84a', '#fff6c2', '#ffffff'];
const PETALS = ['#e8404a', '#ff7a5c', '#ffd34a'];
const FIRE = ['#ff8a2a', '#ffd04a', '#e8402a'];
const HURT_WORDS = { fall: 'SPLAT!', ceiling: 'BONK!', underside: 'OUCH!', fire: 'HOT!', falcon: 'CLAW!' };
const HAZARD_HINTS = {
  shark: 'Shark! When you see the fin, wait for the jump.',
  wave: 'Giant wave! Rest and cross when the river calms.',
  eel: 'Eel! Bubbles mean it’s about to jump. Wait, then cross.',
  spout: 'Waterspout! Wait on the island until it fades.',
  fire: 'Burning island ahead: fly over it, don’t land!',
  drop: 'Low canopy ahead: fly under it.',
};
const TAKEOFF_HINT = () => (mic.pitchMode ? 'Squeak HIGH to take off! “iiiiii!”' : 'Make a sound to take off!');
const HURT_HINTS = {
  ceiling: 'Ouch! The canopy costs a heart.',
  fire: 'Hot! Burning islands aren’t for resting.',
  falcon: 'The falcon got you! Change height when its ! turns red.',
  underside: 'Don’t hit islands from below!',
  fall: 'Too high! Make a little noise to brake before landing.',
};

function handleEvents() {
  for (let i = 0; i < sim.eventCount; i++) {
    const e = sim.events[i];
    switch (e.type) {
      case 'takeoff':
        fx.burst(e.x, e.y, 8, DUST, 40, 10, 120, 0.5);
        fx.burst(e.x, e.y - 6, 3, LEAVES, 30, 20, 40, 1.2);
        sfx.play('takeoff');
        if (game.mode === 'ready') {
          game.mode = 'playing';
          game.firstFlightT = 0;
          ui.hint(null);
        }
        break;
      case 'land':
        fx.burst(e.x, e.y, 10, DUST, 46, 8, 160, 0.45);
        fx.addShake(e.a > 0 ? 2 : 1);
        if (e.a > 0) fx.popup(e.x, e.y - 26, '+' + e.a, '#e4f2a0');
        sfx.play('land');
        if (sim.bird.landings === 1 && sim.bird.state === 'rest') ui.hint('Safe! Rest as long as you like.', 2.6);
        break;
      case 'perfect':
        fx.burst(e.x, e.y - 8, 8, SPARK, 50, 20, 60, 0.6);
        fx.popup(e.x, e.y - 34, 'PERFECT', '#ffd84a');
        sfx.play('perfect');
        break;
      case 'checkpoint':
        fx.burst(e.x, e.y - 10, 18, PETALS, 60, 40, 50, 1.4, 2);
        fx.showBanner('POHUTUKAWA!', '#ff7a5c', 1.4);
        sfx.play('checkpoint');
        break;
      case 'berry':
        fx.burst(e.x, e.y, 6, ['#e2364a', '#ffd0d4', '#ffd84a'], 40, 0, 40, 0.4);
        fx.popup(e.x, e.y - 8, '+' + e.a, '#ffd0d4');
        sfx.play('berry');
        break;
      case 'bonk': {
        fx.addShake(4);
        fx.flash = 0.6;
        for (let k = 0; k < 4; k++) fx.spawn(e.x, e.y, (Math.random() - 0.5) * 30, -20 - Math.random() * 20, 30, 1.4, LEAVES[k % 3], 2, 1);
        sfx.play('bonk');
        break;
      }
      case 'splash':
        fx.burst(e.x, e.y, 22, WATER, 70, 60, 260, 0.9, 2);
        for (let k = 0; k < 5; k++) fx.spawn(e.x, e.y - 4, (Math.random() - 0.5) * 40, -40 - Math.random() * 30, 40, 1.8, LEAVES[k % 3], 2, 1);
        fx.addShake(5);
        sfx.play('splash');
        break;
      case 'hurt': {
        const cause = sim.bird.hurtCause;
        fx.addShake(6);
        fx.flash = 1;
        fx.popup(e.x, e.y - 18, HURT_WORDS[cause] || 'OUCH!', '#ff9aa8');
        for (let k = 0; k < 6; k++) fx.spawn(e.x, e.y, (Math.random() - 0.5) * 50, -30 - Math.random() * 30, 40, 1.6, LEAVES[k % 3], 2, 1);
        if (cause === 'fall') fx.burst(e.x, e.y, 14, DUST, 60, 10, 160, 0.5);
        sfx.play(e.a > 0 ? 'hurt' : 'ko');
        if (e.a > 0 && !game.hintsShown[cause]) {
          game.hintsShown[cause] = true;
          ui.hint(HURT_HINTS[cause], 3);
        }
        break;
      }
      case 'burn':
        fx.burst(e.x, e.y, 12, FIRE, 50, 40, 60, 0.6);
        sfx.play('burn');
        break;
      case 'chomp':
        fx.popup(e.x, e.y - 14, 'CHOMP!', '#ffffff');
        fx.addShake(6);
        sfx.play('chomp');
        break;
      case 'snap':
        fx.popup(e.x, e.y - 10, 'SNAP!', '#ffffff');
        fx.burst(e.x, e.y, 10, WATER, 60, 40, 200, 0.7);
        fx.addShake(6);
        sfx.play('chomp');
        break;
      case 'falconWarn':
        sfx.play('screech');
        if (!game.hintsShown.falcon) {
          game.hintsShown.falcon = true;
          ui.hint('Falcon! When the ! turns red, change height. Perched kakapo are invisible to it.', 4);
        }
        break;
      case 'falconDive':
        sfx.play('whoosh');
        break;
      case 'falconHit':
        for (let k = 0; k < 8; k++) fx.spawn(e.x, e.y, (Math.random() - 0.5) * 70, -20 - Math.random() * 40, 50, 1.6, LEAVES[k % 3], 2, 1);
        break;
      case 'falconGone':
        fx.popup(e.x, e.y - 22, 'FROZEN!', '#bdeee6');
        break;
      case 'sucked':
        fx.popup(e.x, e.y - 14, 'WHOOSH!', '#e9fbfd');
        fx.burst(e.x, e.y, 14, WATER, 70, 30, 40, 0.8);
        sfx.play('whoosh');
        break;
      case 'thud':
        fx.burst(e.x, e.y, 12, DUST, 50, 10, 160, 0.5);
        fx.addShake(4);
        sfx.play('land');
        break;
      case 'dead':
        ui.hint(null);
        if (game.mode === 'playing' || game.mode === 'ready') {
          game.mode = 'dying';
          game.dyingT = 0;
        }
        break;
      case 'milestone':
        fx.showBanner(`${e.a} M!`, '#ffd84a', 1.4);
        fx.burst(e.x, e.y, 10, SPARK, 50, 10, 30, 0.8);
        sfx.play('milestone');
        break;
      default: break;
    }
  }
  sim.clearEvents();
}

/** The first time each kind of danger scrolls into view, explain it once (per session). */
function checkHazardHints() {
  const camX = sim.bird.x - renderer.birdScreenX;
  const right = camX + renderer.W - 10;
  const w = sim.world;
  const show = (key) => {
    if (game.hintsShown[key]) return false;
    game.hintsShown[key] = true;
    ui.hint(HAZARD_HINTS[key], 3.2);
    return true;
  };
  for (const hz of w.hazards) if (hz.x0 < right && hz.x1 > camX && show(hz.type)) return;
  for (const p of w.platforms) if (p.fire && p.x < right && p.x + p.w > camX && show('fire')) return;
  for (const c of w.ceilings) if (c.kind === 'drop' && c.x < right && c.x + c.w > camX && show('drop')) return;
}

// ---------------------------------------------------------------------------
// Menu hero animation
// ---------------------------------------------------------------------------
const hero = document.getElementById('heroCanvas');
const heroCtx = hero.getContext('2d');
heroCtx.imageSmoothingEnabled = false;
const heroPose = createPose();
const heroBird = { state: 'rest', victoryT: 0, landT: 9, holdT: 0, restT: 0, intensity: 0, flapPhase: 0, takeoffT: 9, stun: 0, vy: 0, flyT: 0, deadT: 0 };
function drawHero(t) {
  const cycle = t % 6;
  heroBird.state = cycle < 3.2 ? 'rest' : 'fly';
  heroBird.victoryT = cycle > 2 && cycle < 3.2 ? 3.2 - cycle : 0;
  heroBird.intensity = cycle > 4.6 ? 0.9 : 0.45;
  heroBird.flapPhase = t * (heroBird.intensity > 0.6 ? 8 : 4);
  heroBird.takeoffT = cycle - 3.2;
  heroCtx.clearRect(0, 0, hero.width, hero.height);
  const bob = heroBird.state === 'fly' ? Math.round(Math.sin(t * 3) * 2) - 3 : 0;
  poseFor(heroPose, heroBird, t);
  drawKakapo(heroCtx, 20, 18 + bob, heroPose);
}

// ---------------------------------------------------------------------------
// Main loop (exactly one at a time)
// ---------------------------------------------------------------------------
let rafId = 0;
let last = 0;

function readInput(dt) {
  if (game.testLevel != null) return game.testLevel;
  let m = game.input === 'mic' ? mic.sample(dt) : 0;
  // While one of our own sound effects plays, hold the previous mic value: the speaker
  // must never fly the kakapo (the falcon's screech is high-pitched, for example).
  if (game.input === 'mic' && sfx.blocking) m = Math.min(m, game.heldMic || 0);
  else game.heldMic = m;
  const tch = touch.sample(dt);
  return Math.max(m, tch); // touch also works as a backup while the mic is active
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  game.time += dt;
  const t = game.time;

  switch (game.mode) {
    case 'calibrating':
      updateCalibration(dt);
      game.level = mic.level;
      break;
    case 'ready':
    case 'playing': {
      game.level = readInput(dt);
      sim.update(dt, game.level, !sfx.blocking);
      handleEvents();
      checkHazardHints();
      if (game.firstFlightT >= 0) {
        game.firstFlightT += dt;
        if (game.firstFlightT > 1.2 && game.firstFlightT < 1.3 && sim.bird.landings === 0) {
          ui.hint(game.input === 'mic' ? (mic.pitchMode ? 'Higher squeak = higher & faster. Go quiet to drop onto an island!' : 'Louder = higher & faster. Go quiet to drop onto an island!') : 'Release to drop onto an island!', 3.5);
        }
      }
      break;
    }
    case 'dying':
      game.level = readInput(dt);
      sim.update(dt, 0, false);
      handleEvents();
      game.dyingT += dt;
      // drowning gets a little longer so the sinking and bubbles can be seen
      if (game.dyingT > 0.7 && game.dyingT - dt <= 0.7 && !sim.bird.deadOnGround) sfx.play('blub');
      if (game.dyingT > (sim.bird.deadOnGround ? 1.7 : 2.6)) endRun();
      break;
    case 'results':
    case 'menu':
      game.level = game.input === 'mic' && mic.on ? mic.sample(dt) : 0;
      sim.update(dt, 0, false);
      sim.clearEvents();
      break;
    default:
      break; // paused, permission, micError: frozen
  }

  if (game.mode !== 'paused') fx.update(dt);

  const inGame = game.mode === 'ready' || game.mode === 'playing' || game.mode === 'dying' || game.mode === 'paused';
  renderer.render(sim, t, fx, {
    showScore: inGame || game.mode === 'results',
    hideBird: game.mode === 'menu' || game.mode === 'permission' || game.mode === 'micError',
    showMeter: inGame || game.mode === 'calibrating',
    level: game.level,
    best: game.best,
    inputLabel: game.input === 'mic' ? (mic.on ? 'MIC' : 'OFF') : 'TAP',
    pitchIcon: game.input === 'mic' && mic.pitchMode,
    inputOk: game.input !== 'mic' || mic.on,
    tooLow: game.input === 'mic' && mic.pitchMode && mic.tooLow > 0.25,
  });
  for (let i = 0; i < frameHooks.length; i++) frameHooks[i](renderer.display, t);
  if (game.mode === 'menu') drawHero(t);
}

function startLoop() {
  if (rafId) return;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

// ---------------------------------------------------------------------------
// Layout, visibility, lifecycle
// ---------------------------------------------------------------------------
function layout() {
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  const h = vv ? vv.height : window.innerHeight;
  renderer.resize(w, h, window.devicePixelRatio || 1);
  stage.style.width = renderer.cssWidth + 'px';
  stage.style.height = renderer.cssHeight + 'px';
}

let layoutPending = false;
function scheduleLayout() {
  if (layoutPending) return;
  layoutPending = true;
  requestAnimationFrame(() => { layoutPending = false; layout(); });
}
window.addEventListener('resize', scheduleLayout);
window.addEventListener('orientationchange', scheduleLayout);
if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleLayout);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseGame();
    touch.reset();
    stopLoop();
  } else {
    startLoop();
  }
});
window.addEventListener('pagehide', () => { recorder.discard(); mic.stop(); camera.stop(); });
// Prevent pinch/double-tap zoom and long-press menus during play.
document.addEventListener('gesturestart', (e) => e.preventDefault());
stage.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

layout();
ui.show('menu');
startLoop();

if (TEST) {
  // Hooks for automated browser tests only (enabled with ?test).
  window.__kakapo = {
    sim, game, mic, renderer, CONFIG, camera, recorder,
    setLevel(v) { game.testLevel = v; },
    start(input = 'touch') { game.input = input; newRun(); },
    loops: () => (rafId ? 1 : 0),
  };
}
