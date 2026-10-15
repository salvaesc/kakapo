// Running inside the Android app (Capacitor)? Then the browser's Web Share API and
// downloads don't exist, so the run video is shared and saved with native plugins.
// In a normal browser none of this is used.
import { t as tr } from '../i18n/i18n.js';

function cap() {
  const C = typeof window !== 'undefined' ? window.Capacitor : null;
  return C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() ? C : null;
}

export const isNativeApp = () => !!cap();

function plugin(name) {
  const C = cap();
  return (C.Plugins && C.Plugins[name]) || C.registerPlugin(name);
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Opens Android's share sheet (WhatsApp, Instagram, TikTok…) with the video. */
export async function nativeShareFile(file, text) {
  const data = await toBase64(file);
  const { uri } = await plugin('Filesystem').writeFile({ path: file.name, data, directory: 'CACHE' });
  await plugin('Share').share({ title: 'KAKAPO', text, files: [uri], dialogTitle: tr('res.shareDialog') });
}

/** Saves the video in the phone's Documents/KAKAPO folder. Resolves to a short place name. */
export async function nativeSaveFile(file) {
  const data = await toBase64(file);
  await plugin('Filesystem').writeFile({ path: `KAKAPO/${file.name}`, data, directory: 'DOCUMENTS', recursive: true });
  return `Documents/KAKAPO/${file.name}`;
}
