// Atelier vêtement : fond de studio photo dessiné en 2D (dégradé, vignettage, ombre de feuillage portée),
// utilisé comme arrière-plan de la scène 3D et donc présent sur la photo exportée.

export interface Backdrop { color: string; leaves: boolean }

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xd8d2c8;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (c: [number, number, number], t: [number, number, number], k: number) =>
  `rgb(${c.map((v, i) => Math.round(v + (t[i] - v) * k)).join(",")})`;

/** Générateur pseudo-aléatoire déterministe : le feuillage est le même à chaque rendu. */
function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function drawBackdrop(canvas: HTMLCanvasElement, w: number, h: number, b: Backdrop) {
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
  const ctx = canvas.getContext("2d")!;
  const c = rgb(b.color), white: [number, number, number] = [255, 255, 255], black: [number, number, number] = [0, 0, 0];
  const W = canvas.width, H = canvas.height;
  // Mur éclairé au centre, plus sombre vers les bords ; sol légèrement plus clair sous le vêtement.
  const g = ctx.createRadialGradient(W * 0.5, H * 0.42, Math.min(W, H) * 0.05, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  g.addColorStop(0, mix(c, white, 0.16));
  g.addColorStop(0.55, mix(c, black, 0.04));
  g.addColorStop(1, mix(c, black, 0.3));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (b.leaves) {
    // Ombre de feuillage : feuilles floues, groupées en branches, venant du haut à droite.
    const r = rand(7), s = Math.min(W, H) / 900;
    ctx.save();
    ctx.filter = `blur(${Math.max(4, Math.round(14 * s))}px)`;
    ctx.fillStyle = mix(c, black, 0.32);
    ctx.globalAlpha = 0.5;
    for (let br = 0; br < 7; br++) {
      let x = W * (0.55 + r() * 0.55), y = H * (-0.05 + r() * 0.55);
      const dir = Math.PI * (0.75 + r() * 0.35);
      for (let i = 0; i < 16; i++) {
        x += Math.cos(dir) * 26 * s + (r() - 0.5) * 30 * s;
        y += Math.sin(dir) * 26 * s + (r() - 0.5) * 30 * s;
        const len = (26 + r() * 30) * s, wid = len * (0.38 + r() * 0.15);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r() * Math.PI);
        ctx.beginPath();
        ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }
  // Vignettage final, léger.
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}
