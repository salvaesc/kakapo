# KAKAPO

*Squeak high to fly. Stay quiet to fall.*

A mobile-first, voice-controlled pixel-art platformer. A small, round, very determined kakapo discovers he can fly by making sounds: the **loudness of your voice** is an analog joystick that controls both how fast he climbs and how fast the New Zealand forest scrolls by: a loud “AAAH” is high and fast, a softer one slower, silence drops. (A pitch-based control — squeak higher to fly — is also built in: `mic.mode: 'pitch'`.) Go quiet to drop onto a floating island and rest for as long as you like.

Vanilla HTML/CSS/JS (ES modules), Canvas 2D, Web Audio API. **No dependencies, no build step.**

---

## Run it

```bash
node tools/serve.mjs          # or: npm start
# → http://localhost:8080
```

Any static server works (`python3 -m http.server`, etc.). Deploy by uploading the folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages) — they all serve HTTPS, which the microphone requires.

### Microphone needs a secure context

Browsers only allow `getUserMedia()` on **`https://`** or **`http://localhost`**. Opening the game at `http://192.168.x.x:8080` on your phone will *not* get microphone access — the game detects this and offers touch mode instead of pretending.

## Testing on a phone

Pick one:

1. **Deploy** (simplest): drag the folder onto Netlify Drop / push to GitHub Pages, open the https URL on the phone.
2. **Android + USB, no HTTPS needed**: on the computer open `chrome://inspect/#devices` → *Port forwarding* → `8080 → localhost:8080`. On the phone open `http://localhost:8080`. Localhost counts as secure.
3. **A tunnel**: `cloudflared tunnel --url http://localhost:8080` (or `ngrok http 8080`) and open the https URL it prints.
4. **Local HTTPS on your LAN**: create a certificate (e.g. `mkcert 192.168.1.20`), then
   `HTTPS_KEY=key.pem HTTPS_CERT=cert.pem node tools/serve.mjs` and trust the CA on the phone.

On the phone: tap **Play → Allow mic & camera**, then the **calibration** (about 6 s, two steps): stay quiet for a moment, then shout a long “AAAH!”. It only advances while the game actually hears you, shows a *Hearing* bar, and explains what to check when it can't hear you. That shout becomes the kakapo's full speed; talking won't lift him.

**If permission was denied:** Android Chrome → padlock icon in the address bar → *Permissions → Microphone → Allow*, then reload. iOS Safari → *aA* menu → *Website Settings → Microphone → Allow* (or Settings → Safari → Microphone).

**Microphone problems (AirPods, iPhone):** the game asks for the mic and the camera in a single request (asking separately can silently mute the mic on iOS), resumes iOS's “interrupted” audio, and detects a dead input (exact digital silence) to warn you. AirPods microphones are weak: **Settings → Microphone** switches to another input (e.g. the phone's own mic); recalibrate afterwards.

**Tips:** hold the phone at a normal distance; humming works as well as shouting. Use **Menu → Recalibrate mic** if you move to a noisier room. If the kakapo takes off on his own, the room is louder than during calibration — recalibrate.

## How to play

| You do | The kakapo does |
|---|---|
| Silence | Drops fast; forward progress almost stops |
| Talking in your normal voice | Nothing (the meter shows **HIGHER!**) |
| A bit higher than your normal voice | Rises gently, forest scrolls slowly |
| Higher | Rises faster, scrolls faster |
| Your highest squeak | Big wings, wide beak, fastest climb and scroll (capped) |

The meter at the bottom is a stereo-style wedge: the further right (taller, redder) it lights up, the faster he goes. While resting, a blinking caret marks the bar you need to reach to take off.
| Land on an island | Perched and **safe**. The world stops. Rest your voice as long as you like. |
| Sustained sound while perched | Takes off (claps, clicks and background noise are ignored) |

### The forest maze

