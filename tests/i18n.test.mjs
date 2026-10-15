import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS as en } from '../js/i18n/en.js';
import { STRINGS as es } from '../js/i18n/es.js';
import { STRINGS as ca } from '../js/i18n/ca.js';
import { detectLanguage } from '../js/i18n/i18n.js';
import { plainText } from '../js/render/pixelfont.js';

const holes = (s) => (Array.isArray(s) ? [] : (s.match(/\{\w+\}/g) || []).sort());

for (const [name, L] of Object.entries({ es, ca })) {
  test(`${name}: same keys as English, same {placeholders}, no empty texts`, () => {
    assert.deepEqual(Object.keys(L).sort(), Object.keys(en).sort());
    for (const k of Object.keys(en)) {
      assert.deepEqual(holes(L[k]), holes(en[k]), `${name} ${k}`);
      assert.equal(Array.isArray(L[k]), Array.isArray(en[k]), `${name} ${k} list`);
      if (Array.isArray(L[k])) assert.ok(L[k].length && L[k].every((x) => x.trim()), `${name} ${k}`);
      else assert.ok(L[k].trim(), `${name} ${k}`);
    }
  });
}

test('pixel-font texts only use letters the font can draw', () => {
  const ok = /^[0-9A-ZÑ!+\-.:/?' x¡¿·,]*$/;
  for (const L of [en, es, ca]) {
    for (const k of Object.keys(L).filter((k) => /^(fx|hud|end|title)\./.test(k))) {
      const s = plainText(L[k].replace(/\{\w+\}/g, '9'));
      assert.match(s, ok, `${k}: "${s}"`);
    }
  }
});

test('language from the browser: Catalan, Spanish (and Spain’s other languages), else English', () => {
  assert.equal(detectLanguage(['ca-ES', 'es-ES', 'en']), 'ca');
  assert.equal(detectLanguage(['ca']), 'ca');
  assert.equal(detectLanguage(['es-ES']), 'es');
  assert.equal(detectLanguage(['es-MX', 'en']), 'es');
  assert.equal(detectLanguage(['gl-ES']), 'es');
  assert.equal(detectLanguage(['en-GB', 'es']), 'en');
  assert.equal(detectLanguage(['fr-FR', 'ca']), 'ca');
  assert.equal(detectLanguage(['de-DE']), 'en');
  assert.equal(detectLanguage([]), 'en');
});
