// Atelier vêtement : simulation du tissu (intégration de Verlet, contraintes de distance) sur une forme
// fantôme invisible (torse elliptique, bras en capsules). Unités : centimètres, secondes. Pur TypeScript,
// sans DOM ni WebGL : testable tel quel.
import { ARM_ANGLE, type Garment, topEdge } from "./garments.js";

/** Profil de la forme fantôme : [y, demi-largeur, demi-profondeur] du cou aux hanches. */
const BODY: [number, number, number][] = [
  [2, 6.5, 6], [-1, 7.5, 6.5], [-5, 16, 9], [-10, 19.2, 11], [-25, 18, 12], [-45, 15.6, 10.6], [-65, 17, 11.6], [-90, 17.5, 11.6],
];
export function bodyAt(y: number): [number, number] {
  if (y >= BODY[0][0]) return [BODY[0][1], BODY[0][2]];
  for (let i = 1; i < BODY.length; i++) {
    if (y >= BODY[i][0]) {
      const [y0, x0, z0] = BODY[i - 1], [y1, x1, z1] = BODY[i];
      let t = (y0 - y) / (y0 - y1);
      t = t * t * (3 - 2 * t);
      return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
    }
  }
  const last = BODY[BODY.length - 1];
  return [last[1], last[2]];
}

export interface Arm { a: [number, number, number]; d: [number, number, number]; len: number; r0: number; r1: number }
export interface Tube {
  cols: number;
  rows: number;
  /** Indice de particule pour (colonne, rangée) : idx[rangée * cols + colonne]. */
  idx: number[];
}
export interface TorsoTube extends Tube {
  /** Profondeur dans la pièce (cm depuis le haut) de chaque particule, pour la texture. */
  vcm: number[];
}
export interface SleeveTube extends Tube { key: "sleeveL" | "sleeveR" }
export interface Sim {
  n: number;
  pos: Float32Array;
  prev: Float32Array;
  rest: Float32Array;
  /** 0 : particule épinglée ; 1 : libre. */
  inv: Float32Array;
  ca: Int32Array;
  cb: Int32Array;
  cl: Float32Array;
  ck: Float32Array;
  torso: TorsoTube;
  sleeves: SleeveTube[];
  cords: number[][];
  arms: Arm[];
  time: number;
  grab: { i: number; target: [number, number, number] };
}

function ellipseK(ratio: number) {
  return 3 * (1 + ratio) - Math.sqrt((3 + ratio) * (1 + 3 * ratio));
}