- **Canopy**: clearings let you fly higher; masses of hanging canopy drop down over most gaps — down to the middle of the screen — and wide gaps get two pieces at different heights, so you zig-zag through. You have to fly underneath them. They never hang directly over an island, and there is always room to pass underneath.
- **Burning islands** (from island 3): flames on top. Fly over them to the next island.
- **River hazards** (on most gaps; wide gaps can have two different ones):
  - **Sharks** (from island 2): a fin circles first, then the shark jumps across the gap.
  - **Giant waves** (from island 4): the river swells up in the middle of the gap, then calms down.
  - **Eels — tuna** (from island 3): bubbles boil up at a spot, then the eel lunges straight out of the river.
  - **Waterspouts** (from island 7): a storm cloud gathers, a column rises to the canopy, holds, then fades. Its wind pulls you in.
  
  All of them run on a cycle: rest on the island, watch the rhythm, and cross when it's clear. The first time each one appears, a short tip explains it.
- **Kārearea — the NZ falcon** (after 40 m): while you fly, a **!** appears at the right edge at your height. It follows you, then turns **red**: the falcon has locked that height and dives across it. Change height to dodge; a hit costs a heart and knocks you down. Like real kākāpō, a kakapo perched on an island **freezes** and the falcon can't see it, so it gives up.

### Hearts

The kakapo has **3 hearts** per run (top left). He loses:

| What happens | Cost |
|---|---|
| Hitting the canopy with your head (flying up into it) | 1 heart |
| Bumping into the side of a hanging canopy mass | nothing (knock-back) |
| Hitting an island from below | nothing (bounce) |
| Landing after a long free fall (≥ 100 px, almost a third of the screen) | 1 heart |
| Touching a burning island (he bounces off with hot feet; no resting there) | 1 heart |
| Falling into the river | all hearts |
| A leaping shark, a lunging eel, a giant wave or a waterspout | all hearts |
| The falcon's dive | 1 heart |

After losing a heart he blinks for 1.5 s and can't lose another. A **“!”** over his head warns that a fall is getting long; a blinking red **“!!”** means the landing will hurt. Making a little sound brakes the fall and resets the height. With no hearts left in the air he cartwheels down, out of control; on an island he ends up flat on his back.
 Landings give bonus points, landing near the centre gives a **PERFECT** bonus, red rimu berries are +5, and every 6th island has a pōhutukawa checkpoint worth +50.

**No microphone?** Choose *Play with touch*: press & hold anywhere to fly (holding longer = “louder”), release to fall. Space / ↑ also work on desktop. Touch also works as a backup during mic play.

---

## Tuning parameters

Everything lives in **`js/config.js`** — no magic numbers elsewhere. The ones that matter most:

