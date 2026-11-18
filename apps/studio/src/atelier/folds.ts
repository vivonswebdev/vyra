// Atelier vêtement : plis et ombres de contact peints dans l'agencement de l'atlas. Blanc = rien, sombre =
// creux (aisselles, dessous du col, plis de suspension sur le cintre, plis tombants, tête de manche).
// Sert d'occlusion ambiante (ombres douces) et creuse le relief du tissu. Indicatif : ce n'est pas une
// simulation de plis réelle, seulement un rendu plus proche d'un vêtement photographié.
import { type Garment, type Layout, PX_PER_CM as S, topEdge } from "./garments.js";

function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function paintFolds(canvas: HTMLCanvasElement, g: Garment, layout: Layout) {
  const W = Math.ceil(layout.width * S), H = Math.ceil(layout.height * S);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const r = rand(11 + Math.round(g.W * 7 + g.H));
  const shade = (k: number) => `rgba(0,0,0,${Math.min(0.8, k * 1.7)})`;
  const blob = (x: number, y: number, rad: number, k: number) => {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, shade(k)); gr.addColorStop(1, shade(0));
    ctx.fillStyle = gr;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const stroke = (pts: [number, number][], width: number, k: number, blur: number) => {
    // Flou par ombre portée : le trait est dessiné hors du canevas, seule son ombre floue y revient
    // (ctx.filter n'existe pas dans Safari).
    const m = ctx.getTransform(), off = 100000;
    ctx.save();
    ctx.shadowColor = shade(k); ctx.shadowBlur = Math.max(1, blur * S * 2); ctx.shadowOffsetX = off;
    ctx.strokeStyle = "#000"; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - off / m.a, y) : ctx.moveTo(x - off / m.a, y)));
    ctx.stroke();
    ctx.restore();
  };

  // Devant et dos : coordonnées de pièce (x depuis le milieu, y sous l'épaule), en cm.
  for (const piece of ["front", "back"] as const) {
    const rg = layout.regions[piece], back = piece === "back";
    ctx.save();
    ctx.setTransform(S, 0, 0, S, (rg.x0 + rg.w / 2) * S, rg.y0 * S);
    ctx.beginPath(); ctx.rect(-rg.w / 2, 0, rg.w, rg.h); ctx.clip();
    const half = g.W / 2, arm = g.circ / 2 - 1;
    // Aisselles : ombre de contact entre manche et corps.
    for (const s of [-1, 1]) {
      blob(s * half, arm, 9, 0.42);
      blob(s * half, arm + 6, 6, 0.18);
    }
    // Dessous du col (encolure) : bande d'ombre courte.
    const neck: [number, number][] = [];
    for (let x = -g.W * 0.2; x <= g.W * 0.2 + 0.01; x += 0.5) neck.push([x, topEdge(g, x, back) + 1.1]);
    stroke(neck, 1.6, back ? 0.18 : 0.28, 0.7);
    // Plis de suspension : du bord de l'encolure vers les aisselles, en éventail.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x0 = s * (g.W * (0.16 + r() * 0.08)), y0 = topEdge(g, Math.abs(x0), back) + 1 + r() * 2;
        const x1 = s * (half * (0.7 + r() * 0.25)), y1 = arm * (0.75 + i * 0.22) + r() * 3;
        const xm = (x0 + x1) / 2 + s * (r() - 0.3) * 3, ym = (y0 + y1) / 2 - 1.5;
        const pts: [number, number][] = [];
        for (let t = 0; t <= 1.001; t += 0.1) pts.push([(1 - t) ** 2 * x0 + 2 * (1 - t) * t * xm + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * ym + t * t * y1]);
        stroke(pts, 0.7 + r() * 0.6, 0.16 + r() * 0.12, 0.9 + r() * 0.6);
      }
    }
    // Plis tombants : longs, doux, depuis les aisselles et le milieu.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const x = s * (half - 3 - i * 6 - r() * 3), y0 = arm + 4 + r() * 5, y1 = g.H - 4 - r() * 12;
        stroke([[x, y0], [x + s * (r() - 0.5) * 3, (y0 + y1) / 2], [x - s * r() * 2, y1]], 1.4, 0.1 + r() * 0.06, 2.2);
      }
    }
    stroke([[(r() - 0.5) * 8, g.H * 0.45], [(r() - 0.5) * 6, g.H - 3]], 1.6, 0.06, 2.6);
    // Ourlet : léger creux au-dessus de la bande.
    stroke([[-half, g.H - 2.4], [half, g.H - 2.4]], 1, 0.12, 0.8);
    ctx.restore();
  }

  // Manches : u = tour (milieu = dessus, bords = dessous de bras), v = longueur depuis la tête de manche.
  for (const piece of ["sleeveL", "sleeveR"] as const) {
    const rg = layout.regions[piece];
    ctx.save();
    ctx.setTransform(S, 0, 0, S, rg.x0 * S, rg.y0 * S);
    ctx.beginPath(); ctx.rect(0, 0, rg.w, rg.h); ctx.clip();
    // Dessous de bras : ombre près de l'aisselle, sur les deux bords (couture).
    for (const u of [0, rg.w]) { blob(u, 1, 10, 0.4); blob(u, g.L * 0.35, 7, 0.14); }
    // Tête de manche : léger creux sous la couture d'emmanchure.
    stroke([[0, 1.2], [rg.w, 1.2]], 1.2, 0.16, 0.8);
    // Plis en travers, plus nombreux vers le poignet des manches longues.
    const n = Math.max(2, Math.round(g.L / 9));
    for (let i = 0; i < n; i++) {
      const v = g.L * (0.25 + (0.7 * (i + r() * 0.6)) / n), c = rg.w * (0.25 + r() * 0.5), span = rg.w * (0.25 + r() * 0.25);
      stroke([[c - span, v + (r() - 0.5) * 2], [c, v + (r() - 0.5) * 1.5], [c + span, v + (r() - 0.5) * 2]], 0.8, 0.12 + r() * 0.08, 1);
    }
    ctx.restore();
  }
}
