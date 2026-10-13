// KAKAPO — central tuning configuration.
// Every gameplay number lives here so it can be tuned without hunting through code.
// Units: logical pixels (the low-res pixel-art grid) and seconds.

export const CONFIG = {
  view: {
    playHeight: 320,      // fixed logical height of the playfield (all devices see the same vertical space)
    minWidth: 150,        // logical width limits; portrait phones land around 150–180
    maxWidth: 240,        // wider screens are letterboxed at this width
    birdScreenX: 0.3,     // bird's horizontal position as a fraction of logical width
    maxBirdScreenX: 56,
  },

  // Playfield geometry (logical y, 0 = top of playfield)
  field: {
    ceilingY: 24,         // normal height of the canopy's underside (see `ceiling` for its shape)
    waterY: 300,          // river surface: falling into it ends the run
    platformMinY: 96,     // highest platform top
    platformMaxY: 268,    // lowest platform top
  },

  // Microphone analysis
  mic: {
    fftSize: 1024,
    floorMarginDb: 12,    // flying starts this many dB above the room's noise: you have to SHOUT a bit
    defaultRangeDb: 30,   // dB from "level 0" to "level 1" when the loud calibration step is weak
    minRangeDb: 8,
    minLoudSpanDb: 10,    // the calibration "AAAH" must be at least this far above the noise gate
    maxRangeDb: 42,
    loudHeadroom: 1.0,    // your calibration "AAAH" is full speed (>1 would reach it with less)
    attack: 0.07,         // smoothing time constant when the level rises (s)
    release: 0.06,        // smoothing time constant when the level falls (s): stop squeaking = stops quickly
    calibQuietSec: 1.6,
    calibLoudSec: 1.8,    // 'volume' mode only
    calibNormalSec: 1.8,  // 'pitch' mode: "aaah" in your normal voice
    calibHighSec: 2.0,    // 'pitch' mode: your highest squeak
    // 'pitch': the higher your voice, the higher and faster he flies (talking does nothing).
    // 'volume': the louder, the higher (the original control).
    mode: 'volume',
    pitch: {
      fftSize: 2048,
      minHz: 70,
      maxHz: 1600,
      threshold: 0.25,    // YIN confidence: lower = stricter. 0.25 keeps real, rough voices; noise still gives nothing
      holdGap: 0.12,      // a voiced sound that briefly loses its pitch keeps the last one this long (s)
      median: 3,          // frames in the median filter (more = steadier but slower)
      aboveSpeech: 1,     // flying starts this many semitones above your normal voice
      minRange: 5,        // semitones from "starts flying" to "full speed", at least
      defaultRange: 9,    // used when the squeak step heard nothing useful
      defaultSpeakHz: 170,
      highHeadroom: 0.85, // full speed ~3 semitones below your best squeak: no need to scream
    },
    // Browser processing. AGC off keeps loudness meaningful; echo cancellation on
    // removes the game's own sound effects from the microphone signal.
    constraints: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  },

  // Maps the smoothed 0..1 level to a control intensity
  control: {
    deadzone: 0.07,       // below this the bird hears "silence"
    curve: 1.2,           // >1: the low end is a little gentler
  },

  flight: {
    gravity: 950,         // px/s² while silent: he drops like a stone
    maxFall: 340,         // px/s
    minClimb: 60,         // climb speed at the softest audible sound (px/s)
    maxClimb: 150,        // climb speed at full volume — caps the "shout launch"
    climbResponse: 7.5,   // 1/s: how fast vertical speed approaches a faster climb
    brakeResponse: 18,    // 1/s: how fast it slows down when you lower your voice (responsive!)
    ceilingCushion: 40,   // within this many px under the canopy, climbing slows down (assist)
    cushionMin: 0.15,     // ...to this fraction of maxClimb at contact (a gentle bump still hurts)
    hitHalfW: 6,          // hitbox half-size (bird is ~20 px tall on screen grid)
    hitHalfH: 7,
  },

  scroll: {               // horizontal world speed (px/s)
    silent: 18,           // silence: progress slows right down
    min: 64,              // softest sound
    max: 200,             // loudest sound
    accel: 300,           // px/s² towards a faster target
    decel: 200,           // px/s² towards a slower target
  },

  rest: {
    takeoffLevel: 0.25,    // smoothed level that must be held to take off from a platform
    takeoffHold: 0.2,     // ...for this long (s). Ambient blips are ignored.
    takeoffVy: -120,
    landGrace: 0.35,      // after landing, ignore takeoff for this long (s)
    sleepAfter: 6,        // seconds of silence on a platform before the kakapo dozes off
  },

  lives: {
    max: 3,               // hearts per run
    invulnerable: 1.5,    // seconds of blinking immunity after losing a heart
    hardFallHeight: 200,  // landing after free-falling this many px (from the highest point
                          // since the bird last went up) costs a heart. About 60% of the playfield (320 px).
    warnFraction: 0.75,   // show the "!" warning over the bird from this fraction of hardFallHeight
  },

  // The canopy is a maze: clearings (higher) and hanging root masses (lower).
  // Values are [easy, hard] pairs ramped by difficulty like `world`.
  ceiling: {
    clearingY: 6,         // underside of a clearing (gap in the canopy)
    startAfter: 2,        // first platforms keep a flat canopy
    clearingChance: [0.1, 0.14],
    dropChance: [0.5, 0.8],
    minDrop: 26,          // a hanging mass is at least this much lower than the normal canopy
    maxDrop: [120, 220],
    clearGap: 46,
    splitGap: 70,         // gaps at least this wide get two canopy pieces at different heights         // over a gap, a hanging mass stays this far above the lower neighbouring platform top
  },

  // Deadly things in the river and burning islands.
  hazards: {
    enabled: true,
    chance: [0.6, 0.95],  // chance a gap has a river hazard
    minGap: 40,           // gaps narrower than this never get one
    doubleChance: [0, 0.45], // chance a wide gap gets a second, different hazard
    doubleMinGap: 90,
    shark: { unlock: 2, period: [3.6, 4.8], leap: 1.15, fin: 1.1, height: [62, 108], radius: 6 },
    wave: { unlock: 4, period: [4.6, 6.2], amp: [40, 74] },
    spout: { unlock: 7, period: [6.5, 8], grow: 1.1, hold: 2.2, fade: 0.9, halfW: 5, pullRadius: 40, pull: 28 },
    eel: { unlock: 3, period: [2.8, 4.0], warn: 0.85, strike: 0.7, height: [64, 104], halfW: 4 },
    fire: { unlock: 3, chance: [0.14, 0.3], bounce: 190 },
  },

  // Kārearea (NZ falcon): dives at the kakapo while it flies. Resting kakapo "freeze"
  // and go unseen, like the real ones, so a falcon gives up on a perched bird.
  predator: {
    enabled: true,
    unlockMetres: 40,
    every: [7, 3.5],      // seconds between attacks, easy → hard (ramps over rampMetres)
    rampMetres: 500,
    warn: 1.1,            // "!" warning at the screen edge before the dive
    lockAt: 0.45,         // the falcon commits to your height this long before diving
    speed: 260,           // px/s
    spawnAhead: 170,      // starts this far ahead of the bird (off-screen right)
    radius: 6,
    knock: 150,           // knocks the bird down this fast when it hits
  },

  // Front camera as the sky (optional; the player turns it on from the menu)
  camera: {
    pixelated: false,     // false: sharp video at screen resolution (you're easy to recognise)
                          // true: drawn at the pixel-art resolution and posterized
    levels: 6,            // pixelated only: colour levels per channel. 0/1 = off
    contrast: 1.15,       // pixelated only
    tint: [70, 190, 220], // a touch of sky blue so the video sits with the palette
    tintAmount: 0.08,
    zoom: 1.0,
    verticalBias: 0.25,   // 0 = top of the video at the top of the screen, 0.5 = centred
    hideLayers: 2,        // hide the first N parallax layers (clouds, far mountains) so you can be seen
  },

  // Video of each run (screen + your voice + game sounds), for sharing at the end
  recording: {
    fps: 24,
    maxHeight: 720,       // the video is scaled down to this height (vertical, phone-shaped)
    videoBps: 800000,     // ~0.1 MB per second of video: light enough to share
    audioBps: 64000,      // AAC: some encoders sound bad (or drop audio) below this
    maxSeconds: 180,      // longer runs stop recording here
    afterDeathSec: 5,     // keeps recording this long after dying, to catch the reaction
    voiceGain: 1.8,       // your voice in the video, relative to the game's sound effects
  },

  // Drowning animation (purely visual: the run is already over)
  sink: {
    delay: 0.25,          // floats this long after the splash before going down
    speed: 13,            // px/s
    maxDepth: 24,         // stops this far down (the river is shallow on screen) and fades out
    bubbleEvery: 0.16,     // s between bubbles
    bubbleRise: 18,       // px/s
    bubbleFor: 2.2,       // bubbles stop after this many seconds
  },

  bonk: {
    stun: 0.15,           // controls ignored after hitting the canopy or a platform side (s)
    ceilingPush: 90,      // downward speed after a canopy bonk
    sideKnockback: 44,    // backwards speed after hitting a platform side
  },

  world: {
    seedRandom: true,
    firstPlatform: { x: -40, y: 210, w: 130, h: 26 },
    // difficulty ramps from 0 to 1 over this many platforms
    rampPlatforms: 24,
    gapMin: [40, 86],     // [easy, hard]
    gapRand: [18, 36],
    widthMin: [52, 30],
    widthRand: [26, 12],
    riseMax: [44, 84],    // how much higher the next platform may be
    dropMax: [40, 80],    // how much lower
    thickness: [16, 28],
    checkpointEvery: 6,   // every Nth platform is a pōhutukawa checkpoint
    berryChance: [0.55, 0.8],
    lookAhead: 260,
  },

  score: {
    pxPerMetre: 8,
    landBonus: 10,
    perfectBonus: 15,     // extra for landing near the platform centre
    perfectZone: 0.22,    // fraction of half-width counted as "centre"
    checkpointBonus: 50,
    berryBonus: 5,
    milestoneMetres: 100,
  },

  sim: {
    fixedStep: 1 / 120,
    maxFrameDt: 1 / 20,   // longer frames (tab hiccups) are clamped to avoid tunnelling
  },

  sfx: {
    volume: 0.22,
    micIgnoreMs: 180,     // takeoff detection is blocked this long after a sound effect
  },

  touch: {                // fallback control: press & hold
    pressLevel: 0.35,     // level the instant you press
    rampPerSec: 0.9,      // level rises while held
    releasePerSec: 6,
  },
};
