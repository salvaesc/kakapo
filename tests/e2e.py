"""
Browser end-to-end tests (headless Chromium via Playwright for Python).

    pip install playwright && python -m playwright install chromium
    python tests/e2e.py

What it covers:
  1. Real microphone pipeline with Chromium's fake audio device fed from a generated WAV
     (silence / tone alternating): permission → calibration → level rises with the tone
     and drops in silence → the kakapo takes off from sound alone.
  2. Permission denied → error screen, honest "blocked" status, touch fallback playable.
  3. Gameplay in the real page: a scripted player lands on several platforms, falls in the
     river, sees results, restarts — with exactly one animation loop and no page errors.
What it cannot cover: how a real human voice in a real room feels. That needs a phone.
"""
import math, os, struct, subprocess, sys, time, wave, socket

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.environ.get('KAKAPO_TMP', '/tmp')
PORT = int(os.environ.get('KAKAPO_PORT', '8765'))
URL = f'http://localhost:{PORT}/?test'
PHONE = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)

failures = []
def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: failures.append(msg)

def make_wav(path):
    # Matches the pitch calibration: 1.7 s silence (quiet step), 1.8 s of a 200 Hz voice-like
    # tone ("aaah" in a normal voice), 1.9 s of a 700 Hz squeak, then during play:
    # a high 600 Hz squeak / silence / a low 200 Hz "talking" tone / silence, repeating.
    rate = 48000
    frames = bytearray()
    def seg(sec, hz=0, amp=0.3):
        for i in range(int(sec * rate)):
            if hz:
                ph = (i * hz / rate) % 1.0
                v = amp * (2 * ph - 1)  # sawtooth: harmonics like a voice
            else:
                v = 0.002 * math.sin(i * 12.9898)
            frames.extend(struct.pack('<h', int(max(-1, min(1, v)) * 32767)))
    seg(3.4)                 # guided calibration: step 1 (quiet)
    seg(4.0, 220, 0.3)       # step 2: a long, loud "AAAH"
    for _ in range(6):       # during play: loud aaah / silence / soft aaah / silence
        seg(1.5, 220, 0.3); seg(1.0); seg(1.5, 220, 0.025); seg(1.0)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(frames))

def wait_port(port, timeout=5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            socket.create_connection(('localhost', port), 0.2).close(); return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError('server did not start')

AUTOPILOT = """
(async () => {
  const { autopilotLevel } = await import('/tests/autopilot.mjs');
  const k = window.__kakapo;
  window.__autopilot = true;
  const tick = () => { if (!window.__autopilot) return; k.setLevel(autopilotLevel(k.sim)); requestAnimationFrame(tick); };
  tick();
})()
"""

def video_voice_check(pg):
    """Saves the run video, extracts its audio with ffmpeg and measures how much of the
    fake microphone's 600 Hz squeak is in it. None if ffmpeg isn't available."""
    import base64, shutil, numpy as np
    if not shutil.which('ffmpeg'):
        return None
    data = pg.evaluate("""(async () => { const b = window.__kakapo.recorder.blob; const buf = new Uint8Array(await b.arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); })()""")
    vid = os.path.join(TMP, 'kakapo-e2e-run.video')
    wav = os.path.join(TMP, 'kakapo-e2e-run.wav')
    open(vid, 'wb').write(base64.b64decode(data))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', vid, '-ac', '1', '-ar', '16000', wav], check=True)
    if shutil.which('ffprobe'):
        codecs = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', vid],
                                capture_output=True, text=True).stdout.split()
        print('     video streams:', ' '.join(codecs))
        check(any('audio' in c for c in codecs), 'the video file has a sound track')
        # the end card (score panel) is burnt into the last frames
        last = os.path.join(TMP, 'kakapo-e2e-lastframe.png')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', vid, '-an', '-update', '1', last], check=True)  # keeps overwriting: ends with the last frame
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', last, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        px = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(int)
        panel = np.mean((abs(px[:, 0] - 0x16) < 14) & (abs(px[:, 1] - 0x36) < 14) & (abs(px[:, 2] - 0x3a) < 14))
        lime = np.mean((abs(px[:, 0] - 0xc6) < 30) & (abs(px[:, 1] - 0xf0) < 30) & (abs(px[:, 2] - 0x6a) < 40))
        print(f'     end card in the last frame: panel {panel:.0%}, lime {lime:.1%} ({last})')
        check(panel > 0.15 and lime > 0.005, 'the video ends with the score card')
    with wave.open(wav) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), 1 / 16000)
    band = spec[(freqs > 210) & (freqs < 230)].max()
    background = np.median(spec[(freqs > 1500) & (freqs < 6000)]) + 1e-9
    return float(band / background)

