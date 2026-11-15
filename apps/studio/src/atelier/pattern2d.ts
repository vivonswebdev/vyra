// Atelier vêtement : patron à plat. Chaque pièce reprend sa zone de l'atlas (même texture que le vêtement
// 3D), découpée selon son contour ; coutures en couleur (épaule, dessus et dessous de manche, côté).
// Les impressions s'y sélectionnent, se déplacent, tournent et (textes seulement) changent de taille.
import { type AtelierLayer, type Atlas, hitTest } from "./atlas.js";
import { ARM_ANGLE, type Garment, type Layout, type PieceId, PX_PER_CM as S, topEdge } from "./garments.js";

export interface PatternLabels { front: string; back: string; frontInfo: string; backInfo: string; hood: string }
interface Piece { kind: "body" | "sleeve" | "hood"; piece: PieceId | "plain"; M: DOMMatrix; sgn: number }
export type LayerPatch = Partial<Pick<AtelierLayer, "x" | "y" | "rotate">> & { width?: number; cap?: number };

const SEAM = { shoulder: "#c23a2b", sleeveTop: "#2f56c9", underarm: "#d38a2a", side: "#2e8a4f", edge: "#8b97ab" };

export class PatternView {
  onPick?: (id: number | null) => void;
  onEdit?: (id: number, patch: LayerPatch) => void;
  onEditEnd?: () => void;
  scale = 4;
  private ox = 0;
  private oy = 0;
  private pieces: Piece[] = [];
  private g!: Garment;
  private layout!: Layout;
  private atlas!: Atlas;
  private layers: AtelierLayer[] = [];
  private selected: number | null = null;
  private labels!: PatternLabels;
  private hoodFill = "#fbfcfd";
  private ink = "#1c2742";
  private muted = "#5d6a82";
  private drag: null | { type: "move" | "rotate" | "resize"; L: AtelierLayer; p: Piece; dx: number; dy: number; d0: number; w0: number; cap0: number } = null;
  private ro: ResizeObserver;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
    this.ro = new ResizeObserver(() => { this.fit(); this.draw(); });
    this.ro.observe(canvas);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.up);
  }

  set(inp: { garment: Garment; layout: Layout; atlas: Atlas; layers: AtelierLayer[]; selected: number | null; labels: PatternLabels; hoodFill: string }) {
    const refit = inp.garment !== this.g;
    Object.assign(this, { g: inp.garment, layout: inp.layout, atlas: inp.atlas, layers: inp.layers, selected: inp.selected, labels: inp.labels, hoodFill: inp.hoodFill });
    if (refit) this.fit();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw());
  }

  private extent() {
    const g = this.g;
    const reach = Math.sin(ARM_ANGLE) * g.L + (Math.cos(ARM_ANGLE) * g.circ) / 2;
    const half = g.W / 2 + reach + 2, gap = 8;
    const drop = Math.cos(ARM_ANGLE) * g.L + 6;
    return { frontX: half, backX: half * 3 + gap, top: 6, w: half * 4 + gap, h: Math.max(g.H, drop + 4) + (g.hood ? 34 : 0) + 12 };
  }

  fit() {
    if (!this.g) return;
    const r = this.canvas.getBoundingClientRect();
    const e = this.extent(), pad = 12;
    this.scale = Math.max(0.5, Math.min((r.width - pad * 2) / e.w, (r.height - pad * 2) / e.h));
    this.ox = (r.width - e.w * this.scale) / 2;
    this.oy = pad + Math.max(0, (r.height - pad * 2 - e.h * this.scale) / 2);
  }

  private matrices() {
    const g = this.g, e = this.extent(), k = this.scale;
    const base = (x: number, y: number) => new DOMMatrix().translate(this.ox, this.oy).scale(k).translate(x, y);
    const pieces: Piece[] = [];
    const deg = (ARM_ANGLE * 180) / Math.PI;
    for (const [view, cx] of [["front", e.frontX], ["back", e.backX]] as const) {
      pieces.push({ kind: "body", piece: view, M: base(cx, e.top), sgn: 1 });
      for (const side of [1, -1]) {
        // Devant : la manche gauche du porteur est à droite du lecteur ; dos (vue extérieure) : l'inverse.
        const key: PieceId = view === "front" ? (side > 0 ? "sleeveL" : "sleeveR") : side > 0 ? "sleeveR" : "sleeveL";
        const sgn = view === "front" ? 1 : -1; // moitié visible du tube : devant (x ≥ 0) ou dos (x ≤ 0)
        const M = base(cx + side * (g.W / 2 - 1), e.top + 4.2).rotate(side > 0 ? -deg : deg).scale((side > 0 ? -1 : 1) * sgn, 1);
        pieces.push({ kind: "sleeve", piece: key, M, sgn });
      }
    }
    if (g.hood) pieces.push({ kind: "hood", piece: "plain", M: base((e.frontX + e.backX) / 2, e.top + Math.max(g.H, Math.cos(ARM_ANGLE) * g.L + 8) + 20), sgn: 1 });
    this.pieces = pieces;
  }

  draw() {
    if (!this.g) return;
    const c = this.canvas, ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.matrices();
    const g = this.g, k = this.scale, D = new DOMMatrix().scale(dpr);
    const css = getComputedStyle(c);
    this.ink = css.getPropertyValue("--text").trim() || "#1c2742";
    this.muted = css.getPropertyValue("--muted").trim() || "#5d6a82";
    const stroke = (M: DOMMatrix, pts: [number, number][], color: string, w = 2.4) => {
      ctx.setTransform(D.multiply(M));
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = color; ctx.lineWidth = w / k; ctx.stroke();
    };
    const region = (piece: PieceId) => this.layout.regions[piece];
    const paint = (piece: PieceId) => {
      const rg = region(piece);
      ctx.drawImage(this.atlas.canvas, rg.x0 * S, rg.y0 * S, rg.w * S, rg.h * S, -rg.w / 2, 0, rg.w, rg.h);
    };
    for (const p of this.pieces.filter((q) => q.kind === "sleeve")) {
      ctx.save(); ctx.setTransform(D.multiply(p.M));
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((p.sgn * g.circ) / 2, 0); ctx.lineTo((p.sgn * g.cuff) / 2, g.L); ctx.lineTo(0, g.L); ctx.closePath();
      ctx.shadowColor = "rgba(28,39,66,.2)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.fillStyle = "#fff"; ctx.fill(); ctx.shadowColor = "transparent";
      ctx.clip(); paint(p.piece as PieceId); ctx.restore();
      stroke(p.M, [[0, 0], [0, g.L]], SEAM.sleeveTop);
      stroke(p.M, [[(p.sgn * g.cuff) / 2, g.L], [(p.sgn * g.circ) / 2, 0]], SEAM.underarm);
      stroke(p.M, [[0, g.L], [(p.sgn * g.cuff) / 2, g.L]], SEAM.edge, 1.6);
    }
    for (const p of this.pieces.filter((q) => q.kind === "body")) {
      const back = p.piece === "back";
      ctx.save(); ctx.setTransform(D.multiply(p.M));
      ctx.beginPath();
      for (let x = -g.W / 2; x <= g.W / 2 + 0.01; x += 0.5) { const y = topEdge(g, x, back); if (x === -g.W / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.lineTo(g.W / 2, g.H); ctx.lineTo(-g.W / 2, g.H); ctx.closePath();
      ctx.shadowColor = "rgba(28,39,66,.2)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3; ctx.fillStyle = "#fff"; ctx.fill(); ctx.shadowColor = "transparent";
      ctx.clip(); paint(p.piece as PieceId); ctx.restore();
      const sh: [number, number][] = [];
      for (let x = g.W * 0.2; x <= g.W / 2 + 0.01; x += 0.5) sh.push([x, topEdge(g, x, back)]);
      stroke(p.M, sh, SEAM.shoulder); stroke(p.M, sh.map(([x, y]) => [-x, y]), SEAM.shoulder);
      const top = topEdge(g, g.W / 2, back);
      stroke(p.M, [[g.W / 2, top], [g.W / 2, g.H]], SEAM.side); stroke(p.M, [[-g.W / 2, top], [-g.W / 2, g.H]], SEAM.side);
      stroke(p.M, [[-g.W / 2, g.H], [g.W / 2, g.H]], SEAM.edge, 1.6);
      const nk: [number, number][] = [];
      for (let x = -g.W * 0.2; x <= g.W * 0.2 + 0.01; x += 0.5) nk.push([x, topEdge(g, x, back)]);
      stroke(p.M, nk, SEAM.edge, 1.6);
      // Cote de longueur.
      ctx.setTransform(D.multiply(p.M));
      const ax = -g.W / 2 + 4.5;
      ctx.strokeStyle = "#1c2742"; ctx.fillStyle = "#1c2742"; ctx.lineWidth = 1.1 / k; // sur la pièce (fond clair)
      ctx.beginPath(); ctx.moveTo(ax, 6); ctx.lineTo(ax, g.H - 8); ctx.stroke();
      for (const [y, dir] of [[6, 1], [g.H - 8, -1]]) { ctx.beginPath(); ctx.moveTo(ax, y); ctx.lineTo(ax - 0.8, y + dir * 1.6); ctx.lineTo(ax + 0.8, y + dir * 1.6); ctx.closePath(); ctx.fill(); }
      this.label(ctx, dpr, p.M.transformPoint(new DOMPoint(0, g.H + 3.4)), back ? this.labels.back : this.labels.front, back ? this.labels.backInfo : this.labels.frontInfo);
    }
    const hood = this.pieces.find((q) => q.kind === "hood");
    if (hood) {
      ctx.save(); ctx.setTransform(D.multiply(hood.M));
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.quadraticCurveTo(-17, -12, -4, -16); ctx.quadraticCurveTo(14, -18, 17, -4); ctx.lineTo(16, 12); ctx.quadraticCurveTo(2, 16, -16, 12); ctx.closePath();
      ctx.shadowColor = "rgba(28,39,66,.2)"; ctx.shadowBlur = 10; ctx.fillStyle = this.hoodFill; ctx.fill(); ctx.shadowColor = "transparent";
      ctx.strokeStyle = SEAM.edge; ctx.lineWidth = 1.6 / k; ctx.stroke();
      ctx.restore();
      this.label(ctx, dpr, hood.M.transformPoint(new DOMPoint(0, 15.5)), "", this.labels.hood);
    }
    // Sélection : cadre pointillé, poignée de rotation, poignée de taille (textes).
    const L = this.layers.find((l) => l.id === this.selected);
    const box = L && this.atlas.boxes.get(L.id);
    if (L && box && L.visible) {
      for (const p of this.pieces) {
        if (p.piece !== L.piece || (p.kind === "sleeve" && Math.abs(L.x) > 0.5 && Math.sign(L.x) !== p.sgn)) continue;
        ctx.setTransform(D.multiply(p.M).translate(L.x, L.y).rotate(L.rotate));
        ctx.strokeStyle = "#c23a2b"; ctx.lineWidth = 1.2 / k; ctx.setLineDash([4 / k, 3 / k]);
        ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h); ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, -box.h / 2); ctx.lineTo(0, -box.h / 2 - 2.6); ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(0, -box.h / 2 - 3.2, 4.5 / k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (L.kind === "text") { ctx.fillRect(box.w / 2 - 3.5 / k, -3.5 / k, 7 / k, 7 / k); ctx.strokeRect(box.w / 2 - 3.5 / k, -3.5 / k, 7 / k, 7 / k); }
      }
    }
  }

  private label(ctx: CanvasRenderingContext2D, dpr: number, at: DOMPoint, title: string, info: string) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    const k = this.scale;
    if (title) { ctx.fillStyle = this.ink; ctx.font = `700 ${Math.max(8, Math.min(13, k * 1.5))}px "JetBrains Mono", monospace`; ctx.fillText(title, at.x, at.y); }
    if (info && k >= 2.4) { ctx.fillStyle = this.muted; ctx.font = `500 ${Math.max(8, Math.min(11, k * 1.2))}px "JetBrains Mono", monospace`; ctx.fillText(info, at.x, at.y + (title ? Math.max(11, k * 2) : 0)); }
    ctx.textAlign = "left";
  }

  private toPiece(p: Piece, ev: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const q = p.M.inverse().transformPoint(new DOMPoint(ev.clientX - r.left, ev.clientY - r.top));
    return { x: q.x, y: q.y };
  }
  private local(L: AtelierLayer, q: { x: number; y: number }) {
    const a = (-L.rotate * Math.PI) / 180, dx = q.x - L.x, dy = q.y - L.y;
    return { lx: dx * Math.cos(a) - dy * Math.sin(a), ly: dx * Math.sin(a) + dy * Math.cos(a) };
  }
  private hitLayer(piece: PieceId | "plain", q: { x: number; y: number }) {
    return piece === "plain" ? null : hitTest(this.layers, this.atlas.boxes, piece, q.x, q.y);
  }

  private down = (ev: PointerEvent) => {
    this.canvas.setPointerCapture(ev.pointerId);
    const sel = this.layers.find((l) => l.id === this.selected), box = sel && this.atlas.boxes.get(sel.id);
    if (sel && box) {
      for (const p of this.pieces) {
        if (p.piece !== sel.piece) continue;
        const { lx, ly } = this.local(sel, this.toPiece(p, ev));
        const tol = 7 / this.scale;
        const w0 = sel.kind === "text" ? sel.width : 0, cap0 = sel.kind === "text" ? sel.cap : 0;
        if (Math.hypot(lx, ly + box.h / 2 + 3.2) < tol) { this.drag = { type: "rotate", L: sel, p, dx: 0, dy: 0, d0: 1, w0, cap0 }; return; }
        if (sel.kind === "text" && Math.hypot(lx - box.w / 2, ly) < tol) { this.drag = { type: "resize", L: sel, p, dx: 0, dy: 0, d0: Math.max(0.5, Math.abs(lx)), w0, cap0 }; return; }
      }
    }
    for (const p of [...this.pieces].reverse()) {
      if (p.kind === "hood") continue;
      const q = this.toPiece(p, ev), L = this.hitLayer(p.piece, q);
      if (L && (p.kind !== "sleeve" || Math.sign(q.x) === p.sgn || Math.abs(q.x) < 1)) {
        this.onPick?.(L.id);
        this.drag = { type: "move", L, p, dx: L.x - q.x, dy: L.y - q.y, d0: 1, w0: 0, cap0: 0 };
        this.canvas.style.cursor = "move";
        return;
      }
    }
  };
  private move = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d) {
      const over = this.pieces.some((p) => p.kind !== "hood" && this.hitLayer(p.piece, this.toPiece(p, ev)));
      this.canvas.style.cursor = over ? "move" : "";
      return;
    }
    const q = this.toPiece(d.p, ev);
    if (d.type === "move") this.onEdit?.(d.L.id, { x: q.x + d.dx, y: q.y + d.dy });
    else if (d.type === "rotate") this.onEdit?.(d.L.id, { rotate: Math.round((Math.atan2(q.x - d.L.x, -(q.y - d.L.y)) * 180) / Math.PI) });
    else {
      const f = Math.max(0.5, this.local(d.L, q).lx) / d.d0;
      if (d.L.kind === "text" && d.L.layout === "arc") this.onEdit?.(d.L.id, { cap: Math.max(0.3, Math.min(12, d.cap0 * f)) });
      else this.onEdit?.(d.L.id, { width: Math.max(2, Math.min(60, d.w0 * f)) });
    }
  };
  private up = () => {
    if (this.drag) this.onEditEnd?.();
    this.drag = null;
    this.canvas.style.cursor = "";
  };
}
