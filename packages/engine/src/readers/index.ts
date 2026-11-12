// Lecteurs PES (section PEC, versions 1 à 6) et DST (Tajima).
// Usage : validation et fiche technique des fichiers téléversés sur VYRA Market
// (nombre de points, dimensions, couleurs, changements de fil, aperçu).
// Lire un fichier prouve qu'il est bien formé, jamais que la broderie est bonne.
//
// Les coordonnées produites sont en millimètres, y vers le bas, avec les mêmes
// commandes que le moteur (STITCH, JUMP, TRIM, COLOR_CHANGE, END).

import type { PlanStitch, Thread, StitchCommand } from "../types.js";

export const CMD = { STITCH: 0, JUMP: 1, TRIM: 2, END: 4, COLOR_CHANGE: 5 } as const;

export interface ReadResult {
  format: "PES" | "DST";
  /** Version déclarée (« 0001 », « 0060 »…) pour PES, null pour DST */
  version: string | null;
  label: string;
  stitches: PlanStitch[];
  threads: Thread[];
  warnings: string[];
}

export class EmbroideryReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbroideryReadError";
  }
}

/** 64 couleurs d'affichage PEC (indices 1 à 64), injectées par l'appelant pour éviter un cycle. */
export type PecPalette = { rgb: string; name: string; code?: string }[];

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, Math.min(b.length, start + len)));

export function detectFormat(bytes: Uint8Array): "PES" | "DST" | null {
  if (bytes.length >= 8 && ascii(bytes, 0, 4) === "#PES") return "PES";
  if (bytes.length >= 512 && ascii(bytes, 0, 3) === "LA:") return "DST";
  return null;
}

// ---------------------------------------------------------------- PES / PEC

export function readPES(bytes: Uint8Array, pecPalette: PecPalette): ReadResult {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "#PES") throw new EmbroideryReadError("En-tête PES absent.");
  const version = ascii(bytes, 4, 4);
  if (!/^\d{4}$/.test(version)) throw new EmbroideryReadError("Version PES illisible.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pecStart = dv.getUint32(8, true);
  if (pecStart < 12 || pecStart + 532 > bytes.length) throw new EmbroideryReadError("Section PEC hors du fichier.");
  if (ascii(bytes, pecStart, 3) !== "LA:") throw new EmbroideryReadError("Section PEC invalide (LA: absent).");

  const label = ascii(bytes, pecStart + 3, 16).replace(/\s+$/, "");
  const colorCount = bytes[pecStart + 48] + 1;
  const threads: Thread[] = [];
  for (let i = 0; i < colorCount; i++) {
    const idx = bytes[pecStart + 49 + i];
    const c = pecPalette[(idx - 1 + pecPalette.length) % pecPalette.length] ?? { rgb: "#000000", name: "?" };
    threads.push({ rgb: c.rgb, name: c.name, brand: "Brother (PEC)", code: String(idx) });
  }

  // Bloc graphique : 512 octets après « LA: », puis 20 octets d'en-tête de points.
  const blockStart = pecStart + 512;
  const stitchStart = blockStart + 20;
  const { stitches, warnings } = decodePecStitches(bytes, stitchStart);
  // Les points PEC sont relatifs au coin du motif : on recentre comme le fait la machine.
  return { format: "PES", version, label, stitches, threads, warnings };
}

function decodePecStitches(b: Uint8Array, start: number) {
  const stitches: PlanStitch[] = [];
  const warnings: string[] = [];
  let x = 0;
  let y = 0;
  let i = start;
  let ended = false;
  const push = (c: StitchCommand) => stitches.push({ x: x / 10, y: y / 10, c });
  while (i < b.length) {
    const v1 = b[i];
    const v2 = b[i + 1];
    if (v1 === undefined) break;
    if (v1 === 0xff && (v2 === 0x00 || v2 === undefined)) {
      ended = true;
      push(CMD.END);
      break;
    }
    if (v1 === 0xfe && v2 === 0xb0) {
      i += 3;
      push(CMD.COLOR_CHANGE);
      continue;
    }
    let jump = false;
    let trim = false;
    let dx: number;
    let dy: number;
    if (v1 & 0x80) {
      if (v1 & 0x20) trim = true;
      if (v1 & 0x10) jump = true;
      dx = ((v1 & 0x0f) << 8) | v2;
      if (dx & 0x800) dx -= 0x1000;
      i += 2;
    } else {
      dx = v1 > 0x3f ? v1 - 0x80 : v1;
      i += 1;
    }
    const w1 = b[i];
    const w2 = b[i + 1];
    if (w1 === undefined) break;
    if (w1 & 0x80) {
      if (w1 & 0x20) trim = true;
      if (w1 & 0x10) jump = true;
      dy = ((w1 & 0x0f) << 8) | w2;
      if (dy & 0x800) dy -= 0x1000;
      i += 2;
    } else {
      dy = w1 > 0x3f ? w1 - 0x80 : w1;
      i += 1;
    }
    x += dx;
    y += dy;
    if (trim) push(CMD.TRIM);
    push(jump || trim ? CMD.JUMP : CMD.STITCH);
  }
  if (!ended) warnings.push("Fin de motif (FF 00) absente : fichier tronqué ?");
  return { stitches, warnings };
}

