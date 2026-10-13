// FUTURE FEATURE — face camera + gameplay recording. Not active in the MVP.
//
// This module only reports what the current browser could support. There is no
// record button anywhere in the UI, and nothing here captures or uploads anything.
//
// Planned integration (see README "Camera & video roadmap"):
//   1. Renderer.display is the finished game frame. A Compositor will draw it onto a
//      1080x1920 recording canvas, plus the front-camera <video> inside a pixel-art frame.
//   2. main.js calls every function in `frameHooks` after each render — the compositor
//      registers there, so the game loop does not change.
//   3. recordingCanvas.captureStream(30) + the existing microphone MediaStream
//      (mic.stream audio track, already permission-granted) → MediaRecorder
//      (video/mp4 on Safari, video/webm on Chrome/Android).
//   4. On game over: review screen → Save (download / Web Share API with files) or Discard.
//      Recordings stay on the device; no automatic upload, no server storage.

export const frameHooks = [];

export function captureSupport() {
  const hasWindow = typeof window !== 'undefined';
  const canvasStream = hasWindow && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  const recorder = hasWindow && typeof window.MediaRecorder !== 'undefined';
  const camera = hasWindow && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let mimeType = null;
  if (recorder && typeof MediaRecorder.isTypeSupported === 'function') {
    for (const t of ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
    }
  }
  const share = hasWindow && typeof navigator.canShare === 'function';
  return { canvasStream, recorder, camera, mimeType, share, ready: canvasStream && recorder && camera && !!mimeType };
}