| Parameter | Default | Effect |
|---|---|---|
| `control.deadzone` | 0.07 | Level below this counts as silence. Raise if the bird reacts to room noise. |
| `control.curve` | 1.25 | >1 = gentler soft end, steeper loud end. |
| `flight.minClimb` / `maxClimb` | 60 / 150 px/s | Climb speed at the softest / loudest sound. `maxClimb` is the shout cap. |
| `flight.climbResponse` / `brakeResponse` | 7.5 / 18 /s | How fast it speeds up a climb / how fast it stops climbing when your voice drops. |
| `flight.gravity` / `maxFall` | 950 / 340 | How fast silence brings him down. |
| `scroll.silent` / `min` / `max` | 18 / 64 / 200 px/s | World speed in silence, soft and loud sound. |
| `scroll.accel` / `decel` | 300 / 200 px/s² | How quickly world speed follows the voice. |
| `rest.takeoffLevel` / `takeoffHold` | 0.2 / 0.2 s | How loud, for how long, to leave a platform. |
| `rest.landGrace` | 0.35 s | Takeoff is ignored right after landing (and at run start). |
| `mic.attack` / `release` | 0.07 / 0.06 s | Signal smoothing. Longer release = less jittery, slightly floatier. |
| `mic.mode` | `'volume'` | `'volume'` (louder = more) or `'pitch'` (higher voice = more). |
| `mic.loudHeadroom` | 1.0 | Your calibration shout is full speed; raise it (e.g. 1.3) to reach full speed with less. |
| `mic.floorMarginDb` | 12 dB | How far above the room noise you must be to start flying: higher = shout more. |
| `mic.pitch.aboveSpeech` | 1 st | Flying starts this many semitones above your normal voice. Raise it to force sillier squeaks. |
| `mic.pitch.minRange` / `defaultRange` | 5 / 9 st | Semitones from “starts flying” to “full speed”. |
| `mic.pitch.threshold` | 0.25 | Pitch-detector strictness (lower = fewer false pitches from noise). |
| `mic.constraints` | AEC on, NS/AGC off | AGC off keeps loudness meaningful; echo cancellation keeps sound effects out of the mic. |
| `lives.max` | 3 | Hearts per run. |
| `lives.invulnerable` | 1.5 s | Blinking immunity after losing a heart. |
| `lives.hardFallHeight` | 100 px | Free-fall height that hurts on landing (playfield is 320 px tall). |
| `lives.warnFraction` | 0.75 | When the “!” warning appears, as a fraction of `hardFallHeight`. |
| `ceiling.*` | — | Canopy maze: chances of clearings and hanging masses, how low they hang, clearance kept above islands. |
| `hazards.enabled` | true | Turns sharks, waves, waterspouts and burning islands on/off. |
| `hazards.chance` | [0.3, 0.75] | Chance a gap gets a river hazard, easy → hard. |
| `hazards.shark/wave/spout/eel/fire` | — | `unlock` (first island index), cycle `period`, size/height, fire `bounce`. |
| `hazards.doubleChance` | [0, 0.45] | Chance a wide gap gets a second hazard. |
| `predator.*` | — | Falcon: `unlockMetres`, `every` (seconds between attacks, easy → hard), `warn`, `lockAt`, `speed`, `enabled`. |
| `world.*` | — | Gap/width/height ranges as `[easy, hard]`, ramped over `rampPlatforms`. |
| `score.*` | — | Points for distance, landings, perfect, checkpoints, berries. |

The relationship that matters: vertical and horizontal speed come from **the same signal**. Holding a sound always moves you *up and forward*; silence moves you *down* with very little drift. This is what makes landings precise (go quiet above the target and drop). If gaps feel too long, raise `scroll.min/max` before lowering `maxClimb`.

---

## Architecture

```
index.html, css/style.css        DOM menus/overlays over a single <canvas>
js/
  main.js                        Game loop (one rAF, guarded) + state machine + event→feedback wiring
  config.js                      All tuning constants
  core/      rng.js storage.js   Seeded PRNG; guarded localStorage (best score, mute, calibration)
  game/      sim.js              Simulation: bird state machine, scoring, events (DOM-free, deterministic)
             physics.js          Voice → climb rate & world speed mapping
             collision.js        Swept AABB faces (top/bottom/left/right), foot overlap
             world.js            Streaming platforms, canopy maze, hazards, berries; difficulty ramp; fairness rules
             hazards.js          Shark / wave / waterspout timing as pure functions of time (shared by sim and renderer)
  input/     micMath.js          RMS→dB, YIN pitch detection, pitch→level, calibration, smoothing (pure, tested)
             mic.js              getUserMedia, analyser graph, status & cleanup
             touch.js            Press-and-hold fallback (+ Space/↑)
  audio/     audioContext.js     Shared, gesture-resumed AudioContext
             sfx.js              Synthesised blips + "block takeoff while playing" window
  render/    renderer.js         Low-res buffer → integer-scaled crisp blit; HUD & voice meter
             kakapo.js           Character sprite parts + pose selection (all 8 states)
             pixel.js            Grid→canvas sprites, dither, pixel discs
             pixelfont.js        3×5 bitmap font
             effects.js          Pooled particles, popups, shake, banners
  biomes/    forest.js, index.js Biome interface: parallax layers, platform art, water, canopy
  ui/        ui.js               Screens & buttons (no game logic)
  capture/   capture.js          Future camera/recording integration point (feature detection only)
tests/                           Node unit tests, autopilot, browser E2E
tools/serve.mjs                  Zero-dependency dev server (optional HTTPS)
tools/sprite-preview.html        Shows every kakapo pose for art iteration
```

