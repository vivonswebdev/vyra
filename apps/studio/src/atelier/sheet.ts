// Atelier vêtement : la « feuille » du patron, en centimètres. Deux assemblages côte à côte : le devant avec la
// moitié avant des deux manches, puis le dos (vue extérieure) avec leur moitié arrière, les manches posées à
// l'angle des bras de la forme fantôme. C'est la feuille que montre le patron 2D, et celle où se posent les
// motifs continus (« tout le vêtement ») : un motif qui chevauche plusieurs pièces sur la feuille se retrouve, sur
// le vêtement cousu, continu à travers les coutures (côtés, épaules, dessus et dessous de manche).
//
// Pur (aucun accès au DOM) : partagé par la texture, le patron 2D, la vue 3D et les tests.
import { ARM_ANGLE, type Garment, type PieceId } from "./garments.js";

/** Transformation affine 2D, mêmes conventions que DOMMatrix : x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m × n : applique n d'abord, puis m (comme DOMMatrix.multiply). */
export function mul(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
  };
}
export function inverse(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}
export const translate = (m: Affine, x: number, y: number) => mul(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const scale = (m: Affine, sx: number, sy: number) => mul(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export function rotate(m: Affine, deg: number): Affine {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  return mul(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
}
export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

export interface SheetExtent { frontX: number; backX: number; top: number; w: number; h: number }

/** Dimensions de la feuille (cm) et position des deux assemblages. */
export function sheetExtent(g: Garment): SheetExtent {
  const reach = Math.sin(ARM_ANGLE) * g.L + (Math.cos(ARM_ANGLE) * g.circ) / 2;
  const half = g.W / 2 + reach + 2, gap = 8;
  const drop = Math.cos(ARM_ANGLE) * g.L + 6;
  return { frontX: half, backX: half * 3 + gap, top: 6, w: half * 4 + gap, h: Math.max(g.H, drop + 4) + (g.hood ? 34 : 0) + 12 };
}

export interface SheetPiece {
  kind: "body" | "sleeve" | "hood";
  piece: PieceId | "plain";
  /** Feuille ← pièce (coordonnées de pièce : x depuis le milieu, y depuis le haut, en cm). */
  M: Affine;
  /** Manches : moitié du tube montrée (1 = avant, x ≥ 0 ; -1 = arrière, x ≤ 0). */
  sgn: 1 | -1;
}

/** Pièces posées sur la feuille, dans l'ordre de dessin (manches sous les corps). */
export function sheetPieces(g: Garment): SheetPiece[] {
  const e = sheetExtent(g);
  const deg = (ARM_ANGLE * 180) / Math.PI;
  const out: SheetPiece[] = [];
  for (const [view, cx] of [["front", e.frontX], ["back", e.backX]] as const) {
    out.push({ kind: "body", piece: view, M: translate(IDENTITY, cx, e.top), sgn: 1 });
    for (const side of [1, -1] as const) {
      // Devant : la manche gauche du porteur est à droite du lecteur ; dos (vue extérieure) : l'inverse.
      const piece: PieceId = view === "front" ? (side > 0 ? "sleeveL" : "sleeveR") : side > 0 ? "sleeveR" : "sleeveL";
      const sgn = view === "front" ? 1 : -1;
      let M = translate(IDENTITY, cx + side * (g.W / 2 - 1), e.top + 4.2);
      M = rotate(M, side > 0 ? -deg : deg);
      M = scale(M, (side > 0 ? -1 : 1) * sgn, 1);
      out.push({ kind: "sleeve", piece, M, sgn });
    }
  }
  if (g.hood) out.push({ kind: "hood", piece: "plain", M: translate(IDENTITY, (e.frontX + e.backX) / 2, e.top + Math.max(g.H, Math.cos(ARM_ANGLE) * g.L + 8) + 20), sgn: 1 });
  // Ordre de dessin : manches d'abord, corps par-dessus, capuche à part.
  return [...out.filter((p) => p.kind === "sleeve"), ...out.filter((p) => p.kind === "body"), ...out.filter((p) => p.kind === "hood")];
}

/** Rectangle (coordonnées de pièce) imprimable par cette pose de pièce : pièce entière, ou moitié de manche. */
export function pieceClip(g: Garment, p: SheetPiece): { x: number; y: number; w: number; h: number } {
  if (p.kind === "sleeve") return { x: p.sgn > 0 ? 0 : -g.circ / 2, y: 0, w: g.circ / 2, h: g.L };
  return { x: -g.W / 2, y: 0, w: g.W, h: g.H };
}

/** Point de la feuille → pièce imprimable qui le contient (corps d'abord, puis manches), ou null. */
export function sheetToPiece(g: Garment, sx: number, sy: number): { piece: PieceId; x: number; y: number; at: SheetPiece } | null {
  const pieces = sheetPieces(g).filter((p) => p.kind !== "hood");
  for (const p of [...pieces].reverse()) {
    const [x, y] = apply(inverse(p.M), sx, sy), r = pieceClip(g, p);
    if (x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6 && y >= r.y - 1e-6 && y <= r.y + r.h + 1e-6) return { piece: p.piece as PieceId, x, y, at: p };
  }
  return null;
}

/** Point d'une pièce → feuille. Manches : la moitié avant (x ≥ 0) est sur l'assemblage devant, l'autre au dos. */
export function pieceToSheet(g: Garment, piece: PieceId, x: number, y: number): [number, number] {
  const p = sheetPieces(g).find((q) => q.piece === piece && (q.kind === "body" || q.sgn === (x >= 0 ? 1 : -1)))!;
  return apply(p.M, x, y);
}

/** Garde un élément (w × h) sur la feuille. */
export function clampToSheet(g: Garment, x: number, y: number, w = 0, h = 0): [number, number] {
  const e = sheetExtent(g);
  const hx = Math.min(w / 2, e.w / 2), hy = Math.min(h / 2, e.h / 2);
  return [Math.max(hx, Math.min(e.w - hx, x)), Math.max(hy, Math.min(e.h - hy, y))];
}
