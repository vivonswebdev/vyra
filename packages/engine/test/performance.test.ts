// Performance de l'analyse et du plan sur les 8 motifs de test. Budgets volontairement larges
// (machine d'intégration continue partagée) : ils détectent une régression d'un ordre de grandeur,
// pas une variation de quelques millisecondes. Les durées mesurées sont affichées.
import { describe, expect, it } from "vitest";
import { analyze, DEMO_COLORS, DEMO_MOTIFS, encodePlan, traceImage, traceOptions } from "../src/index.js";
import { loadMotif } from "./helpers.js";

const TRACE_BUDGET_MS = 4000;
const ANALYZE_BUDGET_MS = 2000;
const ENCODE_BUDGET_MS = 500;

describe("performance du moteur", () => {
  const rows: string[] = [];
  for (const m of DEMO_MOTIFS) {
    it(m, () => {
      const img = loadMotif(m);
      let t = performance.now();
      const { design } = traceImage(img, traceOptions({ colors: DEMO_COLORS[m] ?? 6 }), m);
      const trace = performance.now() - t;
      t = performance.now();
      const a = analyze(design, "brother-xe1", "sa439s");
      const an = performance.now() - t;
      t = performance.now();
      for (const f of ["pes", "pes6", "dst"] as const) encodePlan(a.plan, f, m);
      const enc = performance.now() - t;
      rows.push(`${m.padEnd(16)} analyse image ${trace.toFixed(0).padStart(5)} ms · plan+QC ${an.toFixed(0).padStart(5)} ms · 3 encodages ${enc.toFixed(0).padStart(4)} ms · ${a.stats.stitches} points`);
      expect(trace).toBeLessThan(TRACE_BUDGET_MS);
      expect(an).toBeLessThan(ANALYZE_BUDGET_MS);
      expect(enc).toBeLessThan(ENCODE_BUDGET_MS);
    });
  }
  it("rapport", () => {
    console.log("\n" + rows.join("\n"));
    expect(rows).toHaveLength(8);
  });
});