**Data flow per frame:** input level (mic or touch, smoothed) → `Sim.update(dt, level, allowTakeoff)` in fixed 1/120 s steps → events (`takeoff`, `land`, `perfect`, `berry`, `bonk`, `splash`, `milestone`, `checkpoint`) → effects + sound + UI → `Renderer.render()` reads state and draws. The simulation never touches the DOM, which is why it can be unit-tested and replayed.

**Pixel crispness:** the playfield is a fixed 320 logical pixels tall on every device (fair difficulty everywhere). The renderer picks the largest integer scale that fits the screen's *device* pixels, adds extra canopy/river rows rather than stretching, and blits with smoothing off. Sprites are grids of palette characters → cached canvases, so swapping in a sprite sheet only touches `kakapo.js` / the biome.

**Game states:** `menu → permission → calibrating → ready → playing (resting is a sim sub-state) → dying → results → ready`, plus `paused` and `micError`. Calibration runs once per session; restarts are instant.

**Robustness:** single guarded animation loop (stopped when the tab is hidden, auto-pause), mic `ended` handling (e.g. a phone call takes the mic), all mic tracks/nodes released on `pagehide`, frame delta clamped against tunnelling, pooled particles/events (no allocation in the hot loop), listeners registered once.

---

## Tests

```bash
npm test             # Node unit tests (node:test, no deps) — 50 tests
npm run test:e2e     # Browser E2E (needs: pip install playwright && python -m playwright install chromium)
```

**Automated and passing:**
- Mic math: RMS/dB, calibration, smoothing; pitch detection within ⅓ semitone for sine and voice-like tones from 90 to 1400 Hz at 44.1/48 kHz, no pitch from noise or silence; pitch→level (normal voice → 0, squeak → 1); calibration adapts to deep and high voices.
- Physics: silence descends and stops progress; soft vs loud produce >2.5× different climb and scroll; shout never exceeds the cap.
- Collisions: correct face resolution; landing leaves feet exactly on the surface; perched bird doesn't move for 30 s of silence.
- Rest: steady sub-threshold noise and 80 ms blips don't trigger takeoff; sustained sound does; sound effects block takeoff.
- Hearts: canopy and underside hits cost one heart each, blinking prevents a double loss, side hits are free, the river takes all hearts, a long fall costs a heart and a short one doesn't, braking with sound resets the fall height, last heart in the air → KO tumble → dead, last heart on a hard landing → dead on the island. The scripted player loses 0 hearts in 620 landings (the rules don't punish careful play).
- Maze & hazards: canopy segments are contiguous, hanging masses only over gaps with room underneath; burning islands never checkpoints/never consecutive/calm gap before them; hazards sit in exactly one gap and unlock progressively; a hanging mass's side costs a heart, flying under it doesn't; a burning island costs a heart and bounces; a leaping shark/a wave crest/a waterspout kill, while a fin, a calm river or a faded spout don't; the spout's wind pulls. A scripted player that waits for windows survives all 15 test runs with hazards on.
- World: platforms never overlap and stay in the playfield across 50 seeds; difficulty ramps; **an autopilot using only a 0..1 input lands on 44–45 new platforms on all 30 seeds** (levels are reachable through the hard ramp).
- Browser (headless Chromium, phone viewport): real Web Audio pipeline fed by a fake microphone WAV — permission → 3-step calibration finds the 200 Hz “normal voice” and the 700 Hz “squeak” → a 600 Hz squeak flies (level 0.92), a 200 Hz “talking” tone gives exactly 0, silence drops → the kakapo takes off from sound alone; 61 fps with pitch detection; denied permission → honest "blocked" status + working touch fallback; scripted play lands 4×, perches still, falls, results, 3 restarts with exactly one loop; no page errors.

