// Player physics: the voice-as-analog-joystick mapping.
// One control intensity (0..1) drives both climb rate and world speed.
import { clamp } from '../core/rng.js';

/** Level (0..1) → control intensity (0..1) with deadzone and response curve. */
export function shapeLevel(level, control) {
  if (level <= control.deadzone) return 0;
  const t = (level - control.deadzone) / (1 - control.deadzone);
  return Math.pow(clamp(t, 0, 1), control.curve);
}

export function approach(value, target, maxDelta) {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

/**
 * Advances vertical velocity. Silence = gravity; sound = steer towards a climb speed
 * proportional to intensity. Because sound sets a *target speed* rather than adding
 * raw force, a shout can never accelerate the bird beyond maxClimb.
 */
export function stepVertical(vy, intensity, dt, flight, stunned) {
  if (intensity > 0 && !stunned) {
    const target = -(flight.minClimb + (flight.maxClimb - flight.minClimb) * intensity);
    // climbing faster than you now ask (voice went down): brake quickly
    const rate = vy < target ? (flight.brakeResponse || flight.climbResponse) : flight.climbResponse;
    const k = 1 - Math.exp(-rate * dt);
    return vy + (target - vy) * k;
  }
  return Math.min(vy + flight.gravity * dt, flight.maxFall);
}

/** Advances horizontal world speed with separate accel/decel limits. */
export function stepScroll(speed, intensity, dt, scroll, stunned) {
  const target = intensity > 0 && !stunned
    ? scroll.min + (scroll.max - scroll.min) * intensity
    : scroll.silent;
  const rate = target > speed ? scroll.accel : scroll.decel;
  return approach(speed, target, rate * dt);
}
