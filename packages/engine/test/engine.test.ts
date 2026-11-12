import { describe, expect, it } from "vitest";
import {
  analyze,
  buildPlan,
  computeStats,
  detectFormat,
  encodePlan,
  exportDesign,
  ExportBlockedError,
  mapObjectPoints,
  planToSvg,
  readEmbroidery,
  safeFileName,
  technicalSheet,
  traceImage,
  traceOptions,
  type Design,
} from "../src/index.js";
import { loadMotif } from "./helpers.js";

const fleur = (): Design => traceImage(loadMotif("02-fleur"), traceOptions({ colors: 5 }), "02-fleur").design;

describe("analyse et plan", () => {
  it("produit un document déterministe", () => {
    const a = fleur();
    const b = fleur();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.threads.length).toBe(5);
    expect(a.widthMm).toBeCloseTo(100, 5);
  });

  it("calcule les statistiques du motif 02-fleur (valeurs v0.2)", () => {
    const s = computeStats(buildPlan(fleur()));
    expect(s.stitches).toBe(9513);
    expect(s.colorChanges).toBe(4);
    expect(s.trims).toBe(11);
  });

  it("un déplacement d'objet modifie le plan et revient à l'identique", () => {
    const d = fleur();
    const before = encodePlan(buildPlan(d), "dst", "x");
    const moved = { ...d, objects: d.objects.map((o, i) => (i === 0 ? mapObjectPoints(o, (p) => ({ x: p.x + 5, y: p.y })) : o)) };
    const after = encodePlan(buildPlan(moved), "dst", "x");
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
    const back = { ...moved, objects: moved.objects.map((o, i) => (i === 0 ? mapObjectPoints(o, (p) => ({ x: p.x - 5, y: p.y })) : o)) };
    expect(computeStats(buildPlan(back)).stitches).toBe(computeStats(buildPlan(d)).stitches);
  });
});

describe("contrôle qualité et export", () => {
  it("bloque l'export d'un motif plus large que le cadre 130 mm", () => {
    const d = traceImage(loadMotif("02-fleur"), traceOptions({ colors: 5, targetWidthMm: 140, maxHeightMm: 250 }), "grand").design;
    const a = analyze(d, "brother-xe1", "sa439s");
    expect(a.qc.blocking).toBe(true);
    expect(() => exportDesign(d, "pes", { label: "grand", machineId: "brother-xe1", hoopId: "sa439s" })).toThrow(ExportBlockedError);
    // Le grand cadre l'accepte.
    expect(analyze(d, "brother-xe1", "sa449s").qc.blocking).toBe(false);
  });

  it("exporte quand rien ne bloque et nomme le fichier proprement", () => {
    const r = exportDesign(fleur(), "pes6", { label: "Fleur d'été", machineId: "brother-xe1", hoopId: "sa439s" });
    expect(r.filename).toBe("Fleur-d-ete-v6.pes");
    expect(detectFormat(r.bytes)).toBe("PES");
    expect(safeFileName("  ")).toBe("motif");
  });

  it("l'aperçu SVG porte la marque VYRA", () => {
    expect(planToSvg(buildPlan(fleur()), "fleur")).toContain("aperçu VYRA");
  });
});

describe("lecteurs PES et DST", () => {
  const plan = buildPlan(fleur());
  const ref = computeStats(plan);
  for (const fmt of ["pes", "pes6", "dst"] as const) {
    it(`relit un ${fmt} exporté : points, dimensions, couleurs`, () => {
      const bytes = encodePlan(plan, fmt, "02-fleur");
      const { sheet } = technicalSheet(bytes);
      expect(sheet.stitches).toBe(ref.stitches);
      expect(Math.abs(sheet.widthMm - ref.widthMm)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(sheet.heightMm - ref.heightMm)).toBeLessThanOrEqual(0.25);
      expect(sheet.colorChanges).toBe(ref.colorChanges);
      if (fmt !== "dst") expect(sheet.colors).toBe(5);
      expect(sheet.warnings.filter((w) => w.includes("tronqué"))).toEqual([]);
    });
  }

  it("refuse un fichier qui n'est ni PES ni DST", () => {
    expect(() => readEmbroidery(new TextEncoder().encode("<svg></svg>"))).toThrow(/Format non reconnu/);
  });

  it("signale un PES tronqué au milieu des points sans planter", () => {
    const bytes = encodePlan(plan, "pes", "x");
    const pecStart = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
    const cut = bytes.slice(0, pecStart + 532 + 2000);
    const r = readEmbroidery(cut);
    expect(r.warnings.join(" ")).toMatch(/tronqué/);
    expect(r.stitches.length).toBeGreaterThan(100);
  });

  it("refuse un PES dont la section PEC est absente", () => {
    const bytes = encodePlan(plan, "pes", "x");
    expect(() => readEmbroidery(bytes.slice(0, 400))).toThrow(/PEC/);
  });
});
