// Atelier vêtement : texture du vêtement (« atlas »), dessinée à plat en centimètres puis plaquée sur le tissu
// simulé et reprise telle quelle par le patron 2D. Contient : fond de tissu (plan quadrillé ou tissu teint),
// côtes, coutures, poche, impressions de texte (sérigraphie ou gonflant) et broderie du projet, plus une carte
// de relief (tricot, encre, points de broderie).
import { type Garment, type Layout, type PieceId, PX_PER_CM as S, topEdge } from "./garments.js";
import { inverse, pieceClip, sheetPieces } from "./sheet.js";
import { paintFolds } from "./folds.js";

export type FontId = "anton" | "unbounded" | "bodoni" | "fraunces" | "caveat" | "mono" | "inter";
export const FONTS: { id: FontId; name: string; css: string; weight: string; style: string }[] = [
  { id: "anton", name: "Anton", css: '"Anton", Impact, sans-serif', weight: "400", style: "normal" },
  { id: "unbounded", name: "Unbounded", css: '"Unbounded", "Arial Black", sans-serif', weight: "800", style: "normal" },
  { id: "bodoni", name: "Bodoni Moda", css: '"Bodoni Moda", Didot, serif', weight: "600", style: "normal" },
  { id: "fraunces", name: "Fraunces", css: '"Fraunces", Georgia, serif', weight: "500", style: "italic" },
  { id: "caveat", name: "Caveat", css: '"Caveat", "Comic Sans MS", cursive', weight: "600", style: "normal" },
  { id: "mono", name: "JetBrains Mono", css: '"JetBrains Mono", Menlo, monospace', weight: "700", style: "normal" },
  { id: "inter", name: "Inter", css: '"Inter Variable", "Inter", system-ui, sans-serif', weight: "700", style: "normal" },
];

/**
 * Emplacement d'un calque : une pièce (coordonnées de pièce, en cm), ou « sheet » : la feuille du patron entière
 * (motif continu, coordonnées de feuille, voir sheet.ts), qui traverse les coutures.
 */
export type Placement = PieceId | "sheet";
interface LayerBase { id: number; piece: Placement; x: number; y: number; rotate: number; visible: boolean }
export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  font: FontId;
  layout: "box" | "arc" | "circle";
  align: "left" | "center" | "right" | "justify";
  /** Hauteur des capitales, en cm. */
  cap: number;
  /** Largeur du bloc (ou diamètre du cercle), en cm. */
  width: number;
  bend: number;
  leading: number;
  tracking: number;
  ink: string;
  /** Encre choisie automatiquement (lisible sur le fond) : elle suit la couleur du vêtement. Faux dès qu'une encre est choisie à la main. */
  autoInk?: boolean;
  opacity: number;
}
export interface EmbroideryLayer extends LayerBase { kind: "embroidery"; piece: PieceId }
/** Image importée (PNG, JPG, WEBP), imprimée en impression numérique : largeur en cm, proportions gardées. */
export interface ImageLayer extends LayerBase {
  kind: "image";
  /** Image réduite et encodée (data URL) : elle reste dans le navigateur. */
  src: string;
  name: string;
  w: number;
  /** Hauteur / largeur de l'image. */
  aspect: number;
  opacity: number;
}
/** Forme pleine (bande, triangle, disque), pour composer des motifs. */
export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: "rect" | "triangle" | "circle";
  w: number;
  h: number;
  fill: string;
  opacity: number;
}
export type AtelierLayer = TextLayer | EmbroideryLayer | ImageLayer | ShapeLayer;

/** Broderie du projet, rendue point par point par le moteur, avec sa taille réelle. */
export interface EmbroideryArt { canvas: HTMLCanvasElement; wCm: number; hCm: number }

export type RenderMode = "blueprint" | "fabric";
export type PrintType = "screen" | "puff";

export interface AtlasInput {
  garment: Garment;
  layout: Layout;
  render: RenderMode;
  colorway: string;
  printType: PrintType;
  layers: AtelierLayer[];
  embroidery: EmbroideryArt | null;
  /** Images décodées des calques image, par identifiant de calque (absente tant qu'elle se décode). */
  images?: Map<number, CanvasImageSource>;
  /** Libellés imprimés sur le plan (traduits par la page). */
  labels: { front: string; back: string };
  /** Intensité des plis peints (0 à 1) ; 0,6 par défaut. */
  wrinkles?: number;
}