export function buildCloth(g: Garment): Sim {
  const pts: number[] = [], pins: number[] = [], cons: [number, number, number][] = [];
  const add = (x: number, y: number, z: number, pinned: boolean) => { pts.push(x, y, z); pins.push(pinned ? 0 : 1); return pts.length / 3 - 1; };
  const con = (a: number, b: number, k: number) => cons.push([a, b, k]);

  // Torse : tube de N colonnes × M rangées ; θ = 0 au milieu devant, croissant vers la gauche du porteur.
  const N = 60, M = 42, ratio = 0.68;
  const gRx = (2 * g.W) / (Math.PI * ellipseK(ratio)), gRz = gRx * ratio;
  const yTop = -1.5, yHem = -1.5 - g.H;
  const prof = (y: number): [number, number] => {
    const t = Math.min(1, Math.max(0, (yTop - y) / 11));
    const s = Math.sin((t * Math.PI) / 2) ** 0.55;
    let rx = 8.5 + (gRx - 8.5) * s, rz = 7.4 + (gRz - 7.4) * s;
    const [bx, bz] = bodyAt(y);
    rx = Math.max(rx, bx + 1.1);
    rz = Math.max(rz, bz + 1.1);
    if (g.rib && y < yHem + 6) { const q = (yHem + 6 - y) / 6; rx -= 1.6 * q; rz -= 1.1 * q; }
    return [rx, rz];
  };
  const torso: TorsoTube = { cols: N, rows: M, idx: [], vcm: [] };
  for (let j = 0; j <= M; j++) {
    for (let k = 0; k < N; k++) {
      const th = -Math.PI / 2 + (2 * Math.PI * k) / N;
      const back = th > Math.PI / 2;
      const xPiece = back ? ((th - Math.PI) / Math.PI) * g.W : (th / Math.PI) * g.W;
      const vTop = topEdge(g, xPiece, back);
      const vcm = vTop + (g.H - vTop) * (j / M);
      const y = yTop - vcm;
      const [rx, rz] = prof(y);
      torso.idx.push(add(rx * Math.sin(th), y, rz * Math.cos(th), j === 0));
      torso.vcm.push(vcm);
    }
  }
  const T = (k: number, j: number) => torso.idx[j * N + (((k % N) + N) % N)];
  for (let j = 0; j <= M; j++) for (let k = 0; k < N; k++) {
    con(T(k, j), T(k + 1, j), 1);
    if (j < M) { con(T(k, j), T(k, j + 1), 1); con(T(k, j), T(k + 1, j + 1), 0.6); con(T(k + 1, j), T(k, j + 1), 0.6); }
    con(T(k, j), T(k + 2, j), 0.25);
    if (j < M - 1) con(T(k, j), T(k, j + 2), 0.25);
  }

  // Manches : tubes le long des bras ; φ = 0 sur la ligne du dessus, φ = +π/2 vers le devant.
  const sleeves: SleeveTube[] = [];
  const arms: Arm[] = [];
  for (const s of [1, -1]) {
    const Ns = 26, Ms = Math.max(6, Math.round(g.L / 2.4));
    const d: [number, number, number] = [s * Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), 0];
    const u0 = [s * Math.cos(ARM_ANGLE), Math.sin(ARM_ANGLE), 0];
    const w = [0, 0, 1];
    const R0 = g.circ / (2 * Math.PI), R1 = g.cuff / (2 * Math.PI);
    const SP = [s * (gRx - 0.6), -6.8];
    const C0 = [SP[0] - u0[0] * R0, SP[1] - u0[1] * R0];
    const sl: SleeveTube = { cols: Ns, rows: Ms, idx: [], key: s > 0 ? "sleeveL" : "sleeveR" };
    for (let j = 0; j <= Ms; j++) {
      const v = j / Ms, along = v * g.L;
      const cx = C0[0] + d[0] * along, cy = C0[1] + d[1] * along;
      const R = R0 + (R1 - R0) * Math.pow(v, g.rib ? 2.2 : 1);
      for (let k = 0; k < Ns; k++) {
        const ph = -Math.PI + (2 * Math.PI * k) / Ns;
        const c = Math.cos(ph), sn = Math.sin(ph);
        sl.idx.push(add(cx + R * (c * u0[0] + sn * w[0]), cy + R * (c * u0[1] + sn * w[1]), R * (c * u0[2] + sn * w[2]), j === 0));
      }
    }
    const Sx = (k: number, j: number) => sl.idx[j * Ns + (((k % Ns) + Ns) % Ns)];
    for (let j = 0; j <= Ms; j++) for (let k = 0; k < Ns; k++) {
      con(Sx(k, j), Sx(k + 1, j), 1);
      if (j < Ms) { con(Sx(k, j), Sx(k, j + 1), 1); con(Sx(k, j), Sx(k + 1, j + 1), 0.6); con(Sx(k + 1, j), Sx(k, j + 1), 0.6); }
      con(Sx(k, j), Sx(k + 2, j), 0.3);
      if (j < Ms - 1) con(Sx(k, j), Sx(k, j + 2), 0.3);
    }
    sleeves.push(sl);
    // Le bras reste toujours plus fin que la manche : sinon le tissu glisse au poignet.
    arms.push({ a: [C0[0] + d[0] * 2, C0[1] + d[1] * 2, 0], d, len: g.L + 1, r0: R0 - 1.1, r1: Math.max(2, R1 - 0.7) });
  }

  // Cordons de capuche.
  const cords: number[][] = [];
  if (g.hood) {
    for (const s of [-1, 1]) {
      const c: number[] = [];
      const x0 = s * 4.2, y0 = -1.5 - (g.neckDrop + 2.2);
      const [, bz] = bodyAt(y0);
      for (let i = 0; i < 12; i++) c.push(add(x0, y0 - i * 2.1, bz + 2.4, i === 0));
      for (let i = 0; i < 11; i++) con(c[i], c[i + 1], 1);
      cords.push(c);
    }
  }

  const n = pts.length / 3;
  const sim: Sim = {
    n, pos: new Float32Array(pts), prev: new Float32Array(pts), rest: new Float32Array(pts), inv: new Float32Array(pins),
    ca: new Int32Array(cons.length), cb: new Int32Array(cons.length), cl: new Float32Array(cons.length), ck: new Float32Array(cons.length),
    torso, sleeves, cords, arms, time: 0, grab: { i: -1, target: [0, 0, 0] },
  };
  cons.forEach(([a, b, k], i) => {
    sim.ca[i] = a; sim.cb[i] = b; sim.ck[i] = k;
    sim.cl[i] = Math.hypot(pts[b * 3] - pts[a * 3], pts[b * 3 + 1] - pts[a * 3 + 1], pts[b * 3 + 2] - pts[a * 3 + 2]);
  });
  redrape(sim);
  return sim;
}

