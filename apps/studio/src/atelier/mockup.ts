// Atelier vêtement : maquettes 3D sculptées (T-shirt, sweat, hoodie), à la manière d'une photo « mannequin
// invisible ». Le vêtement est décrit comme un volume lisse (champ de distance : buste, manches unies en
// douceur aux emmanchures, col, capuche posée dans le dos), avec de vrais plis dans la forme ; il est maillé
// (surface nets), ouvert à l'encolure, à l'ourlet et aux poignets, puis déplié sur l'atlas du patron (même
// texture que le patron 2D : une impression posée sur le patron tombe au même endroit sur la maquette).
// Pur TypeScript, sans DOM : testable tel quel. Indicatif : une forme idéale, pas un essayage.
import { type Garment, type Layout, topEdge } from "./garments.js";

export interface Mockup {
  /** Triangles indépendants (3 sommets chacun) : positions, normales, coordonnées de texture (atlas). */
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  /** Cordons de capuche (polylignes, cm), vides sans capuche. */
  cords: [number, number, number][][];
  /** Haut du col au dos (cm), pour poser le cintre. */
  top: number;
  /** Demi-largeur d'épaules (cm), pour la barre du cintre. */
  shoulder: number;
  triangles: number;
}

type V3 = [number, number, number];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);
/** Distance (approchée) à une ellipse de demi-axes a, b. */
function ellipse(x: number, z: number, a: number, b: number) {
  const k0 = Math.hypot(x / a, z / b), k1 = Math.hypot(x / (a * a), z / (b * b));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b);
}
function ellipsoid(x: number, y: number, z: number, r: V3) {
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]), k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}