export function fontOf(id: FontId) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

// ------------------------------------------------------------------ Mise en page du texte (en cm)
function setFont(ctx: CanvasRenderingContext2D, id: FontId) {
  const f = fontOf(id);
  ctx.font = `${f.style} ${f.weight} 100px ${f.css}`;
}
function measure(ctx: CanvasRenderingContext2D, str: string, track: number) {
  const chars = [...str];
  const adv = chars.map((ch) => ctx.measureText(ch).width + track * 100);
  const w = adv.reduce((a, b) => a + b, 0) - (chars.length ? track * 100 : 0);
  return { chars, adv, w };
}
function drawChars(ctx: CanvasRenderingContext2D, m: ReturnType<typeof measure>) {
  let cx = 0;
  m.chars.forEach((ch, i) => { ctx.fillText(ch, cx, 0); cx += m.adv[i]; });
}

/** Met en page un texte centré sur (0, 0) ; le dessine si `draw`. Retourne sa boîte, en cm. */
export function layoutText(ctx: CanvasRenderingContext2D, L: TextLayer, draw: boolean): { w: number; h: number } {
  setFont(ctx, L.font);
  const k = L.cap / 0.72 / 100; // taille du corps depuis la hauteur de capitale ; mesures faites à 100 px
  const asc = L.cap;
  if (L.layout === "arc") {
    const line = L.text.replace(/\s+/g, " ").trim();
    const m = measure(ctx, line, L.tracking);
    const tw = m.adv.reduce((a, v) => a + v, 0) * k;
    if (Math.abs(L.bend) < 0.02 || !tw) {
      if (draw) { ctx.save(); ctx.translate(-(m.w * k) / 2, asc / 2); ctx.scale(k, k); drawChars(ctx, m); ctx.restore(); }
      return { w: m.w * k, h: asc * 1.3 };
    }
    const A = Math.min(Math.abs(L.bend) * Math.PI * 1.1, Math.PI * 1.6);
    const R = tw / A, sgn = Math.sign(L.bend);
    const sag = R * (1 - Math.cos(A / 2));
    if (draw) {
      let a = -A / 2;
      m.chars.forEach((ch, i) => {
        const cw = m.adv[i] * k, am = a + cw / 2 / R;
        ctx.save();
        ctx.translate(R * Math.sin(am), sgn * R * (1 - Math.cos(am)) - (sgn * sag) / 2 + asc / 2);
        ctx.rotate(sgn * am);
        ctx.scale(k, k);
        ctx.fillText(ch, -m.adv[i] / 2, 0);
        ctx.restore();
        a += cw / R;
      });
    }
    return { w: A < Math.PI ? 2 * R * Math.sin(A / 2) : 2 * R, h: sag + asc * 1.4 };
  }
  const lh = L.cap * 1.38 * L.leading;
  const rows = L.layout === "circle" ? Math.max(1, Math.round(L.width / lh)) : 0;
  const widthAt = (i: number) => {
    if (L.layout !== "circle") return L.width;
    const r = L.width / 2, yc = (-rows * lh) / 2 + lh * (i + 0.5);
    return Math.max(0, 2 * Math.sqrt(Math.max(0, r * r - yc * yc)) - L.cap * 0.4);
  };
  const lines: string[] = [];
  for (const para of L.text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && measure(ctx, next, L.tracking).w * k > widthAt(lines.length)) { lines.push(cur); cur = word; }
      else cur = next;
    }
    lines.push(cur);
  }
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  const h = L.layout === "circle" ? L.width : lines.length * lh;
  if (draw) {
    lines.forEach((ln, i) => {
      const avail = widthAt(i);
      const y = -h / 2 + lh * i + lh / 2 + asc / 2;
      if (L.align === "justify" && L.layout === "box" && i < lines.length - 1 && ln.includes(" ")) {
        const parts = ln.split(" "), pm = parts.map((p) => measure(ctx, p, L.tracking));
        const used = pm.reduce((a, p) => a + p.w * k, 0), gap = (avail - used) / (parts.length - 1);
        let x = -avail / 2;
        pm.forEach((p) => { ctx.save(); ctx.translate(x, y); ctx.scale(k, k); drawChars(ctx, p); ctx.restore(); x += p.w * k + gap; });
        return;
      }
      const m = measure(ctx, ln, L.tracking), lw = m.w * k;
      const x = L.layout === "circle" || L.align === "center" || L.align === "justify" ? -lw / 2 : L.align === "right" ? avail / 2 - lw : -avail / 2;
      ctx.save(); ctx.translate(x, y); ctx.scale(k, k); drawChars(ctx, m); ctx.restore();
    });
  }
  return { w: L.width, h: Math.max(h, lh) };
}