/** Le tissu repart d'un état soulevé et élargi (le torse autour du corps, chaque manche autour de son bras) puis retombe. */
export function redrape(sim: Sim, jitter: () => number = Math.random) {
  const { pos, prev, rest, inv, n } = sim;
  const sleeveOf = new Int8Array(n);
  sim.sleeves.forEach((sl, si) => sl.idx.forEach((i) => (sleeveOf[i] = si + 1)));
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    let nx = x, ny = y, nz = z;
    if (inv[i] !== 0) {
      if (sleeveOf[i]) {
        const A = sim.arms[sleeveOf[i] - 1];
        const t = (x - A.a[0]) * A.d[0] + (y - A.a[1]) * A.d[1];
        const cx = A.a[0] + A.d[0] * t, cy = A.a[1] + A.d[1] * t;
        nx = cx + (x - cx) * 1.12; ny = cy + (y - cy) * 1.12 + 1.2; nz = z * 1.12;
      } else { nx = x * 1.15; ny = y + 4 + jitter() * 0.2; nz = z * 1.22; }
    }
    pos[i * 3] = nx; pos[i * 3 + 1] = ny; pos[i * 3 + 2] = nz;
    prev[i * 3] = nx; prev[i * 3 + 1] = ny; prev[i * 3 + 2] = nz;
  }
}

export interface StepOptions { breeze?: boolean; iterations?: number }

export function step(sim: Sim, dt: number, opts: StepOptions = {}) {
  const { pos, prev, inv, n, ca, cb, cl, ck } = sim;
  const nc = ca.length;
  const g = -981 * dt * dt * 0.9;
  const damp = 0.982;
  sim.time += dt;
  const wind = opts.breeze ? 260 * dt * dt : 0;
  for (let i = 0; i < n; i++) {
    if (!inv[i]) continue;
    const ix = i * 3;
    const x = pos[ix], y = pos[ix + 1], z = pos[ix + 2];
    let vx = (x - prev[ix]) * damp, vy = (y - prev[ix + 1]) * damp, vz = (z - prev[ix + 2]) * damp;
    prev[ix] = x; prev[ix + 1] = y; prev[ix + 2] = z;
    if (wind) {
      const gust = 0.55 + 0.45 * Math.sin(sim.time * 1.7 + y * 0.06 + x * 0.03) * Math.sin(sim.time * 0.9 + z * 0.08);
      vx += wind * gust * 0.8; vz -= wind * gust * 0.5; vy += wind * gust * 0.12;
    }
    pos[ix] = x + vx; pos[ix + 1] = y + vy + g; pos[ix + 2] = z + vz;
  }
  const iters = opts.iterations ?? 8;
  for (let it = 0; it < iters; it++) {
    for (let c = 0; c < nc; c++) {
      const a = ca[c] * 3, b = cb[c] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const ia = inv[ca[c]], ib = inv[cb[c]], w = ia + ib;
      if (!w) continue;
      const f = (((d - cl[c]) / d) * ck[c]) / w;
      pos[a] += dx * f * ia; pos[a + 1] += dy * f * ia; pos[a + 2] += dz * f * ia;
      pos[b] -= dx * f * ib; pos[b + 1] -= dy * f * ib; pos[b + 2] -= dz * f * ib;
    }
    collide(sim);
    if (sim.grab.i >= 0) {
      const ix = sim.grab.i * 3;
      pos[ix] = sim.grab.target[0]; pos[ix + 1] = sim.grab.target[1]; pos[ix + 2] = sim.grab.target[2];
    }
  }
}

