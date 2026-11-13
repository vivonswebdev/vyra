// Presse-papiers d'objets du Studio : en mémoire et dans le stockage de session de l'onglet, pour coller dans un
// autre projet ou après un rechargement. Rien n'est envoyé au serveur ni au presse-papiers du système.
import { isClipItem, type ClipItem } from "./transform.js";

const KEY = "vyra.studio.clipboard.v1";
let mem: ClipItem | null = null;

export function readClip(): ClipItem | null {
  if (mem) return mem;
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (isClipItem(v)) mem = v;
  } catch {}
  return mem;
}

export function writeClip(item: ClipItem) {
  mem = item;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(item));
  } catch {}
}
