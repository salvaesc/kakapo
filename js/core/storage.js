// Local storage for non-sensitive data only (best score, preferences).
// Every access is guarded: private mode or blocked storage must never break the game.
const PREFIX = 'kakapo.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — ignore */
  }
}
