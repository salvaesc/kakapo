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
import { Haptics } from './core/haptics.js';
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
const haptics = new Haptics();
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
  calibGo: () => calibGo(),
  calibSkip: () => calibSkip(),
  nextMic,
  toggleRecord: () => { recorder.setEnabled(!recorder.enabled); refreshSettings(); },
  toggleVibrate: () => { haptics.setEnabled(!haptics.enabled); refreshSettings(); },
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
const refreshSettings = (micNote) => ui.setSettings(camera, recorder, sfx.muted, mic, micNote, haptics);
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

/** Settings → Microphone: switch to the next audio input (e.g. AirPods ↔ phone mic). */
async function nextMic() {
  const inputs = await Mic.listInputs();
  if (inputs.length < 2) { refreshSettings('Only one microphone available.'); return; }
  const cur = mic.stream && mic.stream.getAudioTracks()[0] && mic.stream.getAudioTracks()[0].getSettings().deviceId;
  const i = Math.max(0, inputs.findIndex((d) => d.deviceId === cur));
  const next = inputs[(i + 1) % inputs.length];
  await mic.useDevice(next.deviceId);
  game.sessionCalibrated = false; // a different mic needs a new calibration
  refreshSettings('Switched. Recalibrate your voice for this microphone.');
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

/**
 * Asks for the microphone (and the camera, when wanted) in ONE request: on iPhone,
 * asking for the camera after the mic can silently mute the mic. If the combined
 * request fails (e.g. the camera is refused), falls back to the microphone alone.
 */
async function requestMic() {
  ui.setMicStatus(game.input, mic);
  resumeAudio();
  let status = null;
  const md = navigator.mediaDevices;
  if (camera.wanted && camera.status !== 'on' && md && md.getUserMedia && window.isSecureContext !== false) {
    try {
      const both = await md.getUserMedia({ audio: mic.audioConstraints(), video: camera.videoConstraints() });
      status = await mic.start({ stream: new MediaStream(both.getAudioTracks()) });
      await camera.startWithStream(new MediaStream(both.getVideoTracks()));
    } catch {
      status = null; // try the microphone on its own below
    }
  }
  if (status !== 'on') {
    status = await mic.start();
    if (status === 'on' && camera.wanted && camera.status !== 'on') await camera.start();
  }
  refreshSettings();
  ui.setMicStatus(game.input, mic);
  if (status === 'on') {
    game.input = 'mic';
    startCalibration();
  } else {
    game.mode = 'micError';
    ui.showMicError(mic);
  }
}

// ---------------------------------------------------------------------------
// Guided voice calibration: intro → quiet → normal voice → squeak → try it.
// Voice steps only advance while the game actually hears you, and explain what
// to do (or what to check) when it doesn't.
// ---------------------------------------------------------------------------
const CAL = {
  quietSec: 2.5,      // silence step length
  normalSec: 2.0,     // seconds of heard "aaah" needed
  highSec: 1.8,       // seconds of heard squeak (high enough) needed
  higherBy: 3,        // the squeak must be at least this many semitones above the normal voice
  helpAfter: 4,       // seconds without hearing anything before showing troubleshooting
  trySec: 0.6,        // seconds above the take-off line to pass the test
  gotItSec: 0.9,      // the "✓ Got it" pause between steps
};
const STEP_NO = { intro: 0, quiet: 1, normal: 2, loud: 2, high: 3, try: 4, done: 5 };

/** Position of a pitch on the calibration bar (log scale, 80 Hz → 0, 1200 Hz → 1). */
const pitchMeter = (hz) => (hz > 0 ? Math.max(0, Math.min(1, Math.log2(hz / 80) / Math.log2(1200 / 80))) : null);
const hearingMeter = () => Math.max(0, Math.min(1, (mic.db - mic.cal.floorDb + 4) / 40));
const median = (a) => { const v = a.filter((x) => x > 0).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; };
const NO_HEAR_NOTE = 'Can’t hear you? Check the mic isn’t muted, hold the phone closer, or pick another microphone in Settings (AirPods mics are often weak — try the phone’s own mic).';

function startCalibration() {
  game.input = 'mic';
  game.mode = 'calibrating';
  // Volume mode: just 2 steps that start right away — silence, then a shout.
  // (Pitch mode keeps its longer flow: intro, normal voice, squeak, try it.)
  document.getElementById('cs2').textContent = mic.pitchMode ? 'Normal' : 'AAAH!';
  document.getElementById('cs3').classList.toggle('hidden', !mic.pitchMode);
  document.getElementById('cs4').classList.toggle('hidden', !mic.pitchMode);
  game.calib = { phase: mic.pitchMode ? 'intro' : 'quiet', t: 0, quiet: [], normal: [], high: [], loud: [], heard: 0, silent: 0, gotIt: 0, tryT: 0 };
  ui.show('calib');
  renderCalib(0);
}

function calibGo() {
  const c = game.calib;
  if (!c) return;
  resumeAudio();
  if (c.phase === 'intro') { setPhase('quiet'); return; }
  if (c.phase === 'try' || c.phase === 'done') { finishCalibration(); return; }
  if (mic.deadInput || !mic.on) { // "Retry": restart the microphone
    mic.stop();
    mic.start().then(() => { ui.setMicStatus(game.input, mic); setPhase(c.phase); });
  }
}

function calibSkip() {
  const c = game.calib;
  if (c && c.quiet.length) mic.applyPitchCalibration(c.quiet, c.normal, c.high);
  game.sessionCalibrated = true;
  game.calib = null;
  newRun();
  ui.hint('Using standard voice settings. You can tune it later in Settings.', 3.5);
}

function setPhase(p) {
  const c = game.calib;
  c.phase = p; c.t = 0; c.heard = 0; c.silent = 0; c.gotIt = 0; c.tryT = 0;
  if (p === 'normal') c.normal.length = 0;
  if (p === 'high') c.high.length = 0;
}

function finishCalibration() {
  game.sessionCalibrated = true;
  game.calib = null;
  newRun();
}

function updateCalibration(dt) {
  const c = game.calib;
  if (!c) return;
  mic.sample(dt);
  c.t += dt;
  const pitchMode = mic.pitchMode;
  if (c.gotIt > 0) { // short "✓ Got it" pause, then the next step
    c.gotIt -= dt;
    if (c.gotIt <= 0) {
      if (c.next === 'play') { finishCalibration(); return; }
      setPhase(c.next);
    }
    renderCalib(dt);
    return;
  }
  const done = (next) => { c.gotIt = CAL.gotItSec; c.next = next; };
  const heardVoice = mic.voiced && (!pitchMode || mic.pitchHz > 0);
  c.silent = heardVoice ? 0 : c.silent + dt;

  if (c.phase === 'quiet') {
    c.quiet.push(mic.db);
    if (c.t >= CAL.quietSec) {
      mic.applyCalibration(c.quiet, null); // noise gate first: it tells voice from room noise
      done(pitchMode ? 'normal' : 'loud');
    }
  } else if (c.phase === 'normal') {
    if (heardVoice) { c.heard += dt; c.normal.push(mic.pitchHz); }
    if (c.heard >= CAL.normalSec) done('high');
  } else if (c.phase === 'loud') {
    if (heardVoice) { c.heard += dt; c.loud.push(mic.db); }
    if (c.heard >= CAL.normalSec) {
      mic.applyCalibration(c.quiet, c.loud);
      done('play'); // that's it: straight into the game
    }
  } else if (c.phase === 'high') {
    const normalHz = median(c.normal);
    const target = normalHz * Math.pow(2, CAL.higherBy / 12);
    if (heardVoice && mic.pitchHz >= target) { c.heard += dt; c.high.push(mic.pitchHz); }
    if (c.heard >= CAL.highSec) {
      mic.applyPitchCalibration(c.quiet, c.normal, c.high);
      done('try');
    }
  } else if (c.phase === 'try') {
    c.tryT = mic.level >= CONFIG.rest.takeoffLevel ? c.tryT + dt : Math.max(0, c.tryT - dt * 0.5);
    if (c.tryT >= CAL.trySec && !c.passed) { c.passed = true; sfx.play('checkpoint'); }
  }
  renderCalib(dt);
}

function renderCalib() {
  const c = game.calib;
  if (!c) return;
  const ph = c.gotIt > 0 ? c.phase : c.phase;
  const step = STEP_NO[ph];
  const v = { step, showViz: true, showPitch: mic.pitchMode, hearing: hearingMeter(), pitchNow: pitchMeter(mic.pitchHz), skip: true };
  const hz = mic.pitchHz ? `${Math.round(mic.pitchHz)} Hz` : '';
  if (c.gotIt > 0) {
    Object.assign(v, { title: c.next === 'play' ? '✓ Got it! Let’s fly…' : '✓ Got it!', status: '', progress: 1 });
  } else if (ph === 'intro') {
    Object.assign(v, {
      title: 'Tune the game to your voice',
      text: mic.pitchMode
        ? '3 short steps (about 20 seconds): a moment of silence, an “aaah” in your normal voice, and your best high squeak. Then a quick test.'
        : '2 short steps (about 15 seconds): a moment of silence and a long, loud “AAAH”. Then a quick test.',
      status: mic.voiced ? 'I can hear you ✓' : 'Say something — the “Hearing” bar should move.',
      statusKind: mic.voiced ? 'good' : '',
      note: 'Hold the phone at chatting distance. With AirPods in, their microphone is used.',
      go: 'Start', progress: 0,
    });
  } else if (ph === 'quiet') {
    const left = Math.max(1, Math.ceil(CAL.quietSec - c.t));
    Object.assign(v, {
      title: mic.pitchMode ? 'Step 1 · Shhh…' : '1 of 2 · Shhh…',
      text: 'Stay quiet for a moment so the game learns your room’s noise.',
      status: `Listening to the room… ${left}`, progress: c.t / CAL.quietSec, showPitch: false,
      note: 'Background sounds below this level will never make the kakapo fly.',
    });
  } else if (ph === 'normal' || ph === 'loud') {
    const loud = ph === 'loud';
    Object.assign(v, {
      title: loud ? '2 of 2 · Shout “AAAAH!”' : 'Step 2 · Your normal voice',
      text: loud ? 'A long, loud “AAAAAH!” — like you’re cheering. Keep it going until the bar fills.' : 'Say a long “aaaaah” in your normal speaking voice — like at the doctor’s. Keep it going.',
      progress: c.heard / CAL.normalSec,
      showPitch: !loud,
      note: loud ? 'This shout is the kakapo’s full speed. Softer = slower; talking won’t lift him.' : 'This pitch will NOT make him fly — only higher ones will.',
    });
    if (mic.deadInput) Object.assign(v, { status: 'The microphone is giving no sound at all.', statusKind: 'bad', note: NO_HEAR_NOTE, go: 'Retry microphone' });
    else if (loud && mic.voiced) Object.assign(v, { status: 'I hear you ✓ — keep going…', statusKind: 'good' });
    else if (mic.voiced && mic.pitchHz) Object.assign(v, { status: `I hear you ✓ ${hz} — keep going…`, statusKind: 'good' });
    else if (mic.voiced) Object.assign(v, { status: 'I hear something — hold a steady “aaah”.', statusKind: 'warn' });
    else if (c.silent > CAL.helpAfter) Object.assign(v, { status: 'I can’t hear you…', statusKind: 'bad', note: NO_HEAR_NOTE });
    else Object.assign(v, { status: 'Waiting for your “aaah”…' });
  } else if (ph === 'high') {
    const normalHz = median(c.normal);
    const target = normalHz * Math.pow(2, CAL.higherBy / 12);
    Object.assign(v, {
      title: 'Step 3 · Squeak!',
      text: 'Now a high squeak — “iiiiii!” — as high as you can WITHOUT straining. Like a tiny bird.',
      progress: c.heard / CAL.highSec,
      pitchNormal: pitchMeter(normalHz), zoneFrom: pitchMeter(target), zoneTo: 1,
      note: `Your normal voice: ${Math.round(normalHz)} Hz. Get into the green zone (above ${Math.round(target)} Hz).`,
    });
    if (mic.deadInput) Object.assign(v, { status: 'The microphone is giving no sound at all.', statusKind: 'bad', note: NO_HEAR_NOTE, go: 'Retry microphone' });
    else if (mic.voiced && mic.pitchHz >= target) Object.assign(v, { status: `Yes! ✓ ${hz} — hold it…`, statusKind: 'good' });
    else if (mic.voiced && mic.pitchHz) Object.assign(v, { status: `Higher! ↑ (${hz})`, statusKind: 'warn' });
    else if (c.silent > CAL.helpAfter) Object.assign(v, { status: 'I can’t hear you…', statusKind: 'bad', note: NO_HEAR_NOTE });
    else Object.assign(v, { status: 'Waiting for your squeak…' });
  } else if (ph === 'try') {
    const lv = mic.level;
    const cal = mic.cal;
    Object.assign(v, {
      title: mic.pitchMode ? 'Step 4 · Try it' : 'Step 3 · Try it',
      text: c.passed ? '' : (mic.pitchMode ? 'Squeak to fill the bar past the line for a second. Go quiet and it drops.'
        : 'Say “aaah” to fill the bar for a second. Louder = higher and faster, softer = slower, silence = drop.'),
      hearing: lv, showPitch: mic.pitchMode,
      pitchNormal: mic.pitchMode ? pitchMeter(cal.speakHz) : null,
      zoneFrom: mic.pitchMode ? pitchMeter(cal.lowHz) : null, zoneTo: mic.pitchMode ? pitchMeter(cal.highHz) : null,
      progress: c.passed ? 1 : c.tryT / CAL.trySec,
      go: c.passed ? 'Play!' : 'Play', skip: false,
      note: mic.pitchMode ? `Flying starts at ${Math.round(cal.lowHz)} Hz, full speed at ${Math.round(cal.highHz)} Hz. You can redo this in Settings.` : 'You can redo this in Settings.',
    });
    if (c.passed) Object.assign(v, { status: 'Perfect! The kakapo would be flying. You’re ready.', statusKind: 'good' });
    else if (mic.tooLow > 0.2) Object.assign(v, { status: 'Higher! ↑ That’s your talking voice.', statusKind: 'warn' });
    else if (lv >= CONFIG.rest.takeoffLevel) Object.assign(v, { status: 'Flying! ✓ Hold it…', statusKind: 'good' });
    else Object.assign(v, { status: mic.pitchMode ? 'Squeak!' : 'Aaaah!' });
  }
  ui.calibView(v);
}

/**
 * Audio for the run video: YOUR VOICE (the microphone, boosted so the squeaks are the star)
 * mixed with the game's effects. If this browser can't mix, the raw mic track is used.
 */
let recordDest = null;
let micToRecord = null;
function recordingAudioTracks() {
  const ctx = getAudioContext();
  if (!ctx || !ctx.createMediaStreamDestination) {
    const t = mic.stream && mic.stream.getAudioTracks()[0];
    return t ? [t.clone()] : [];
  }
  if (!recordDest) recordDest = ctx.createMediaStreamDestination();
  sfx.recordTo(recordDest);
  if (mic.source && mic._recordedSource !== mic.source) {
    if (!micToRecord) {
      micToRecord = ctx.createGain();
      micToRecord.gain.value = CONFIG.recording.voiceGain;
      micToRecord.connect(recordDest);
    }
    mic.source.connect(micToRecord);
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
  // Keep recording for a few seconds after the death: the player's reaction is the best part.
  const runId = game.runId;
  const endAt = (game.deathAt || performance.now()) + CONFIG.recording.afterDeathSec * 1000;
  while (performance.now() < endAt) {
    if (game.mode !== 'results' || game.runId !== runId) return; // moved on: the next run takes over
    ui.setVideo('off'); // silently keep recording the reaction (no on-screen notice)
    await new Promise((r) => setTimeout(r, 200));
  }
  if (game.mode !== 'results' || game.runId !== runId) return;
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
    await navigator.share({ files: [file], title: 'KAKAPO', text: `I yelled my way to ${sim.score} points in KAKAPO!` });
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
  game.deathAt = 0;
  game.runId = (game.runId || 0) + 1;
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
  // the end card appears in the video a little after the death, once the reaction has started
  recorder.setEndCard({
    title: newBest ? 'NEW RECORD!' : ui.resultTitle(sim.bird.deathCause),
    score, metres: sim.metres, best: game.best, newBest,
  }, (game.deathAt || performance.now()) + CONFIG.recording.endCardAfterSec * 1000);
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
        haptics.buzz('land');
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
        haptics.buzz('checkpoint');
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
        haptics.buzz('bonk');
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
        haptics.buzz('hurt');
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
        haptics.buzz('falcon');
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
        haptics.buzz('dead');
        game.deathAt = performance.now();
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