function collide(sim: Sim) {
  const { pos, inv, n, arms } = sim;
  for (let i = 0; i < n; i++) {
    if (!inv[i]) continue;
    const ix = i * 3;
    let x = pos[ix], y = pos[ix + 1], z = pos[ix + 2];
    // Bras d'abord, torse ensuite : le tissu de l'aisselle ne peut pas être repoussé dans le corps.
    if (Math.abs(x) > 14) {
      for (const A of arms) {
        const px = x - A.a[0], py = y - A.a[1], pz = z - A.a[2];
        const t = Math.max(0, Math.min(A.len, px * A.d[0] + py * A.d[1] + pz * A.d[2]));
        const cx = A.a[0] + A.d[0] * t, cy = A.a[1] + A.d[1] * t, cz = A.a[2] + A.d[2] * t;
        const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const r = A.r0 + (A.r1 - A.r0) * (t / A.len) + 0.6;
        if (d < r) { const s = r / d; x = cx + dx * s; y = cy + dy * s; z = cz + dz * s; }
      }
    }
    if (y < 0.5 && y > -95) {
      const [rx, rz] = bodyAt(y);
      const ex = rx + 0.7, ez = rz + 0.7;
      const q = (x * x) / (ex * ex) + (z * z) / (ez * ez);
      if (q < 1) { const s = 1 / Math.sqrt(q || 1e-6); x *= s; z *= s; }
    }
    pos[ix] = x; pos[ix + 1] = y; pos[ix + 2] = z;
  }
}

/**
 * Point de la capuche relevée (statique), comme sur une photo de produit en forme fantôme : la capuche part de
 * toute l'encolure, monte en coque derrière l'emplacement de la tête et s'ouvre vers l'avant, ses deux bords se
 * rejoignant au milieu devant de l'encolure. u fait le tour (bord gauche → dos → bord droit) ; v va de l'encolure
 * (0) au bord de l'ouverture (1). Vue de face, l'ouverture encadre l'encolure : le hoodie se distingue du sweat.
 */
export function hoodPoint(g: Garment, u: number, v: number): [number, number, number] {
  const b = 0.03 + 0.94 * u; // petit écart au milieu devant : les deux bords de l'ouverture
  const a = 2 * Math.PI * b; // 0 = milieu devant, π = milieu dos
  const front = (1 + Math.cos(a)) / 2; // 1 devant, 0 dos
  // Encolure (couture capuche-corps), un peu plus large que celle du corps.
  const neckY = -1.5 - (g.neckDropBack + (g.neckDrop - g.neckDropBack) * front);
  const N = [-10.8 * Math.sin(a), neckY, 9.4 * Math.cos(a)];
  // Bord de l'ouverture : ovale presque vertical, tourné vers l'avant, dont le bas rejoint l'encolure devant.
  const oy = 19, cy = -1.5 - g.neckDrop + 1 + oy;
  const F = [-10.5 * Math.sin(a), cy - oy * Math.cos(a), 4.8 - 2.6 * (1 - front)];
  // Volume : la coque se gonfle vers l'arrière et vers le haut, surtout au dos.
  const t = v, bulge = Math.sin(Math.PI * t) * (2.5 + 7.5 * (1 - front));
  const P = [N[0] + (F[0] - N[0]) * t, N[1] + (F[1] - N[1]) * t, N[2] + (F[2] - N[2]) * t];
  const dx = P[0], dy = P[1] - 6, dz = P[2] + 3, n = Math.hypot(dx, dy, dz) || 1;
  return [P[0] + (dx / n) * bulge, P[1] + (dy / n) * bulge, P[2] + (dz / n) * bulge];
}
