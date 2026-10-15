// Tiny 3x5 bitmap font for the in-canvas HUD (crisp at any integer scale).
const G = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '!': '010010010000010', '+': '000010111010000', '-': '000000111000000', '.': '000000000000010',
  ':': '000010000010000', '/': '001001010100100', '?': '111001011000010', ' ': '000000000000000',
  "'": '010010000000000', 'x': '000101010101000',
  // Spanish / Catalan
  'Ñ': '111000111101101', '¡': '010000010010010', '¿': '010000010100111', '·': '000000010000000',
  ',': '000000000010100',
};

/** Capitals without accents (the font has no accented letters), keeping Ñ. */
export function plainText(str) {
  return String(str).toUpperCase().normalize('NFD')
    .replace(/N\u0303/g, 'Ñ').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'");
}

const cache = new Map();

/** Measures text width in logical pixels at the given scale. */
export function textWidth(str, scale = 1) {
  str = plainText(str);
  return str.length ? (str.length * 4 - 1) * scale : 0;
}

function glyphCanvas(ch, color) {
  const key = ch + color;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 3; c.height = 5;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  const bits = G[ch] || G['?'];
  for (let i = 0; i < 15; i++) if (bits[i] === '1') ctx.fillRect(i % 3, (i / 3) | 0, 1, 1);
  cache.set(key, c);
  return c;
}

/**
 * Draws text with an optional 1px outline/shadow. align: 'left' | 'center' | 'right'.
 */
export function drawText(ctx, str, x, y, { scale = 1, color = '#fff', outline = null, shadow = null, align = 'left' } = {}) {
  str = plainText(str);
  const w = textWidth(str, scale);
  let x0 = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  y = Math.round(y);
  const pass = (col, ox, oy) => {
    for (let i = 0; i < str.length; i++) {
      ctx.drawImage(glyphCanvas(str[i], col), x0 + i * 4 * scale + ox, y + oy, 3 * scale, 5 * scale);
    }
  };
  if (shadow) pass(shadow, 0, scale);
  if (outline) {
    pass(outline, -1, 0); pass(outline, 1, 0); pass(outline, 0, -1); pass(outline, 0, 1);
  }
  pass(color, 0, 0);
  return w;
}
