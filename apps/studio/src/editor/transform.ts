// Transformations d'objets par poignées (mise à l'échelle, rotation) et presse-papiers d'objets.
// Fonctions pures, testées sans navigateur ; le moteur figé n'est pas modifié : on transforme seulement les
// points du document (mapObjectPoints), comme le faisait déjà le panneau « Objet ».
import { mapObjectPoints, type Design, type DesignObject, type Point, type Thread } from "@vyra/engine";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
/** Transformation autour d'un point : facteur d'échelle `k`, rotation `a` en radians. */
export interface Affine {
  cx: number;
  cy: number;
  k: number;
  a: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
/** Plus petite dimension autorisée après réduction (mm) : en dessous, l'objet ne serait plus brodable. */
export const MIN_SIZE_MM = 0.5;
export const ROTATE_SNAP = Math.PI / 12; // 15°

export function transformPoint(p: Point, t: Affine): Point {
  const x = (p.x - t.cx) * t.k;
  const y = (p.y - t.cy) * t.k;
  const cos = Math.cos(t.a);
  const sin = Math.sin(t.a);
  return { x: t.cx + x * cos - y * sin, y: t.cy + x * sin + y * cos };
}

export function transformObject(o: DesignObject, t: Affine): DesignObject {
  return mapObjectPoints(o, (p) => transformPoint(p, t));
}

// ---------------------------------------------------------------- Poignées

export type HandleId = "nw" | "ne" | "se" | "sw" | "rot";
export const CORNERS: Exclude<HandleId, "rot">[] = ["nw", "ne", "se", "sw"];
const OPPOSITE = { nw: "se", ne: "sw", se: "nw", sw: "ne" } as const;

export function cornerOf(b: Bounds, h: Exclude<HandleId, "rot">): Point {
  return { x: h === "nw" || h === "sw" ? b.minX : b.maxX, y: h === "nw" || h === "ne" ? b.minY : b.maxY };
}
export function oppositeCorner(b: Bounds, h: Exclude<HandleId, "rot">): Point {
  return cornerOf(b, OPPOSITE[h]);
}

/** Position des poignées à l'écran (pixels) : coins du cadre de sélection (marge `pad`) et rotation au-dessus. */
export function handlePositions(b: Bounds, view: { scale: number; ox: number; oy: number }, pad = 4, rotOffset = 26): Record<HandleId, Point> {
  const x0 = b.minX * view.scale + view.ox - pad;
  const y0 = b.minY * view.scale + view.oy - pad;
  const x1 = b.maxX * view.scale + view.ox + pad;
  const y1 = b.maxY * view.scale + view.oy + pad;
  return { nw: { x: x0, y: y0 }, ne: { x: x1, y: y0 }, se: { x: x1, y: y1 }, sw: { x: x0, y: y1 }, rot: { x: (x0 + x1) / 2, y: y0 - rotOffset } };
}

/** Poignée sous le pointeur (coordonnées écran), la plus proche dans la tolérance. */
export function hitHandle(handles: Record<HandleId, Point>, p: Point, tolerance: number): HandleId | null {
  let best: HandleId | null = null;
  let bd = tolerance;
  for (const [id, q] of Object.entries(handles) as [HandleId, Point][]) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= bd) {
      best = id;
      bd = d;
    }
  }
  return best;
}

/**
 * Facteur d'échelle uniforme quand on tire un coin : projection du déplacement sur la diagonale depuis le coin
 * opposé (fixe). Borné, et l'objet ne descend pas sous MIN_SIZE_MM.
 */
export function scaleFromDrag(anchor: Point, start: Point, p: Point, b: Bounds): number {
  const vx = start.x - anchor.x;
  const vy = start.y - anchor.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return 1;
  let k = ((p.x - anchor.x) * vx + (p.y - anchor.y) * vy) / len2;
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const minK = size > 0 ? Math.max(MIN_SCALE, MIN_SIZE_MM / size) : MIN_SCALE;
  if (!Number.isFinite(k)) k = 1;
  return Math.min(MAX_SCALE, Math.max(minK, k));
}

/** Angle de rotation (radians, entre -π et π) autour du centre ; `snap` arrondit à 15°. */
export function rotationFromDrag(c: Point, start: Point, p: Point, snap: boolean): number {
  let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x);
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  if (snap) a = Math.round(a / ROTATE_SNAP) * ROTATE_SNAP;
  return a;
}

// ---------------------------------------------------------------- Presse-papiers d'objets

export interface ClipItem {
  object: DesignObject;
  thread: Thread;
}

export function nextObjectId(design: Design): string {
  let n = 0;
  for (const o of design.objects) {
    const m = /^obj(\d+)$/.exec(o.id);
    if (m) n = Math.max(n, +m[1]);
  }
  return "obj" + (n + 1);
}

export function copyItem(design: Design, id: string): ClipItem | null {
  const o = design.objects.find((x) => x.id === id);
  if (!o) return null;
  const thread = design.threads[o.color] ?? { rgb: "#000000", name: "", brand: "", code: "" };
  return { object: structuredClone(o), thread: { ...thread } };
}

const sameThread = (a: Thread, b: Thread) => a.rgb.toLowerCase() === b.rgb.toLowerCase() && a.brand === b.brand && a.code === b.code;
export const MAX_THREADS = 255;

/**
 * Colle un objet : nouvel identifiant, décalage de `offsetMm`, placé au-dessus des autres. Le fil est retrouvé
 * dans le motif (même couleur, marque, référence) ou ajouté ; s'il n'y a plus de place, le fil le plus proche
 * est utilisé. Renvoie le nouveau document et l'identifiant créé.
 */
export function pasteItem(design: Design, item: ClipItem, offsetMm: number, name: string): { design: Design; id: string } {
  let threads = design.threads;
  let color = threads.findIndex((t) => sameThread(t, item.thread));
  if (color < 0) {
    if (threads.length < MAX_THREADS) {
      threads = [...threads, { ...item.thread }];
      color = threads.length - 1;
    } else color = nearestThread(threads, item.thread.rgb);
  }
  const id = nextObjectId(design);
  const moved = mapObjectPoints(structuredClone(item.object), (p) => ({ x: p.x + offsetMm, y: p.y + offsetMm }));
  const obj: DesignObject = { ...moved, id, name: name.slice(0, 80), color };
  return { design: { ...design, threads, objects: [...design.objects, obj] }, id };
}

function nearestThread(threads: Thread[], rgb: string): number {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = c(rgb);
  let best = 0;
  let bd = Infinity;
  threads.forEach((t, i) => {
    const [r2, g2, b2] = c(t.rgb);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Vérification minimale d'un élément relu depuis le stockage de session. */
export function isClipItem(x: unknown): x is ClipItem {
  const v = x as ClipItem;
  return !!v && typeof v === "object" && !!v.object && typeof v.object.id === "string" && !!v.thread && typeof v.thread.rgb === "string" && /^#[0-9a-fA-F]{6}$/.test(v.thread.rgb);
}
