// Atelier vêtement : géométrie des pièces et simulation du tissu (sans DOM ni WebGL).
import { describe, expect, it } from "vitest";
import { atlasToPiece, AUTO_INK_DARK, AUTO_INK_LIGHT, autoInk, clampToPiece, contrast, GARMENTS, layoutFor, pieceToAtlas, topEdge, type GarmentId } from "../src/atelier/garments.js";
import { bodyAt, buildCloth, hoodPoint, redrape, step } from "../src/atelier/cloth.js";

const IDS = Object.keys(GARMENTS) as GarmentId[];

describe("atelier : pièces de patron", () => {
  it("le devant et le dos se suivent dans l'atlas, sans recouvrement avec les manches", () => {
    for (const id of IDS) {
      const { regions, width } = layoutFor(GARMENTS[id]);
      expect(regions.back.x0).toBe(regions.front.x0 + regions.front.w);
      expect(regions.sleeveL.x0).toBe(regions.back.x0 + regions.back.w);
      expect(regions.sleeveR.x0 + regions.sleeveR.w).toBe(width);
    }
  });

  it("aller-retour pièce ↔ atlas exact", () => {
    const L = layoutFor(GARMENTS.hoodie);
    for (const piece of ["front", "back", "sleeveL", "sleeveR"] as const) {
      const [u, v] = pieceToAtlas(L, piece, 3.5, 12);
      expect(atlasToPiece(L, u, v)).toEqual({ piece, x: 3.5, y: 12 });
    }
    expect(atlasToPiece(L, 1, L.height - 1)).toBeNull(); // bande unie de la capuche : non imprimable
  });

  it("encolure plus profonde devant que dos, nulle aux épaules, pente d'épaule vers les côtés", () => {
    const g = GARMENTS.tee;
    expect(topEdge(g, 0, false)).toBeCloseTo(g.neckDrop);
    expect(topEdge(g, 0, true)).toBeCloseTo(g.neckDropBack);
    expect(topEdge(g, g.W * 0.2, false)).toBeCloseTo(0);
    expect(topEdge(g, g.W / 2, false)).toBeCloseTo(4.2);
    expect(topEdge(g, -g.W / 2, true)).toBeCloseTo(topEdge(g, g.W / 2, true));
  });

  it("un élément reste dans sa pièce", () => {
    const L = layoutFor(GARMENTS.tee);
    expect(clampToPiece(L, "front", 100, -5, 10, 4)).toEqual([L.regions.front.w / 2 - 5, 2]);
    expect(clampToPiece(L, "sleeveL", 0, 500)).toEqual([0, L.regions.sleeveL.h]);
  });
});