// ---------------------------------------------------------------- DST

const bit = (v: number, n: number) => (v >> n) & 1;

function dstDx(b0: number, b1: number, b2: number) {
  return (
    81 * (bit(b2, 2) - bit(b2, 3)) +
    27 * (bit(b1, 2) - bit(b1, 3)) +
    9 * (bit(b0, 2) - bit(b0, 3)) +
    3 * (bit(b1, 0) - bit(b1, 1)) +
    (bit(b0, 0) - bit(b0, 1))
  );
}

function dstDy(b0: number, b1: number, b2: number) {
  const up =
    81 * (bit(b2, 5) - bit(b2, 4)) +
    27 * (bit(b1, 5) - bit(b1, 4)) +
    9 * (bit(b0, 5) - bit(b0, 4)) +
    3 * (bit(b1, 7) - bit(b1, 6)) +
    (bit(b0, 7) - bit(b0, 6));
  return -up;
}

/** Couleurs d'affichage par défaut : un fichier DST ne contient aucune couleur. */
const DST_DISPLAY = ["#5A3A28", "#B87333", "#2F6F6A", "#C4504A", "#3A5BA0", "#8E7CC3", "#D8B892", "#4C7A3A"];

export function readDST(bytes: Uint8Array): ReadResult {
  if (bytes.length < 512 || ascii(bytes, 0, 3) !== "LA:") throw new EmbroideryReadError("En-tête DST absent.");
  const header = ascii(bytes, 0, 512);
  const label = (header.match(/LA:([^\r]*)/)?.[1] ?? "").slice(0, 16).trim();
  const stitches: PlanStitch[] = [];
  const warnings: string[] = [];
  let x = 0;
  let y = 0;
  let colors = 1;
  let ended = false;
  for (let i = 512; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    if ((b2 & 0b11110011) === 0b11110011) {
      stitches.push({ x: x / 10, y: y / 10, c: CMD.END });
      ended = true;
      break;
    }
    x += dstDx(b0, b1, b2);
    y += dstDy(b0, b1, b2);
    if ((b2 & 0b11000011) === 0b11000011) {
      colors++;
      stitches.push({ x: x / 10, y: y / 10, c: CMD.COLOR_CHANGE });
    } else if ((b2 & 0b10000011) === 0b10000011) {
      stitches.push({ x: x / 10, y: y / 10, c: CMD.JUMP });
    } else {
      stitches.push({ x: x / 10, y: y / 10, c: CMD.STITCH });
    }
  }
  if (!ended) warnings.push("Fin de motif DST absente : fichier tronqué ?");
  const threads: Thread[] = Array.from({ length: colors }, (_, k) => ({
    rgb: DST_DISPLAY[k % DST_DISPLAY.length],
    name: `Fil ${k + 1}`,
    brand: "",
    code: "",
  }));
  warnings.push("DST : le fichier ne contient pas de couleurs ; celles de l'aperçu sont indicatives.");
  return { format: "DST", version: null, label, stitches, threads, warnings };
}

export function readEmbroidery(bytes: Uint8Array, pecPalette: PecPalette): ReadResult {
  const fmt = detectFormat(bytes);
  if (fmt === "PES") return readPES(bytes, pecPalette);
  if (fmt === "DST") return readDST(bytes);
  throw new EmbroideryReadError("Format non reconnu : seuls PES et DST sont acceptés.");
}
