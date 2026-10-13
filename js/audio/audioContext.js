// One shared AudioContext for microphone analysis and sound effects.
// Must be created/resumed from a user gesture (iOS Safari, Chrome autoplay policy).
// iOS can also leave it 'interrupted' (calls, Siri, switching to AirPods, turning the
// mic on): we resume from that state too, and try again whenever it changes.
let ctx = null;

export function audioSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

export function getAudioContext() {
  if (!ctx && audioSupported()) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    ctx.addEventListener && ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
    });
  }
  return ctx;
}

export async function resumeAudio() {
  const c = getAudioContext();
  if (c && c.state !== 'running' && c.state !== 'closed') {
    try { await c.resume(); } catch { /* ignored: will retry on next gesture */ }
  }
  return c;
}