describe("atelier : simulation du tissu", () => {
  it.each(IDS)("%s : le tissu retombe et se stabilise sur la forme, manches sur les bras, sans valeur invalide", (id) => {
    const g = GARMENTS[id];
    const sim = buildCloth(g);
    redrape(sim, () => 0.5);
    for (let i = 0; i < 360; i++) step(sim, 1 / 120);
    const cuffOf = (k: number) => {
      const sl = sim.sleeves[k];
      const i = sl.idx[sl.rows * sl.cols];
      return [sim.pos[i * 3], sim.pos[i * 3 + 1]];
    };
    const before = [cuffOf(0), cuffOf(1)];
    for (let i = 0; i < 360; i++) step(sim, 1 / 120);
    for (let i = 0; i < sim.n * 3; i++) expect(Number.isFinite(sim.pos[i])).toBe(true);
    // Manches : le poignet ne tombe pas le long du corps (il reste dans l'axe du bras, écarté du torse).
    const after = [cuffOf(0), cuffOf(1)];
    expect(after[0][0]).toBeGreaterThan(18 + 0.5 * g.L * Math.sin((50 * Math.PI) / 180));
    expect(after[1][0]).toBeLessThan(-(18 + 0.5 * g.L * Math.sin((50 * Math.PI) / 180)));
    // Stabilité : le poignet ne bouge presque plus.
    expect(Math.hypot(after[0][0] - before[0][0], after[0][1] - before[0][1])).toBeLessThan(1.5);
    // Aucun point du torse à l'intérieur de la forme.
    for (const i of sim.torso.idx) {
      const x = sim.pos[i * 3], y = sim.pos[i * 3 + 1], z = sim.pos[i * 3 + 2];
      const [rx, rz] = bodyAt(y);
      expect((x * x) / (rx * rx) + (z * z) / (rz * rz)).toBeGreaterThan(0.98);
    }
    // L'encolure épinglée n'a pas bougé.
    for (let k = 0; k < sim.torso.cols; k++) {
      const i = sim.torso.idx[k];
      expect(sim.pos[i * 3 + 1]).toBeCloseTo(sim.rest[i * 3 + 1]);
    }
  }, 30_000);

  it("le tissu suit la main qui le tire, puis retombe", () => {
    const sim = buildCloth(GARMENTS.tee);
    for (let i = 0; i < 120; i++) step(sim, 1 / 120);
    const i = sim.torso.idx[sim.torso.rows * sim.torso.cols]; // ourlet, milieu dos-côté
    sim.grab = { i, target: [sim.pos[i * 3], sim.pos[i * 3 + 1] + 15, sim.pos[i * 3 + 2] + 10] };
    for (let k = 0; k < 30; k++) step(sim, 1 / 120);
    expect(sim.pos[i * 3 + 1]).toBeCloseTo(sim.grab.target[1], 3);
    sim.grab = { i: -1, target: [0, 0, 0] };
    const lifted = sim.pos[i * 3 + 1];
    for (let k = 0; k < 240; k++) step(sim, 1 / 120);
    expect(sim.pos[i * 3 + 1]).toBeLessThan(lifted - 5);
  }, 30_000);
});

describe("atelier : capuche relevée et encre lisible", () => {
  it("la capuche monte au-dessus de l'encolure, s'ouvre vers l'avant et se voit de face autour de l'encolure", () => {
    const g = GARMENTS.hoodie;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 10; j++) pts.push(hoodPoint(g, i / 20, j / 10));
    const top = Math.max(...pts.map((p) => p[1]));
    expect(top).toBeGreaterThan(20); // haut de la capuche bien au-dessus de la ligne d'épaule (y = 0)
    // Bas de la capuche (v = 0) : sur l'encolure, plus bas devant qu'au dos.
    expect(hoodPoint(g, 0, 0)[1]).toBeLessThan(hoodPoint(g, 0.5, 0)[1]);
    // L'ouverture (v = 1) est devant le dos de la capuche, et son sommet est en haut.
    expect(hoodPoint(g, 0.5, 1)[2]).toBeGreaterThan(hoodPoint(g, 0.5, 0.5)[2]);
    expect(hoodPoint(g, 0.5, 1)[1]).toBeCloseTo(top, 0);
    // Vue de face : de la matière à gauche et à droite au-dessus de l'épaule (elle encadre l'encolure).
    expect(pts.some((p) => p[1] > 5 && p[0] < -8)).toBe(true);
    expect(pts.some((p) => p[1] > 5 && p[0] > 8)).toBe(true);
    for (const p of pts) expect(p.every(Number.isFinite)).toBe(true);
  });

  it("l'encre automatique reste lisible sur chaque couleur de vêtement et sur le plan", () => {
    const backgrounds = ["#fbfcfd", "#f4f2ec", "#b9bdc3", "#1b1c20", "#1f2d4f", "#2f4f3e", "#7e2b2e", "#b9aed8", "#d6b45a"];
    for (const bg of backgrounds) expect(contrast(autoInk(bg), bg), bg).toBeGreaterThanOrEqual(3);
    expect(autoInk("#1f2d4f")).toBe(AUTO_INK_LIGHT); // marine : encre claire (le texte marine y était invisible)
    expect(autoInk("#f4f2ec")).toBe(AUTO_INK_DARK);
    expect(contrast(AUTO_INK_DARK, "#1f2d4f")).toBeLessThan(1.5); // le défaut corrigé, mesuré
  });
});