// ------------------------------------------------------------------ Atlas
function hexLum(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
}

export class Atlas {
  readonly canvas = document.createElement("canvas");
  readonly bump = document.createElement("canvas");
  /** Plis et ombres de contact (blanc = rien), même agencement que la texture ; repeints au changement de vêtement. */
  readonly folds = document.createElement("canvas");
  foldsVersion = 0;
  private foldsOf: Garment | null = null;
  private ink = document.createElement("canvas");
  private emb = document.createElement("canvas");
  /** Images et formes : impression numérique, nette (sans le grain de la sérigraphie). */
  private dye = document.createElement("canvas");
  private mask = document.createElement("canvas");
  private knit: CanvasPattern | null = null;
  private noise: CanvasPattern | null = null;
  /** Boîte (cm) de chaque calque au dernier rendu, pour la sélection. */
  readonly boxes = new Map<number, { w: number; h: number }>();
  /** Incrémenté à chaque rendu (les vues savent qu'il faut recopier la texture). */
  version = 0;

  private patterns(ctx: CanvasRenderingContext2D) {
    if (this.knit) return;
    const p = document.createElement("canvas");
    p.width = 6; p.height = 8;
    const c = p.getContext("2d")!;
    c.strokeStyle = "rgba(0,0,0,0.10)";
    c.beginPath(); c.moveTo(0, 0); c.lineTo(3, 4); c.lineTo(6, 0); c.moveTo(0, 4); c.lineTo(3, 8); c.lineTo(6, 4); c.stroke();
    this.knit = ctx.createPattern(p, "repeat");
    const n = document.createElement("canvas");
    n.width = n.height = 64;
    const e = n.getContext("2d")!, img = e.createImageData(64, 64);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) { seed = (seed * 16807) % 2147483647; img.data[i + 3] = seed % 100 < 18 ? 128 : 0; }
    e.putImageData(img, 0, 0);
    this.noise = ctx.createPattern(n, "repeat");
  }

  render(inp: AtlasInput) {
    const { garment: g, layout } = inp;
    const W = Math.ceil(layout.width * S), H = Math.ceil(layout.height * S);
    for (const c of [this.canvas, this.bump, this.ink, this.emb, this.dye, this.mask]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const actx = this.canvas.getContext("2d")!;
    this.patterns(actx);
    if (this.foldsOf !== g) { paintFolds(this.folds, g, layout); this.foldsOf = g; this.foldsVersion++; }
    this.base(actx, inp);

    // Impressions : textes (sérigraphie ou gonflant), images et formes (impression numérique), broderie.
    const ictx = this.ink.getContext("2d")!, ectx = this.emb.getContext("2d")!, dctx = this.dye.getContext("2d")!;
    for (const c of [ictx, ectx, dctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); }
    this.boxes.clear();
    const sheet = sheetPieces(g).filter((p) => p.kind !== "hood");
    for (const L of inp.layers) {
      const ctx = L.kind === "text" ? ictx : L.kind === "embroidery" ? ectx : dctx;
      // Un calque de pièce est dessiné une fois, dans sa pièce ; un motif continu, dans chaque pièce de la
      // feuille qu'il recouvre (passage feuille → pièce, découpé au contour de la pièce).
      const frames = L.piece === "sheet"
        ? sheet.map((p) => ({ piece: p.piece as PieceId, pre: inverse(p.M), clip: pieceClip(g, p) }))
        : [{ piece: L.piece, pre: null, clip: { x: -layout.regions[L.piece].w / 2, y: 0, w: layout.regions[L.piece].w, h: layout.regions[L.piece].h } }];
      for (const f of frames) {
        const r = layout.regions[f.piece];
        ctx.save();
        ctx.setTransform(S, 0, 0, S, (r.x0 + r.w / 2) * S, r.y0 * S);
        ctx.beginPath(); ctx.rect(f.clip.x, f.clip.y, f.clip.w, f.clip.h); ctx.clip();
        if (f.pre) ctx.transform(f.pre.a, f.pre.b, f.pre.c, f.pre.d, f.pre.e, f.pre.f);
        ctx.translate(L.x, L.y); ctx.rotate((L.rotate * Math.PI) / 180);
        const box = this.drawLayer(ctx, L, inp);
        if (box) this.boxes.set(L.id, box);
        ctx.restore();
      }
    }
    if (inp.printType === "screen") {
      ictx.globalCompositeOperation = "destination-out"; ictx.globalAlpha = 0.3; ictx.fillStyle = this.noise!;
      ictx.fillRect(0, 0, W, H);
      ictx.globalAlpha = 1; ictx.globalCompositeOperation = "source-over";
    }
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.drawImage(this.dye, 0, 0);
    actx.save();
    if (inp.printType === "puff") { actx.shadowColor = "rgba(0,0,0,.28)"; actx.shadowBlur = 6; actx.shadowOffsetY = 2; }
    actx.drawImage(this.ink, 0, 0);
    actx.restore();
    // Broderie : légère ombre portée (épaisseur des fils).
    actx.save(); actx.shadowColor = "rgba(0,0,0,.30)"; actx.shadowBlur = 3; actx.shadowOffsetY = 1; actx.drawImage(this.emb, 0, 0); actx.restore();

    // Relief : tricot, puis encre (selon la technique), puis broderie (points visibles).
    const b = this.bump.getContext("2d")!;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = "#808080"; b.fillRect(0, 0, W, H);
    b.globalAlpha = inp.render === "blueprint" ? 0.25 : 0.9; b.fillStyle = this.knit!; b.fillRect(0, 0, W, H); b.globalAlpha = 1;
    // Plis : les creux abaissent le relief (rendu tissu seulement).
    const wr = inp.render === "fabric" ? (inp.wrinkles ?? 0.6) : 0;
    if (wr > 0) { b.save(); b.globalCompositeOperation = "multiply"; b.globalAlpha = wr; b.drawImage(this.folds, 0, 0); b.restore(); }
    const m = this.mask.getContext("2d")!;
    const relief = (src: HTMLCanvasElement, amount: number, blur: number) => {
      m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, W, H);
      m.globalCompositeOperation = "source-over"; m.drawImage(src, 0, 0);
      m.globalCompositeOperation = "source-in"; m.fillStyle = "#fff"; m.fillRect(0, 0, W, H);
      m.globalCompositeOperation = "source-over";
      b.save(); b.globalAlpha = amount; if (blur) b.filter = `blur(${blur}px)`; b.drawImage(this.mask, 0, 0); b.restore();
    };
    relief(this.ink, inp.printType === "puff" ? 1 : 0.18, inp.printType === "puff" ? 5 : 0);
    relief(this.dye, 0.06, 0);
    relief(this.emb, 0.85, 1);
    b.save(); b.globalCompositeOperation = "multiply"; b.drawImage(this.emb, 0, 0); b.restore();
    this.version++;
  }

  /** Dessine un calque centré sur (0, 0), en cm ; retourne sa boîte (cm), ou null si rien à mesurer. */
  private drawLayer(ctx: CanvasRenderingContext2D, L: AtelierLayer, inp: AtlasInput): { w: number; h: number } | null {
    if (L.kind === "text") {
      ctx.fillStyle = L.ink; ctx.globalAlpha = L.opacity; ctx.textBaseline = "alphabetic";
      return layoutText(ctx, L, L.visible);
    }
    if (L.kind === "embroidery") {
      if (!inp.embroidery) return null;
      const { canvas, wCm, hCm } = inp.embroidery;
      if (L.visible) { ctx.imageSmoothingQuality = "high"; ctx.drawImage(canvas, -wCm / 2, -hCm / 2, wCm, hCm); }
      return { w: wCm, h: hCm };
    }
    if (L.kind === "image") {
      const h = L.w * L.aspect, img = inp.images?.get(L.id);
      if (L.visible && img) { ctx.globalAlpha = L.opacity; ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, -L.w / 2, -h / 2, L.w, h); }
      return { w: L.w, h };
    }
    if (L.visible) {
      ctx.globalAlpha = L.opacity; ctx.fillStyle = L.fill;
      ctx.beginPath();
      if (L.shape === "rect") ctx.rect(-L.w / 2, -L.h / 2, L.w, L.h);
      else if (L.shape === "triangle") { ctx.moveTo(0, -L.h / 2); ctx.lineTo(L.w / 2, L.h / 2); ctx.lineTo(-L.w / 2, L.h / 2); ctx.closePath(); }
      else ctx.ellipse(0, 0, L.w / 2, L.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return { w: L.w, h: L.h };
  }

  private base(ctx: CanvasRenderingContext2D, inp: AtlasInput) {
    const { garment: g, layout } = inp;
    const blue = inp.render === "blueprint";
    const base = blue ? "#fbfcfd" : inp.colorway;
    const dark = hexLum(base) < 0.45;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = base; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const key of ["front", "back", "sleeveL", "sleeveR", "plain"] as const) {
      const r = layout.regions[key];
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x0 * S, r.y0 * S, r.w * S, r.h * S); ctx.clip();
      if (blue) {
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= r.w; gx++) {
          ctx.strokeStyle = gx % 5 === 0 ? "rgba(60,86,135,.30)" : "rgba(60,86,135,.12)";
          ctx.beginPath(); ctx.moveTo((r.x0 + gx) * S + 0.5, r.y0 * S); ctx.lineTo((r.x0 + gx) * S + 0.5, (r.y0 + r.h) * S); ctx.stroke();
        }
        for (let gy = 0; gy <= r.h; gy++) {
          ctx.strokeStyle = gy % 5 === 0 ? "rgba(60,86,135,.30)" : "rgba(60,86,135,.12)";
          ctx.beginPath(); ctx.moveTo(r.x0 * S, (r.y0 + gy) * S + 0.5); ctx.lineTo((r.x0 + r.w) * S, (r.y0 + gy) * S + 0.5); ctx.stroke();
        }
      } else {
        ctx.globalAlpha = dark ? 0.9 : 0.75;
        if (dark) ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = this.knit!; ctx.fillRect(r.x0 * S, r.y0 * S, r.w * S, r.h * S);
      }
      ctx.restore();
    }
    const ink = blue ? "rgba(60,86,135,.38)" : dark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.14)";
    const rib = (x0: number, y0: number, w: number, h: number) => {
      ctx.save();
      ctx.fillStyle = blue ? "rgba(205,214,228,.55)" : dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.05)";
      ctx.fillRect(x0 * S, y0 * S, w * S, h * S);
      ctx.strokeStyle = ink; ctx.lineWidth = 2;
      for (let x = x0; x < x0 + w; x += 0.45) { ctx.beginPath(); ctx.moveTo(x * S, y0 * S); ctx.lineTo(x * S, (y0 + h) * S); ctx.stroke(); }
      ctx.restore();
    };
    const ribH = g.rib ? 6 : 2;
    const { sleeveL, sleeveR } = layout.regions;
    rib(0, g.H - ribH, 2 * g.W, ribH);
    rib(sleeveL.x0, g.L - ribH, g.circ, ribH);
    rib(sleeveR.x0, g.L - ribH, g.circ, ribH);
    // Bande d'encolure.
    for (const back of [false, true]) {
      const r = back ? layout.regions.back : layout.regions.front;
      ctx.save(); ctx.setTransform(S, 0, 0, S, (r.x0 + r.w / 2) * S, 0);
      ctx.strokeStyle = blue ? "rgba(185,198,218,.9)" : dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)";
      ctx.lineWidth = g.hood ? 1.4 : 2.2;
      ctx.beginPath();
      for (let x = -g.W * 0.2; x <= g.W * 0.2 + 0.01; x += 0.5) { const y = topEdge(g, x, back) + 1.1; if (x === -g.W * 0.2) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.restore();
    }
    // Coutures (pointillés) et libellés du plan.
    ctx.save();
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = blue ? "rgba(60,86,135,.45)" : dark ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)";
    const seams = [1.2, 2 * g.W - 1.2, sleeveL.x0 + 0.8, sleeveL.x0 + g.circ - 0.8, sleeveR.x0 + 0.8, sleeveR.x0 + g.circ - 0.8];
    seams.forEach((x, i) => { ctx.beginPath(); ctx.moveTo(x * S, 0); ctx.lineTo(x * S, (i < 2 ? g.H : g.L) * S); ctx.stroke(); });
    ctx.setLineDash([]);
    if (blue) {
      ctx.fillStyle = "rgba(60,86,135,.55)"; ctx.font = `500 ${0.75 * S}px "JetBrains Mono", monospace`; ctx.textAlign = "center";
      ctx.fillText(inp.labels.front, (g.W / 2) * S, (g.H - ribH - 1.2) * S);
      ctx.fillText(inp.labels.back, g.W * 1.5 * S, (g.H - ribH - 1.2) * S);
    }
    ctx.restore();
    if (g.hood) {
      const r = layout.regions.front;
      ctx.save(); ctx.setTransform(S, 0, 0, S, (r.x0 + r.w / 2) * S, 0);
      const top = g.H - 31, bot = g.H - 6.5, wt = 13, wb = 18;
      ctx.beginPath(); ctx.moveTo(-wt, top); ctx.lineTo(wt, top); ctx.quadraticCurveTo(wt + 1, top + 8, wb, bot - 7); ctx.lineTo(wb, bot); ctx.lineTo(-wb, bot); ctx.lineTo(-wb, bot - 7); ctx.quadraticCurveTo(-wt - 1, top + 8, -wt, top); ctx.closePath();
      ctx.fillStyle = blue ? "rgba(225,231,240,.45)" : dark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.05)"; ctx.fill();
      ctx.setLineDash([0.35, 0.3]); ctx.lineWidth = 0.13; ctx.strokeStyle = blue ? "rgba(60,86,135,.7)" : dark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.35)"; ctx.stroke();
      ctx.setLineDash([]);
      for (const x of [-4.2, 4.2]) { ctx.beginPath(); ctx.arc(x, g.neckDrop + 2.2, 0.45, 0, Math.PI * 2); ctx.fillStyle = blue ? "#8d9ab0" : "rgba(0,0,0,.35)"; ctx.fill(); }
      ctx.restore();
    }
  }
}