/** Forme d'un vêtement : fonctions de distance de ses parties, découpes et dépliage. */
export function mockupShape(g: Garment) {
  const yT = 1, yH = 1 - g.H, long = g.L > 30;
  // Tour de poitrine : deux largeurs à plat. Section aplatie, comme un vêtement sur mannequin invisible
  // (vu de face, presque sa largeur à plat).
  const P = 2 * g.W * 0.97, ratio = 0.34;
  const a0 = P / (Math.PI * (3 * (1 + ratio) - Math.sqrt((3 + ratio) * (1 + 3 * ratio)))), b0 = a0 * ratio;
  const aTop = a0 * 0.93, bTop = b0 * 0.78;
  const ribH = g.rib ? 6 : 0;
  const aOf = (y: number) => {
    const t = (yT - y) / g.H;
    let s = 0.93 + 0.07 * smooth(0, 0.22, t);
    if (ribH) s *= 1 - 0.07 * smooth(1 - ribH / g.H, 1, t);
    return a0 * s;
  };
  const bOf = (y: number) => {
    const t = (yT - y) / g.H;
    let s = 0.8 + 0.2 * smooth(0, 0.3, t) + 0.06 * t;
    if (ribH) s *= 1 - 0.08 * smooth(1 - ribH / g.H, 1, t);
    return b0 * s;
  };
  const nw = g.W * 0.2 * (aTop / (g.W / 2)); // demi-largeur d'encolure, à l'échelle de la maquette
  const ytop = (x: number) => yT - 4.2 * Math.pow(clamp((Math.abs(x) - nw) / (aTop - nw), 0, 1), 1.1);
  const torso = (x: number, y: number, z: number) => smax(ellipse(x, z, aOf(y), bOf(y)), y - ytop(x), 3);

  // Manches : cônes elliptiques, plus écartés pour un T-shirt, plus près du corps pour les manches longues.
  const th = (long ? 27 : 47) * (Math.PI / 180);
  const r0 = (g.circ / (2 * Math.PI)) * 1.08, r1 = (g.cuff / (2 * Math.PI)) * 1.04;
  const rMid = g.rib ? Math.max(r1 * 1.5, r0 * 0.78) : r1;
  const rOf = (t: number) => {
    if (!g.rib) return r0 + (r1 - r0) * clamp(t / g.L, 0, 1);
    const k = g.L - 7;
    return t < k ? r0 + (rMid - r0) * clamp(t / k, 0, 1) : rMid + (r1 - rMid) * smooth(k, g.L - 4, t);
  };
  // Départ de manche : sa ligne du dessus prolonge la pente d'épaule (pas de bosse au-dessus de l'épaule).
  const sleeves = [1, -1].map((s) => ({
    s, key: (s > 0 ? "sleeveL" : "sleeveR") as "sleeveL" | "sleeveR",
    S: [s * (aTop - 1.5 - Math.cos(th) * r0 * 0.85), yT - 4.2 - Math.sin(th) * r0 * 0.85, 0] as V3,
    d: [s * Math.sin(th), -Math.cos(th), 0] as V3, u: [s * Math.cos(th), Math.sin(th), 0] as V3,
  }));
  const sleeveLocal = (sl: (typeof sleeves)[number], x: number, y: number, z: number) => {
    const qx = x - sl.S[0], qy = y - sl.S[1];
    return { t: qx * sl.d[0] + qy * sl.d[1], ru: qx * sl.u[0] + qy * sl.u[1], rw: z };
  };
  const sleeve = (sl: (typeof sleeves)[number], x: number, y: number, z: number) => {
    const { t, ru, rw } = sleeveLocal(sl, x, y, z);
    const tc = clamp(t, -8, g.L + 4), r = rOf(tc);
    const d = ellipse(ru, rw, r, r * 0.62), e = t - tc;
    return e ? Math.hypot(Math.max(d, 0), e) : d;
  };

  // Capuche posée dans le dos et col qui en part (hoodie).
  // Capuche à plat dans le dos : deux moitiés arrondies et une couture au milieu, plus étroite en bas.
  const hoodR: V3 = [8.6, 14, 4.6];
  const hoodCs: V3[] = [[5.6, yT - 13, -(bTop + 3.2)], [-5.6, yT - 13, -(bTop + 3.2)]];
  const drop = (z: number) => g.neckDropBack + (g.neckDrop - g.neckDropBack) * smooth(-bTop * 0.6, bTop * 0.6, z);
  const yrim = (x: number, z: number) => yT + 0.2 - drop(z) * Math.sqrt(Math.max(0, 1 - (x / nw) ** 2));
  const ring: V3[] = [];
  for (let i = 0; i <= 48; i++) {
    const f = (i / 48) * Math.PI * 2, x = (nw + 0.6) * Math.cos(f), z = (bTop + 0.4) * Math.sin(f);
    ring.push([x, yrim(x * 0.97, z) - 0.6, z]);
  }
  const collar = (x: number, y: number, z: number) => {
    if (Math.abs(x) > nw + 8 || y < yT - g.neckDrop - 8 || y > yT + 6) return 1e3;
    let best = 1e9;
    for (let i = 0; i < ring.length - 1; i++) {
      const A = ring[i], B = ring[i + 1];
      const bx = B[0] - A[0], by = B[1] - A[1], bz = B[2] - A[2], px = x - A[0], py = y - A[1], pz = z - A[2];
      const h = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
      best = Math.min(best, (px - bx * h) ** 2 + (py - by * h) ** 2 + (pz - bz * h) ** 2);
    }
    return Math.sqrt(best) - 2.3;
  };
  const hood = (x: number, y: number, z: number) => {
    const taper = 1 - 0.35 * smooth(yT - 10, yT - 27, y); // plus étroite vers la pointe
    let d = 1e9;
    for (const c of hoodCs) d = Math.min(d, ellipsoid((x - c[0] * taper) / taper, y - c[1], z - c[2], hoodR) * Math.min(1, taper));
    return smin(d, collar(x, y, z), 3);
  };

  /** Plis dans la forme (cm) : tombants en bas, de suspension sous les épaules, en anneaux aux manches. */
  const folds = (x: number, y: number, z: number) => {
    const t = (yT - y) / g.H, ang = Math.atan2(x / a0, z / b0);
    let f = 0.42 * smooth(0.3, 1, t) * Math.sin(ang * 7 + 1.4 * Math.sin(y * 0.09) + 0.7) * (1 - 0.5 * smooth(0.92, 1, t));
    f += 0.16 * smooth(0.1, 0.17, t) * (1 - smooth(0.24, 0.4, t)) * Math.sin((Math.abs(x) * 0.8 + (yT - y) * 0.6) * 0.7) * smooth(nw, nw + 5, Math.abs(x)) * (z > 0 ? 1 : 0.6);
    f += 0.18 * smooth(0.85, 1, t) * Math.sin(ang * 5 + 2.1);
    for (const sl of sleeves) {
      const { t: ts, ru } = sleeveLocal(sl, x, y, z);
      // Plis en anneaux : surtout sous le bras, presque rien sur le dessus de l'épaule.
      const under = 0.15 + 0.85 * smooth(1, -4, ru) * smooth(0, 3, ts);
      if (ts > -2 && ts < g.L && x * sl.s > aTop * 0.6) f += 0.32 * under * Math.exp(-Math.max(0, ts) / (long ? 14 : 7)) * Math.sin(ts * 1.05 + Math.atan2(z, 4) * 1.5);
      if (long && ts > g.L * 0.45 && ts < g.L - 6 && x * sl.s > aTop * 0.6) f += 0.28 * Math.sin(ts * 0.8 + z * 0.3) * smooth(g.L * 0.45, g.L * 0.6, ts);
    }
    return f;
  };

  const base = (x: number, y: number, z: number) => {
    let d = torso(x, y, z);
    for (const sl of sleeves) d = smin(d, sleeve(sl, x, y, z), 4.5);
    if (g.hood) d = smin(d, hood(x, y, z), 2.5);
    return d;
  };
  const sdf = (x: number, y: number, z: number) => base(x, y, z) + folds(x, y, z);

  /** Découpes : on garde là où toutes les valeurs sont positives (encolure, ourlet, poignets). */
  const nzc = bTop + 3;
  const cuts = (x: number, y: number, z: number): number[] => {
    const inNeck = (x / nw) ** 2 + (z / nzc) ** 2 < 1;
    const out = [inNeck ? yrim(x, z) - y : 1, y - yH];
    // Poignet : seulement sur la manche (le bas du buste est aussi « loin » sur l'axe de la manche).
    const dt = torso(x, y, z);
    for (const sl of sleeves) out.push(x * sl.s > aTop * 0.5 && sleeve(sl, x, y, z) < dt + 1 ? g.L - sleeveLocal(sl, x, y, z).t : 1);
    return out;
  };

  /** Fraction du tour (0 à 1, depuis le côté gauche, vers l'avant) parcourue sur une ellipse de rapport
   *  b/a jusqu'à l'angle paramétrique a : le dépliage suit la longueur de tissu, pas l'angle. */
  const arc = (ang: number, ratio: number) => {
    const n = 48, len = (t: number) => Math.hypot(Math.cos(t), ratio * Math.sin(t));
    const total = (() => { let s = 0; for (let i = 0; i < n * 4; i++) s += len(((i + 0.5) / (n * 4)) * 2 * Math.PI); return s; })();
    const a = ((ang + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    let s = 0;
    const m = Math.max(1, Math.round((a / (2 * Math.PI)) * n * 4));
    for (let i = 0; i < m; i++) s += len(-Math.PI / 2 + ((i + 0.5) / m) * a);
    return ((s * a) / m) / ((total * 2 * Math.PI) / (n * 4));
  };

  /** Pièce du patron sous un point, et coordonnées dans l'atlas (cm). */
  /** Coutures : valeur > 0 du côté de la manche gauche, de la manche droite, de la capuche (sinon buste). */
  const seams = (x: number, y: number, z: number): number[] => {
    const dt = torso(x, y, z);
    return [...sleeves.map((sl) => dt - sleeve(sl, x, y, z) - 0.6), g.hood ? dt - hood(x, y, z) + 0.4 : -1];
  };
  const PARTS = ["sleeveL", "sleeveR", "hood"] as const;
  const atlasOf = (layout: Layout, which: "torso" | "sleeveL" | "sleeveR" | "hood", x: number, y: number, z: number): [number, number] => {
    if (which === "torso") {
      const ay = aOf(y), by = bOf(y);
      const u = arc(Math.atan2(x / ay, z / by), by / ay) * 2 * g.W;
      return [u, clamp(yT - y, 0, g.H)];
    }
    if (which === "hood") { const p = layout.regions.plain; return [p.x0 + p.w / 2, p.y0 + p.h / 2]; }
    const sl = sleeves.find((q) => q.key === which)!, r = layout.regions[which];
    const { t, ru, rw } = sleeveLocal(sl, x, y, z);
    const ph = Math.atan2(rw, ru);
    return [r.x0 + ((ph + Math.PI) / (2 * Math.PI)) * r.w, r.y0 + clamp(t, 0, g.L)];
  };

  return { yT, yH, a0, b0, aTop, bTop, nw, th, sleeves, sdf, base, cuts, seams, PARTS, atlasOf, yrim };
}

/** Maille la maquette d'un vêtement. h : pas de la grille (cm) ; 0,7 donne des plis nets. */
export function buildMockup(g: Garment, layout: Layout, h = 0.7): Mockup {
  const sh = mockupShape(g);
  const xm = sh.a0 + 8 + g.L * Math.sin(sh.th) + 4;
  const x0 = -xm, y0 = sh.yH - 3, z0 = -(sh.bTop + (g.hood ? 14 : 6)) - 2;
  const nx = Math.ceil((2 * xm) / h) + 1, ny = Math.ceil((sh.yT + (g.hood ? 8 : 5) - y0) / h) + 1, nz = Math.ceil((sh.b0 * 1.15 + 6 - z0) / h) + 1;
  const val = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[at(i, j, k)] = sh.sdf(x0 + i * h, y0 + j * h, z0 + k * h);

  // Surface nets : un sommet par cellule traversée (moyenne des croisements d'arêtes), un quad par arête.
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cat = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const verts: number[] = [];
  const E: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; if (cv[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t); sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t); sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    cell[cat(i, j, k)] = verts.length / 3;
    verts.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, b, c, b, d, c); else tris.push(a, c, b, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[at(i, j, k)] < 0;
    if (v0 !== (val[at(i + 1, j, k)] < 0)) quad(cell[cat(i, j - 1, k - 1)], cell[cat(i, j, k - 1)], cell[cat(i, j - 1, k)], cell[cat(i, j, k)], v0);
    if (v0 !== (val[at(i, j + 1, k)] < 0)) quad(cell[cat(i - 1, j, k - 1)], cell[cat(i - 1, j, k)], cell[cat(i, j, k - 1)], cell[cat(i, j, k)], v0);
    if (v0 !== (val[at(i, j, k + 1)] < 0)) quad(cell[cat(i - 1, j - 1, k)], cell[cat(i, j - 1, k)], cell[cat(i - 1, j, k)], cell[cat(i, j, k)], v0);
  }

  // Normales lisses : gradient du champ en chaque sommet.
  const nv = verts.length / 3, nrm = new Float32Array(nv * 3), e = 0.3;
  for (let v = 0; v < nv; v++) {
    const x = verts[v * 3], y = verts[v * 3 + 1], z = verts[v * 3 + 2];
    let gx = sh.sdf(x + e, y, z) - sh.sdf(x - e, y, z), gy = sh.sdf(x, y + e, z) - sh.sdf(x, y - e, z), gz = sh.sdf(x, y, z + e) - sh.sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    gx /= l; gy /= l; gz /= l;
    nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
  }

  // Découpe des triangles (bords nets), dépliage sur l'atlas, triangles indépendants.
  const P: number[] = [], N: number[] = [], U: number[] = [];
  type Pt = { p: V3; n: V3; c: number[]; s: number[] };
  const mk = (v: number): Pt => {
    const p: V3 = [verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]];
    return { p, n: [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]], c: sh.cuts(...p), s: sh.seams(...p) };
  };
  const lerp = (a: Pt, b: Pt, t: number): Pt => ({
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    n: [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t],
    c: a.c.map((v, i) => v + (b.c[i] - v) * t),
    s: a.s.map((v, i) => v + (b.s[i] - v) * t),
  });
  /** Coupe un polygone selon le signe de f : [partie f ≥ 0, partie f < 0]. */
  const split = (poly: Pt[], f: (q: Pt) => number): [Pt[], Pt[]] => {
    const pos: Pt[] = [], neg: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length], a = f(A), b = f(B);
      (a >= 0 ? pos : neg).push(A);
      if ((a >= 0) !== (b >= 0)) { const m = lerp(A, B, a / (a - b)); pos.push(m); neg.push(m); }
    }
    return [pos, neg];
  };
  const pts = new Map<number, Pt>();
  const get = (v: number) => { let q = pts.get(v); if (!q) { q = mk(v); pts.set(v, q); } return q; };
  for (let f = 0; f < tris.length; f += 3) {
    let poly: Pt[] = [get(tris[f]), get(tris[f + 1]), get(tris[f + 2])];
    const nc = poly[0].c.length;
    for (let ci = 0; ci < nc && poly.length >= 3; ci++) if (!poly.every((q) => q.c[ci] >= 0)) poly = split(poly, (q) => q.c[ci])[0];
    if (poly.length < 3) continue;
    // Coutures exactes : le polygone est partagé entre buste et manche (ou capuche) le long de la couture.
    let pieces: { poly: Pt[]; which: "torso" | "sleeveL" | "sleeveR" | "hood" }[] = [{ poly, which: "torso" }];
    sh.PARTS.forEach((part, pi) => {
      const next: typeof pieces = [];
      for (const pc of pieces) {
        if (pc.which !== "torso" || pc.poly.every((q) => q.s[pi] < 0)) { next.push(pc); continue; }
        const [on, off] = split(pc.poly, (q) => q.s[pi]);
        if (on.length >= 3) next.push({ poly: on, which: part });
        if (off.length >= 3) next.push({ poly: off, which: "torso" });
      }
      pieces = next;
    });
    for (const { poly, which } of pieces) emit(poly, which);
  }
  function emit(poly: Pt[], which: "torso" | "sleeveL" | "sleeveR" | "hood") {
    const uvs = poly.map((q) => sh.atlasOf(layout, which, ...q.p));
    // Couture de dépliage (côté gauche du buste, dessous des manches) : un triangle qui l'enjambe reste
    // d'un seul côté.
    const span = which === "torso" ? g.W : which === "hood" ? Infinity : layout.regions[which].w / 2;
    const us = uvs.map((q) => q[0]);
    if (Math.max(...us) - Math.min(...us) > span) {
      const lo = which === "torso" ? 0 : layout.regions[which as "sleeveL"].x0, w = which === "torso" ? 2 * g.W : layout.regions[which as "sleeveL"].w;
      for (const q of uvs) if (q[0] < lo + w / 2) q[0] = lo + w;
      for (const q of uvs) q[0] = Math.min(q[0], lo + w);
    }
    for (let i = 1; i < poly.length - 1; i++) for (const k of [0, i, i + 1]) {
      const q = poly[k], l = Math.hypot(...q.n) || 1;
      P.push(...q.p); N.push(q.n[0] / l, q.n[1] / l, q.n[2] / l);
      U.push(uvs[k][0] / layout.width, 1 - uvs[k][1] / layout.height);
    }
  }

  // Cordons : deux lacets qui tombent de l'encolure, légèrement écartés.
  const cords: [number, number, number][][] = [];
  if (g.hood) {
    for (const s of [1, -1]) {
      const x = s * 4.2, y = sh.yrim(x, sh.bTop) - 0.8, line: [number, number, number][] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        line.push([x + s * 2.2 * t * t, y - 30 * t, sh.bTop + 2.6 + 2.2 * t - 0.6 * Math.sin(t * Math.PI)]);
      }
      cords.push(line);
    }
  }
  return { position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U), cords, top: sh.yT, shoulder: sh.aTop, triangles: P.length / 9 };
}