def state(pg):
    return pg.evaluate("(() => { const k = window.__kakapo; return { mode: k.game.mode, bird: k.sim.bird.state, landings: k.sim.bird.landings, score: k.sim.score, mic: k.mic.status, level: k.mic.level, loops: k.loops(), cal: k.mic.cal }; })()")

def main():
    wav = os.path.join(TMP, 'kakapo-fake-mic.wav')
    make_wav(wav)
    server = subprocess.Popen(['node', os.path.join(ROOT, 'tools/serve.mjs')], env={**os.environ, 'PORT': str(PORT)},
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_port(PORT)
        with sync_playwright() as p:
            # ---------- 1. fake microphone ----------
            print('1. microphone pipeline (fake audio device)')
            b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                                        f'--use-file-for-fake-audio-capture={wav}', '--autoplay-policy=no-user-gesture-required'])
            ctx = b.new_context(**PHONE)
            ctx.add_init_script("window.__buzz = []; navigator.vibrate = (p) => { window.__buzz.push(p); return true; };")
            ctx.grant_permissions(['microphone', 'camera'], origin=f'http://localhost:{PORT}')
            pg = ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            pg.goto(URL); time.sleep(0.5)
            check('not enabled' in pg.text_content('#micChip'), 'menu does not claim mic access before permission')
            pg.tap('#btnPlay'); time.sleep(0.2)
            check(pg.is_visible('#permission'), 'permission explanation shown before asking')
            pg.tap('#btnAllowMic'); time.sleep(0.5)
            s = state(pg)
            check(s['mic'] == 'on', f"mic status on after permission ({s['mic']})")
            check(pg.is_visible('#calib'), 'calibration screen shown')
            check('Shhh' in pg.inner_text('#calibTitle'), 'calibration starts listening straight away (no intro)')
            check(not pg.is_visible('#cs3') and not pg.is_visible('#cs4'), 'only two steps: quiet + AAAH')
            phases = set()
            t0 = time.time()
            while time.time() - t0 < 20:
                m = pg.evaluate("window.__kakapo.game.mode")
                ph = pg.evaluate("window.__kakapo.game.calib && window.__kakapo.game.calib.phase")
                if ph: phases.add(ph)
                if m in ('ready', 'playing'): break
                time.sleep(0.05)
            check(phases == {'quiet', 'loud'}, f'quiet → AAAH → straight into the game ({sorted(phases)})')
            s = state(pg)
            check(s['mode'] in ('ready', 'playing'), f"calibration completes into the game ({s['mode']})")
            print('     calibration:', {k: round(v) if isinstance(v, float) else v for k, v in s['cal'].items()})
            check(s['cal']['loudOk'], 'calibration measured the loud AAAH')
            levels, loud_l, soft_l = [], [], []
            t0 = time.time()
            while time.time() - t0 < 9:
                r = pg.evaluate("(() => { const m = window.__kakapo.mic; return [m.level, m.db, m.rawLevel]; })()")
                levels.append(r[0])
                if r[1] > -22: loud_l.append(r[2])
                elif -42 < r[1] < -30: soft_l.append(r[2])
                time.sleep(0.05)
            hi, lo = max(levels), min(levels)
            med = lambda a: sorted(a)[len(a) // 2] if a else 0
            print(f'     mic level range over 9s: min={lo:.2f} max={hi:.2f}; loud aaah → {med(loud_l):.2f}, soft aaah → {med(soft_l):.2f}')
            check(hi > 0.9, 'a loud aaah reaches full speed')
            check(lo < 0.1, 'silence brings the level back down')
            check(len(soft_l) > 5 and 0.05 < med(soft_l) < med(loud_l) - 0.3, 'a softer aaah flies, but slower')
            s = state(pg)
            check(s['bird'] in ('fly', 'dead') or s['landings'] > 0 or s['mode'] != 'ready', f"sound alone made the kakapo take off ({s['mode']}/{s['bird']})")
            check(pg.evaluate("window.__kakapo.camera.status") == 'on', 'camera turns on by default with the microphone')
            # end the run and check the video of it
            pg.evaluate("window.__kakapo.start('mic')"); time.sleep(1.5)
            pg.evaluate("window.__kakapo.sim._kill('water')")
            time.sleep(3.2)
            check(pg.evaluate("window.__kakapo.recorder.state") == 'recording' and not pg.is_visible('#resVideoBox'),
                  'keeps recording the reaction after dying, without any on-screen notice')
            t0 = time.time()
            while time.time() - t0 < 16 and not pg.is_visible('#btnSave'): time.sleep(0.1)
            check(pg.is_visible('#btnSave'), 'results offer the run video (save)')
            size = pg.evaluate("window.__kakapo.recorder.blob ? window.__kakapo.recorder.blob.size : 0")
            kinds = pg.evaluate("window.__kakapo.recorder.mime")
            print(f'     run video: {size // 1024} KB, {kinds}')
            check(size > 20000, 'the video has real content (camera + game + audio)')
            voice = video_voice_check(pg)
            if voice is not None:
                print(f'     voice in the video: 220 Hz aaah energy ×{voice:.0f} over background')
                check(voice > 8, 'the video contains the player\'s voice')
            check(pg.evaluate("document.getElementById('resVideo').src.startsWith('blob:')"), 'video preview is shown')
            buzz = pg.evaluate('window.__buzz')
            print('     vibrations:', buzz)
            check(any(isinstance(b_, list) and len(b_) == 3 and b_[2] >= 200 for b_ in buzz), 'the phone vibrates on death')
            check(not errors, f'no page errors ({errors[:3]})')
            ctx.close(); b.close()

            # ---------- 2. permission denied ----------
            print('2. permission denied → fallback')
            b = p.chromium.launch()
            ctx = b.new_context(**PHONE)
            ctx.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));")
            pg = ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(URL); time.sleep(0.4)
            pg.tap('#btnPlay'); pg.tap('#btnAllowMic'); time.sleep(0.4)
            check(pg.is_visible('#micError'), 'error screen shown')
            check('denied' in pg.inner_text('#micErrorText').lower(), 'useful error message')
            pg.tap('#btnErrBack'); time.sleep(0.2)
            check('blocked' in pg.text_content('#micChip').lower(), 'menu status honestly says blocked')
            pg.tap('#btnTouchMode'); time.sleep(0.3)
            check(state(pg)['mode'] == 'ready', 'touch fallback starts a run')
            # press & hold on the game area
            box = pg.locator('#game').bounding_box()
            pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] * 0.6)
            pg.mouse.down(); time.sleep(0.8); pg.mouse.up()
            check(state(pg)['bird'] == 'fly', 'press & hold takes off')
            check(not errors, f'no page errors ({errors[:3]})')
            ctx.close(); b.close()

            # ---------- 3. gameplay loop ----------
            print('3. gameplay: landings, death, results, restart')
            b = p.chromium.launch()
            ctx = b.new_context(**PHONE)
            pg = ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto(URL); time.sleep(0.4)
            pg.evaluate("window.__kakapo.start('touch')")
            pg.evaluate(AUTOPILOT)
            t0 = time.time()
            while time.time() - t0 < 45 and state(pg)['landings'] < 4: time.sleep(0.2)
            s = state(pg)
            check(s['landings'] >= 4, f"scripted player landed {s['landings']} times in the real page")
            pg.screenshot(path=os.path.join(TMP, 'kakapo-e2e-play.png'))
            # rest: silence keeps it perched
            pg.evaluate("window.__autopilot = false; window.__kakapo.setLevel(0)")
            t0 = time.time()
            while time.time() - t0 < 6 and state(pg)['bird'] != 'rest': time.sleep(0.1)
            x0 = pg.evaluate('window.__kakapo.sim.bird.x'); time.sleep(1.5)
            check(state(pg)['bird'] == 'rest' and pg.evaluate('window.__kakapo.sim.bird.x') == x0, 'perched bird stays still in silence')
            # fly off and fall into the river
            pg.evaluate("window.__kakapo.setLevel(0.55)"); time.sleep(1.2)
            pg.evaluate("window.__kakapo.setLevel(0)")
            t0 = time.time()
            while time.time() - t0 < 20 and state(pg)['mode'] != 'results':
                if state(pg)['bird'] == 'rest':  # landed again: hop off further
                    pg.evaluate("window.__kakapo.setLevel(0.55)"); time.sleep(1.4); pg.evaluate("window.__kakapo.setLevel(0)")
                time.sleep(0.2)
            check(pg.is_visible('#results'), 'results screen after falling in the river')
            t0 = time.time()
            while time.time() - t0 < 16 and not pg.is_visible('#btnSave'): time.sleep(0.1)
            check(pg.is_visible('#btnSave'), 'run video ready without camera too (game + sounds)')
            pg.screenshot(path=os.path.join(TMP, 'kakapo-e2e-results.png'))
            for _ in range(3):
                pg.tap('#btnAgain'); time.sleep(0.3)
                check(state(pg)['mode'] == 'ready' and state(pg)['loops'] == 1, 'restart → ready, single loop')
                pg.evaluate("window.__kakapo.sim.bird.state = 'dead'; window.__kakapo.game.mode = 'dying'"); time.sleep(2)
            fps = pg.evaluate("new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })")
            print(f'     headless frame rate: ~{fps} fps')
            check(not errors, f'no page errors ({errors[:3]})')
            ctx.close(); b.close()
    finally:
        server.terminate()
    print('\n' + ('ALL E2E CHECKS PASSED' if not failures else f'{len(failures)} FAILED: {failures}'))
    sys.exit(1 if failures else 0)

if __name__ == '__main__':
    main()