/** Calque visible sous un point d'une pièce (le plus haut d'abord), d'après les boîtes du dernier rendu. */
export function hitTest(layers: AtelierLayer[], boxes: Map<number, { w: number; h: number }>, piece: PieceId, x: number, y: number, margin = 0.8): AtelierLayer | null {
  return pickLayer(layers, boxes, { sheet: null, piece: { piece, x, y } }, margin);
}

/**
 * Calque visible sous un point (le plus haut d'abord). Le point est donné sur la feuille (motifs continus) et,
 * s'il tombe dans une pièce, en coordonnées de cette pièce (calques de pièce).
 */
export function pickLayer(
  layers: AtelierLayer[],
  boxes: Map<number, { w: number; h: number }>,
  at: { sheet: [number, number] | null; piece: { piece: PieceId; x: number; y: number } | null },
  margin = 0.8,
): AtelierLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i], b = boxes.get(L.id);
    if (!L.visible || !b) continue;
    const q = L.piece === "sheet" ? at.sheet : at.piece && at.piece.piece === L.piece ? [at.piece.x, at.piece.y] : null;
    if (!q) continue;
    const a = (-L.rotate * Math.PI) / 180, dx = q[0] - L.x, dy = q[1] - L.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 + margin && Math.abs(ly) <= b.h / 2 + margin) return L;
  }
  return null;
}