**Needs real-device testing (not verified here):**
- How it *feels* with a real voice in a real room, and whether defaults need tuning per phone mic.
- iOS Safari (only designed for: gesture-resumed AudioContext, muted analyser sink, byte-data fallback). iOS may ignore `autoGainControl: false` and may route sound effects to the earpiece while the mic is open.
- Echo cancellation behaviour on specific Android devices (some duck the input). If voice feels weak, try `echoCancellation: false` in `config.js`.
- Frame rate on mid-range phones (headless desktop Chromium runs at 60 fps).

---

## You in the sky (camera background)

The game is made to be played **with the camera on**: when you tap Play it asks for the microphone and then the camera, and the front camera becomes the game's sky: mirrored like a selfie and drawn sharp at full screen resolution so you're easy to recognise (set `camera.pixelated: true` for a pixel-art, posterized version); the forest, islands and canopy are drawn on top (the clouds and far mountains are hidden so you can be seen, `camera.hideLayers`). You can turn it off in **Settings**; if permission is denied the normal sky stays and you can still play. Like the microphone, the camera needs https or localhost.

## Run video and sharing

Every run is recorded (Settings → *Save a video of each run*): the finished screen — your face, the forest and the kakapo — plus the sound: your squeaks from the microphone mixed with the game's effects. It's a light vertical video (720 px tall, 24 fps, ~0.8 Mbit/s video + 64 kbit/s audio ≈ 0.1 MB per second, so a short run is a few hundred KB; max 3 min; tune with `recording.maxHeight` / `videoBps`), made with `canvas.captureStream()` + `MediaRecorder` (`js/capture/recorder.js`). Format: MP4 with H.264 + **AAC** sound when the browser can (recent Chrome/Edge, Safari) because it plays with sound everywhere; otherwise WebM (VP9 + Opus). A plain MP4 from Chrome would carry Opus sound, which Windows' player and some apps open silent, so it is never chosen there.

Recording quietly continues for **5 seconds after the kakapo dies** (`recording.afterDeathSec`) to catch your reaction. Your voice is mixed in louder than the game's sounds (`recording.voiceGain`). Then the results screen plays the clip and offers **Share video** (the phone's share sheet: WhatsApp, Instagram, TikTok…, via the Web Share API) and **Save video** (download). The video lives only in memory on the device; it is replaced by the next run and never uploaded unless you share it.

Format: MP4 where the browser can (Safari, recent Chrome), otherwise WebM. Some social apps don't accept WebM; Safari/iOS and current Android Chrome produce MP4 with H.264.

## Known limitations

- One biome (native forest). `biomes/index.js` is the slot for coast, alpine and fjords.
- No music by design (would interfere with the mic); sound effects are simple synth blips.
- Calibration is quick and per-session; very noisy rooms reduce dynamic range.
- Desktop browsers are letterboxed at 240 logical px wide; the game is designed for portrait phones.
- The menu font uses the system's rounded sans-serif; only in-canvas HUD text is a bitmap pixel font.
- Score is local only (by design for the MVP).

## Recommended next steps

1. **Play on 3–4 real phones** and tune `control.curve`, `scroll.*`, `rest.takeoffLevel` with real voices; consider exposing a sensitivity slider.
2. Hand-drawn sprite sheet for the kakapo (more frames for flap/flail) — swap in via `kakapo.js`.
3. A few hazards with personality (wētā on platforms, gusts of wind) once the core loop is tuned.
4. Coast biome after ~500 m, with a biome transition.
5. Camera + recording feature per the roadmap above.
6. PWA manifest + offline caching for "add to home screen".
