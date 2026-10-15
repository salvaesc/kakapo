// Languages. The texts live in en.js / es.js / ca.js (same keys in each).
// First visit: the browser's language decides (Catalan → ca, Spanish → es, anything
// else → English). Once the player picks a language in Settings, that one is used
// from then on.
import { load, save } from '../core/storage.js';
import { STRINGS as en } from './en.js';
import { STRINGS as es } from './es.js';
import { STRINGS as ca } from './ca.js';

export const LANGS = { en, es, ca };
export const LANG_ORDER = ['es', 'ca', 'en'];

/** Picks a supported language from a list like navigator.languages (['ca-ES', 'es', 'en']). */
export function detectLanguage(list) {
  for (const l of list || []) {
    const base = String(l).toLowerCase().split(/[-_]/)[0];
    if (base === 'ca') return 'ca';
    if (base === 'es' || base === 'gl' || base === 'eu' || base === 'ast') return 'es'; // Spain's other languages: Spanish
    if (base === 'en') return 'en';
  }
  return 'en';
}

function browserLanguages() {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
}

let current = (() => {
  const saved = load('lang', null);
  return LANGS[saved] ? saved : detectLanguage(browserLanguages());
})();
const listeners = [];

export const getLanguage = () => current;

/** The player's choice in Settings: applied at once and remembered as the default. */
export function setLanguage(lang) {
  if (!LANGS[lang]) return;
  current = lang;
  save('lang', lang);
  applyToDocument();
  for (const fn of listeners) fn(lang);
}

export function onLanguageChange(fn) { listeners.push(fn); }

/** Text for `key` in the current language, with {placeholders} filled in from `vars`. */
export function t(key, vars) {
  let s = LANGS[current][key];
  if (s == null) s = en[key];
  if (s == null) return key;
  if (Array.isArray(s)) return s;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

/** A random entry of a list text (the results jokes). */
export function pick(key) {
  const list = t(key);
  return Array.isArray(list) && list.length ? list[(Math.random() * list.length) | 0] : '';
}

/**
 * Fills the static page: elements with data-i18n (text), data-i18n-html (markup from
 * our own files) and data-i18n-aria (aria-label).
 */
export function applyToDocument(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  if (root.documentElement) root.documentElement.lang = current;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
