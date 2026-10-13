// DOM menus and overlays. Holds no game logic: it shows screens and forwards
// button presses to the handlers main.js provides.
import { drawText } from '../render/pixelfont.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['menu', 'permission', 'calib', 'micError', 'pause', 'results', 'settings'];

const MUTE_ON_SVG = '<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="1" y="3" width="2" height="2"/><rect x="3" y="2" width="1" height="4"/><rect x="4" y="1" width="1" height="6"/><rect x="6" y="2" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/><rect x="7" y="3" width="1" height="2"/></svg>';
const MUTE_OFF_SVG = '<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="1" y="3" width="2" height="2"/><rect x="3" y="2" width="1" height="4"/><rect x="4" y="1" width="1" height="6"/><rect x="5" y="2" width="1" height="1"/><rect x="7" y="2" width="1" height="1"/><rect x="6" y="3" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/></svg>';

const QUIPS = {
  water: [
    'He’s fine. Just a little damp.',
    'Splash! The river says hi.',
    'Short flight. Long bath.',
    'Kakapo are flightless. You nearly proved otherwise.',
  ],
  ceiling: [
    'Three bonks on the canopy. The canopy won.',
    'Aim for the islands, not the treetops.',
    'Big voice, tiny wings, sore head.',
  ],
  underside: [
    'Islands are for landing on. From above.',
    'He tried to go through. Islands disagree.',
  ],
  shark: [
    'Sharks love a snack that announces itself.',
    'The fin was the warning. The chomp was the punchline.',
  ],
  wave: [
    'Surf’s up. Kakapo’s down.',
    'Wait for the river to calm down next time.',
  ],
  spout: [
    'Whoosh! He’s gone to see the clouds. Briefly.',
    'Waterspouts come and go. Wait for the “go”.',
  ],
  eel: [
    'The eel was hungrier than he was.',
    'Bubbles in the river? Wait for the snap.',
  ],
  falcon: [
    'Kārearea: 1. Kākāpō: 0.',
    'Real kākāpō freeze when a falcon hunts. Try resting next time.',
  ],
  fire: [
    'Lightly toasted kakapo.',
    'Burning islands are for flying over, not landing on.',
  ],
  fall: [
    'Gravity: 1. Kakapo: 0.',
    'Next time, brake with a little “mmm” before landing.',
    'He’ll walk it off. Eventually.',
  ],
};
const TITLES = {
  water: 'SPLASH!', ceiling: 'BONK!', underside: 'OUCH!', fall: 'SPLAT!',
  shark: 'CHOMP!', wave: 'WIPEOUT!', spout: 'WHOOSH!', fire: 'TOASTED!', eel: 'SNAP!', falcon: 'SNATCHED!',
};

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.current = 'menu';
    this._hintTimer = 0;
    const bind = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); fn(); });
    bind('btnPlay', () => this.h.play());
    bind('btnTouchMode', () => this.h.playTouch());
    bind('btnRecalibrate', () => this.h.recalibrate());
    bind('btnAllowMic', () => this.h.allowMic());
    bind('btnPermTouch', () => this.h.playTouch());
    bind('btnPermBack', () => this.h.toMenu());
    bind('btnRetryMic', () => this.h.allowMic());
    bind('btnErrTouch', () => this.h.playTouch());
    bind('btnErrBack', () => this.h.toMenu());
    bind('btnPause', () => this.h.pause());
    bind('btnResume', () => this.h.resume());
    bind('btnPauseMenu', () => this.h.toMenu());
    bind('btnAgain', () => this.h.again());
    bind('btnResMenu', () => this.h.toMenu());
    for (const id of ['btnMuteHud']) bind(id, () => this.h.toggleMute());
    bind('btnSettings', () => this.h.settings());
    bind('btnCalibGo', () => this.h.calibGo());
    bind('btnCalibSkip', () => this.h.calibSkip());
    bind('btnSetMic', () => this.h.nextMic());
    bind('btnSetCamera', () => this.h.toggleCamera());
    bind('btnSetRecord', () => this.h.toggleRecord());
    bind('btnSetVibrate', () => this.h.toggleVibrate());
    bind('btnSetSound', () => this.h.toggleMute());
    bind('btnSetBack', () => this.h.toMenu());
    bind('btnShare', () => this.h.shareVideo());
    bind('btnSave', () => this.h.saveVideo());
    this._drawTitle();
  }

  show(name) {
    this.current = name;
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', !(name === 'game'));
    if (name !== 'game') this.hint(null);
    // Move focus to the main button of the new screen for keyboard users.
    const primary = name !== 'game' && document.querySelector(`#${name} .btn-primary`);
    if (primary) primary.focus({ preventScroll: true });
  }

  _drawTitle() {
    const c = $('titleCanvas');
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    drawText(ctx, 'KAKAPO', c.width / 2 + 1, 3, { scale: 2, color: '#16363a', align: 'center' });
    drawText(ctx, 'KAKAPO', c.width / 2, 2, { scale: 2, color: '#c6f06a', align: 'center' });
  }

  setMuted(m) {
    for (const id of ['btnMuteHud']) {
      const b = $(id);
      b.innerHTML = m ? MUTE_OFF_SVG : MUTE_ON_SVG;
      b.setAttribute('aria-label', m ? 'Unmute sound effects' : 'Mute sound effects');
      b.setAttribute('aria-pressed', String(m));
    }
  }

  setMicStatus(mode, mic) {
    const chip = $('micChip');
    let text = 'Mic: not enabled yet';
    let cls = '';
    if (mode === 'touch' && !mic.on) { text = 'Touch mode'; }
    if (mic.status === 'requesting') text = 'Mic: waiting for permission…';
    else if (mic.on) { text = 'Mic: on'; cls = 'ok'; }
    else if (mic.status === 'denied') { text = 'Mic: blocked'; cls = 'bad'; }
    else if (mic.status === 'unavailable' || mic.status === 'insecure' || mic.status === 'error') { text = 'Mic: unavailable'; cls = 'bad'; }
    else if (mic.status === 'lost') { text = 'Mic: disconnected'; cls = 'bad'; }
    chip.textContent = text;
    chip.className = 'chip ' + cls;
    $('btnPlay').textContent = 'Play';
  }

  /** Settings screen state. */
  setSettings(cam, recorder, muted, mic, micNote, haptics) {
    if (mic) {
      const label = mic.on ? (mic.deviceLabel || 'default') : 'not on yet';
      $('btnSetMic').textContent = `Microphone: ${label.length > 26 ? label.slice(0, 25) + '…' : label}`;
      $('btnSetMic').disabled = !mic.on;
      $('micNote').textContent = micNote || (mic.on ? 'Tap to switch (e.g. AirPods ↔ phone mic).' : 'Start a game to choose a microphone.');
    }
    const camOn = cam.wanted;
    const cb = $('btnSetCamera');
    cb.textContent = `Camera background: ${camOn ? 'ON' : 'OFF'}`;
    cb.setAttribute('aria-pressed', String(camOn));
    const note = {
      requesting: 'Waiting for camera permission…',
      denied: 'The camera is blocked for this site. Allow it in the browser settings.',
      unavailable: 'No camera found on this device.',
      insecure: 'The camera needs https (or localhost).',
      error: cam.error,
    }[cam.status];
    $('camNote').textContent = note || (camOn ? 'Your face is the sky. Only shown on this screen.' : 'The normal sky is shown instead.');
    const rb = $('btnSetRecord');
    rb.textContent = recorder.supported ? `Save a video of each run: ${recorder.enabled ? 'ON' : 'OFF'}` : 'Video: not supported in this browser';
    rb.disabled = !recorder.supported;
    rb.setAttribute('aria-pressed', String(recorder.supported && recorder.enabled));
    const sb = $('btnSetSound');
    sb.textContent = `Sound effects: ${muted ? 'OFF' : 'ON'}`;
    sb.setAttribute('aria-pressed', String(!muted));
    const vb = $('btnSetVibrate');
    vb.classList.toggle('hidden', !(haptics && haptics.supported)); // iPhone Safari can't vibrate
    if (haptics) {
      vb.textContent = `Vibration: ${haptics.enabled ? 'ON' : 'OFF'}`;
      vb.setAttribute('aria-pressed', String(haptics.enabled));
    }
  }

  /** Results: the run's video. state: 'off' | 'preparing' | 'ready' | 'failed'. */
  setVideo(state, url = '', canShare = false, secondsLeft = 0) {
    const box = $('resVideoBox');
    box.classList.toggle('hidden', state === 'off');
    const v = $('resVideo');
    const note = $('resVideoNote');
    $('btnShare').classList.toggle('hidden', !(state === 'ready' && canShare));
    $('btnSave').classList.toggle('hidden', state !== 'ready');
    if (state === 'ready') {
      if (v.src !== url) { v.src = url; v.play().catch(() => {}); }
      v.classList.remove('hidden');
      note.textContent = canShare ? 'Your run — share the embarrassment!' : 'Your run — save it and share it anywhere.';
    } else {
      v.removeAttribute('src');
      v.load();
      v.classList.add('hidden');
      note.textContent = state === 'reaction' ? `● REC — still recording your reaction… ${secondsLeft}`
        : state === 'preparing' ? 'Preparing your video…' : state === 'failed' ? 'The video could not be saved this time.' : '';
      note.classList.toggle('rec', state === 'reaction');
    }
  }

  setBest(best) {
    $('menuBest').textContent = best > 0 ? `Best: ${best}` : '';
  }

  showMicError(mic) {
    $('micErrorText').textContent = mic.error || 'The microphone is not available.';
    let help = 'You can still play with touch: press and hold to fly, release to fall.';
    if (mic.status === 'denied') {
      help = window.top !== window.self
        ? 'This page is embedded and the microphone is blocked here. To play with your voice, open KAKAPO on its own https site. ' + help
        : 'To use your voice, allow the microphone for this site in your browser settings, then tap “Try again”. ' + help;
    }
    if (mic.status === 'insecure') help = 'Open the game over https:// (or localhost). ' + help;
    $('micErrorHelp').textContent = help;
    $('btnRetryMic').classList.toggle('hidden', mic.status === 'unavailable' || mic.status === 'insecure');
    this.show('micError');
  }

  /**
   * Guided calibration screen.
   * v: { step: 0..4 (0 = intro), title, text, status, statusKind, note, progress 0..1,
   *      hearing 0..1, pitchNow, pitchNormal, zoneFrom, zoneTo (all 0..1 or null),
   *      showViz, go (button label or null), skip (bool) }
   */
  calibView(v) {
    for (let i = 1; i <= 4; i++) {
      const li = $('cs' + i);
      li.classList.toggle('active', v.step === i);
      li.classList.toggle('done', v.step > i);
    }
    $('calibTitle').textContent = v.title;
    $('calibText').textContent = v.text || '';
    const st = $('calibStatus');
    st.textContent = v.status || '';
    st.className = 'calib-status ' + (v.statusKind || '');
    $('calibNote').textContent = v.note || '';
    $('calibProgress').style.width = Math.round(Math.max(0, Math.min(1, v.progress || 0)) * 100) + '%';
    $('calibViz').classList.toggle('hidden', !v.showViz);
    $('calibMeter').style.width = Math.round(Math.max(0, Math.min(1, v.hearing || 0)) * 100) + '%';
    const mark = (id, x) => {
      const el = $(id);
      el.style.display = x == null ? 'none' : 'block';
      if (x != null) el.style.left = (Math.max(0, Math.min(1, x)) * 100) + '%';
    };
    $('pitchRow').classList.toggle('hidden', !v.showPitch);
    mark('pitchNow', v.pitchNow);
    mark('pitchNormal', v.pitchNormal);
    const z = $('pitchZone');
    if (v.zoneFrom != null) {
      z.style.display = 'block';
      z.style.left = (v.zoneFrom * 100) + '%';
      z.style.width = (Math.max(0, (v.zoneTo ?? 1) - v.zoneFrom) * 100) + '%';
    } else z.style.display = 'none';
    const go = $('btnCalibGo');
    go.classList.toggle('hidden', !v.go);
    if (v.go) go.textContent = v.go;
    $('btnCalibSkip').classList.toggle('hidden', !v.skip);
  }

  hint(text, seconds = 0) {
    const el = $('hint');
    clearTimeout(this._hintTimer);
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
    if (seconds) this._hintTimer = setTimeout(() => el.classList.add('hidden'), seconds * 1000);
  }

  resultTitle(cause) {
    return TITLES[cause] || TITLES.water;
  }

  showResults(r) {
    $('resScore').textContent = r.score;
    $('resDist').textContent = `${r.metres} m`;
    $('resLand').textContent = r.landings;
    $('resBerries').textContent = r.berries;
    $('resBest').textContent = r.best;
    $('resNewBest').classList.toggle('hidden', !r.newBest);
    const cause = QUIPS[r.cause] ? r.cause : 'water';
    const quips = QUIPS[cause];
    $('resTitle').textContent = r.newBest ? 'NEW RECORD!' : TITLES[cause];
    $('resQuip').textContent = r.metres < 15 && cause === 'water'
      ? 'Tip: keep making noise to fly, go quiet to land.'
      : quips[(Math.random() * quips.length) | 0];
    this.show('results');
  }
}
