// One shared AudioContext for microphone analysis and sound effects.
// Must be created/resumed from a user gesture (iOS Safari, Chrome autoplay policy).
let ctx = null;

export function audioSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

export function getAudioContext() {
  if (!ctx && audioSupported()) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export async function resumeAudio() {
  const c = getAudioContext();
  if (c && c.state === 'suspended') {
    try { await c.resume(); } catch { /* ignored: will retry on next gesture */ }
  }
  return c;
}
