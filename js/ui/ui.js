// DOM menus and overlays. Holds no game logic: it shows screens and forwards
// button presses to the handlers main.js provides.
import { drawText } from '../render/pixelfont.js';
import { t as tr, pick, getLanguage } from '../i18n/i18n.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['menu', 'permission', 'calib', 'micError', 'pause', 'results', 'settings'];

const MUTE_ON_SVG = '<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="1" y="3" width="2" height="2"/><rect x="3" y="2" width="1" height="4"/><rect x="4" y="1" width="1" height="6"/><rect x="6" y="2" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/><rect x="7" y="3" width="1" height="2"/></svg>';
const MUTE_OFF_SVG = '<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="1" y="3" width="2" height="2"/><rect x="3" y="2" width="1" height="4"/><rect x="4" y="1" width="1" height="6"/><rect x="5" y="2" width="1" height="1"/><rect x="7" y="2" width="1" height="1"/><rect x="6" y="3" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/></svg>';

const DEATHS = ['water', 'ceiling', 'underside', 'shark', 'wave', 'spout', 'eel', 'falcon', 'fire', 'fall'];

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
    for (const b of document.querySelectorAll('.lang-btn')) {
      b.addEventListener('click', (e) => { e.preventDefault(); this.h.setLanguage(b.dataset.lang); });
    }
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
      b.setAttribute('aria-label', tr(m ? 'hud.unmuteAria' : 'hud.muteAria'));
      b.setAttribute('aria-pressed', String(m));
    }
  }

  setMicStatus(mode, mic) {
    const chip = $('micChip');
    let key = 'micChip.notYet';
    let cls = '';
    if (mode === 'touch' && !mic.on) { key = 'micChip.touch'; }
    if (mic.status === 'requesting') key = 'micChip.requesting';
    else if (mic.on) { key = 'micChip.on'; cls = 'ok'; }
    else if (mic.status === 'denied') { key = 'micChip.blocked'; cls = 'bad'; }
    else if (mic.status === 'unavailable' || mic.status === 'insecure' || mic.status === 'error') { key = 'micChip.unavailable'; cls = 'bad'; }
    else if (mic.status === 'lost') { key = 'micChip.lost'; cls = 'bad'; }
    chip.textContent = tr(key);
    chip.className = 'chip ' + cls;
    $('btnPlay').textContent = tr('menu.play');
  }

  /** Settings screen state. */
  setSettings(cam, recorder, muted, mic, micNote, haptics) {
    if (mic) {
      const label = mic.on ? (mic.deviceLabel || tr('settings.micDefault')) : tr('settings.micNotOn');
      $('btnSetMic').textContent = tr('settings.mic', { label: label.length > 26 ? label.slice(0, 25) + '…' : label });
      $('btnSetMic').disabled = !mic.on;
      $('micNote').textContent = micNote || tr(mic.on ? 'settings.micNoteOn' : 'settings.micNoteOff');
    }
    const camOn = cam.wanted;
    const cb = $('btnSetCamera');
    const onOff = (v) => tr(v ? 'settings.on' : 'settings.off');
    cb.textContent = tr('settings.camera', { state: onOff(camOn) });
    cb.setAttribute('aria-pressed', String(camOn));
    const note = {
      requesting: tr('cam.requesting'),
      denied: tr('cam.denied'),
      unavailable: tr('cam.unavailable'),
      insecure: tr('cam.insecure'),
      error: cam.error,
    }[cam.status];
    $('camNote').textContent = note || tr(camOn ? 'cam.noteOn' : 'cam.noteOff');
    const rb = $('btnSetRecord');
    rb.textContent = recorder.supported ? tr('settings.record', { state: onOff(recorder.enabled) }) : tr('settings.recordUnsupported');
    rb.disabled = !recorder.supported;
    rb.setAttribute('aria-pressed', String(recorder.supported && recorder.enabled));
    const sb = $('btnSetSound');
    sb.textContent = tr('settings.sound', { state: onOff(!muted) });
    sb.setAttribute('aria-pressed', String(!muted));
    const vb = $('btnSetVibrate');
    vb.classList.toggle('hidden', !(haptics && haptics.supported)); // iPhone Safari can't vibrate
    if (haptics) {
      vb.textContent = tr('settings.vibrate', { state: onOff(haptics.enabled) });
      vb.setAttribute('aria-pressed', String(haptics.enabled));
    }
    for (const b of document.querySelectorAll('.lang-btn')) {
      const on = b.dataset.lang === getLanguage();
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
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
      note.textContent = tr(canShare ? 'res.videoShare' : 'res.videoSave');
    } else {
      v.removeAttribute('src');
      v.load();
      v.classList.add('hidden');
      note.textContent = state === 'reaction' ? tr('res.recording', { n: secondsLeft })
        : state === 'preparing' ? tr('res.preparing') : state === 'failed' ? tr('res.failed') : '';
      note.classList.toggle('rec', state === 'reaction');
    }
  }

  videoNote(text) {
    $('resVideoNote').textContent = text;
  }

  setBest(best) {
    $('menuBest').textContent = best > 0 ? tr('menu.best', { n: best }) : '';
  }

  showMicError(mic) {
    $('micErrorText').textContent = mic.error || tr('micErr.default');
    let help = tr('micErr.helpTouch');
    if (mic.status === 'denied') {
      help = tr(window.top !== window.self ? 'micErr.helpEmbedded' : 'micErr.helpDenied') + ' ' + help;
    }
    if (mic.status === 'insecure') help = tr('micErr.helpInsecure') + ' ' + help;
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
    return tr('title.' + (DEATHS.includes(cause) ? cause : 'water'));
  }

  showResults(r) {
    $('resScore').textContent = r.score;
    $('resDist').textContent = `${r.metres} m`;
    $('resLand').textContent = r.landings;
    $('resBerries').textContent = r.berries;
    $('resBest').textContent = r.best;
    $('resNewBest').classList.toggle('hidden', !r.newBest);
    const cause = DEATHS.includes(r.cause) ? r.cause : 'water';
    $('resTitle').textContent = r.newBest ? tr('title.newRecord') : tr('title.' + cause);
    $('resQuip').textContent = r.metres < 15 && cause === 'water' ? tr('res.tipFirst') : pick('quips.' + cause);
    this.show('results');
  }
}
