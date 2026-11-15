// Atelier vêtement : modèles de vêtements et géométrie des pièces de patron (en centimètres).
// Tout ce fichier est pur (aucun accès au DOM) : il est partagé par la simulation, la texture et le patron 2D.

export type GarmentId = "tee" | "sweat" | "hoodie";
export type PieceId = "front" | "back" | "sleeveL" | "sleeveR";
export const PIECES: PieceId[] = ["front", "back", "sleeveL", "sleeveR"];

export interface Garment {
  id: GarmentId;
  /** Demi-tour de poitrine (largeur de la pièce devant), en cm. */
  W: number;
  /** Longueur du corps, de la ligne d'épaule à l'ourlet, en cm. */
  H: number;
  /** Longueur de manche, en cm. */
  L: number;
  /** Tour de manche à l'emmanchure et au poignet, en cm. */
  circ: number;
  cuff: number;
  /** Clé de traduction du tissu. */
  fabric: string;
  rib: boolean;
  hood: boolean;
  neckDrop: number;
  neckDropBack: number;
}

export const GARMENTS: Record<GarmentId, Garment> = {
  tee: { id: "tee", W: 54, H: 72, L: 21, circ: 44, cuff: 40, fabric: "at.fabric.tee", rib: false, hood: false, neckDrop: 8, neckDropBack: 2.2 },
  sweat: { id: "sweat", W: 58, H: 67, L: 60, circ: 42, cuff: 22, fabric: "at.fabric.sweat", rib: true, hood: false, neckDrop: 8.5, neckDropBack: 2.4 },
  hoodie: { id: "hoodie", W: 60, H: 70, L: 61, circ: 44, cuff: 22, fabric: "at.fabric.hoodie", rib: true, hood: true, neckDrop: 9, neckDropBack: 2.6 },
};

/** Pixels de texture par centimètre (1,6 px/mm : assez pour lire les points de broderie). */
export const PX_PER_CM = 16;
/** Angle des bras de la forme fantôme, depuis la verticale (pose en A). */
export const ARM_ANGLE = (50 * Math.PI) / 180;

export interface Region {
  x0: number;
  y0: number;
  w: number;
  h: number;
}
export interface Layout {
  regions: Record<PieceId | "plain", Region>;
  /** Taille de l'atlas de texture, en cm. */
  width: number;
  height: number;
}

/**
 * Atlas de texture : devant | dos | manche gauche | manche droite, côte à côte ; une bande unie dessous
 * (capuche). Le devant et le dos se suivent : la coordonnée horizontale de l'atlas est linéaire sur tout le
 * tour du corps, ce qui évite toute couture de texture sur les flancs.
 */
export function layoutFor(g: Garment): Layout {
  const hmax = Math.max(g.H, g.L);
  return {
    regions: {
      front: { x0: 0, y0: 0, w: g.W, h: g.H },
      back: { x0: g.W, y0: 0, w: g.W, h: g.H },
      sleeveL: { x0: 2 * g.W, y0: 0, w: g.circ, h: g.L },
      sleeveR: { x0: 2 * g.W + g.circ, y0: 0, w: g.circ, h: g.L },
      plain: { x0: 0, y0: hmax, w: 20, h: 10 },
    },
    width: 2 * g.W + 2 * g.circ,
    height: hmax + 10,
  };
}

/**
 * Bord haut d'une pièce de corps (devant ou dos), en cm sous la ligne d'épaule, pour x mesuré depuis le
 * milieu de la pièce : encolure au centre, pente d'épaule vers les côtés.
 */
export function topEdge(g: Garment, x: number, back: boolean): number {
  const nw = g.W * 0.2;
  const drop = back ? g.neckDropBack : g.neckDrop;
  const sh = 4.2;
  const ax = Math.abs(x);
  if (ax < nw) return drop * Math.sqrt(Math.max(0, 1 - (ax / nw) ** 2));
  return sh * Math.min(1, (ax - nw) / (g.W / 2 - nw)) ** 1.1;
}

/** Coordonnées d'une pièce (x depuis le milieu, y depuis le haut, en cm) → position dans l'atlas (cm). */
export function pieceToAtlas(layout: Layout, piece: PieceId | "plain", x: number, y: number): [number, number] {
  const r = layout.regions[piece];
  return [r.x0 + r.w / 2 + x, r.y0 + y];
}

/** Position dans l'atlas (cm) → pièce et coordonnées de pièce ; null hors des pièces imprimables. */
export function atlasToPiece(layout: Layout, u: number, v: number): { piece: PieceId; x: number; y: number } | null {
  for (const piece of PIECES) {
    const r = layout.regions[piece];
    if (u >= r.x0 && u <= r.x0 + r.w && v >= r.y0 && v <= r.y0 + r.h) return { piece, x: u - r.x0 - r.w / 2, y: v - r.y0 };
  }
  return null;
}

/** Garde un élément de taille (w, h) entièrement dans sa pièce, quand c'est possible. */
export function clampToPiece(layout: Layout, piece: PieceId, x: number, y: number, w = 0, h = 0): [number, number] {
  const r = layout.regions[piece];
  const hx = Math.min(w / 2, r.w / 2), hy = Math.min(h / 2, r.h / 2);
  return [Math.max(-r.w / 2 + hx, Math.min(r.w / 2 - hx, x)), Math.max(hy, Math.min(r.h - hy, y))];
}
