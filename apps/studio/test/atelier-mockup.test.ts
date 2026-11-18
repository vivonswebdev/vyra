// Maquettes 3D sculptées : maillage complet, dépliage valide, ouvertures aux bonnes cotes.
import { describe, expect, it } from "vitest";
import { GARMENTS, layoutFor, topEdge } from "../src/atelier/garments.js";
import { buildMockup, mockupShape } from "../src/atelier/mockup.js";

describe("maquettes 3D", () => {
  for (const id of ["tee", "sweat", "hoodie"] as const) {
    it(`${id} : maillage, normales et coordonnées de texture valides`, () => {
      const g = GARMENTS[id], layout = layoutFor(g), m = buildMockup(g, layout, 1.1);
      expect(m.triangles).toBeGreaterThan(5000);
      expect(m.position.length).toBe(m.triangles * 9);
      for (let i = 0; i < m.uv.length; i++) expect(m.uv[i]).toBeGreaterThanOrEqual(-1e-6), expect(m.uv[i]).toBeLessThanOrEqual(1 + 1e-6);
      for (let i = 0; i < m.normal.length; i += 3) expect(Math.abs(Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2]) - 1)).toBeLessThan(1e-3);
      // Ourlet ouvert à la longueur du patron ; rien au-dessus du col, rien sous l'ourlet.
      let minY = Infinity;
      for (let i = 1; i < m.position.length; i += 3) minY = Math.min(minY, m.position[i]);
      expect(minY).toBeGreaterThan(1 - g.H - 0.05);
      expect(minY).toBeLessThan(1 - g.H + 1);
      expect(m.cords.length).toBe(g.hood ? 2 : 0);
    });
  }

  it("encolure ouverte : aucun tissu dans le trou du col, au-dessus de la découpe", () => {
    const g = GARMENTS.tee, m = buildMockup(g, layoutFor(g), 1.1), sh = mockupShape(g);
    for (let i = 0; i < m.position.length; i += 3) {
      const x = m.position[i], y = m.position[i + 1], z = m.position[i + 2];
      if (Math.abs(x) < sh.nw * 0.6 && Math.abs(z) < 2) expect(y).toBeLessThan(sh.yT - 1);
    }
    // La découpe du devant suit l'encolure du patron (même profondeur au milieu).
    expect(sh.yrim(0, sh.bTop * 2)).toBeCloseTo(sh.yT + 0.2 - topEdge(g, 0, false), 5);
  });

  it("dépliage : le milieu devant du buste tombe au milieu de la pièce devant", () => {
    const g = GARMENTS.tee, layout = layoutFor(g), sh = mockupShape(g);
    const [u, v] = sh.atlasOf(layout, "torso", 0, -30, 20);
    expect(u).toBeCloseTo(g.W / 2, 0);
    expect(v).toBeCloseTo(31, 5);
  });
});
