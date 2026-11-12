// Non-régression du moteur : les exports des 8 motifs de test doivent rester identiques,
// octet pour octet, aux fichiers de référence de l'étiquette v0.2.0 (registre d'empreintes).
import { describe, expect, it } from "vitest";
import { buildPlan, DEMO_COLORS, DEMO_MOTIFS, encodePlan, parseFingerprints, traceImage, traceOptions } from "../src/index.js";
import { loadMotif, readFixture, sha256 } from "./helpers.js";

const REGISTRY = readFixture("empreintes-reference-v0.2.0.sha256");
const byFile = new Map([...parseFingerprints(REGISTRY)].map(([h, f]) => [f, h]));

describe("registre d'empreintes v0.2.0", () => {
  it("contient les 45 fichiers PES/DST de référence et n'a pas été modifié", () => {
    expect(byFile.size).toBe(45);
    expect(sha256(new TextEncoder().encode(REGISTRY))).toBe(
      "719ef6c6a2f196c9762f7bc26887587c12e2a3999b768172870a6c2c754770d2",
    );
    expect([...byFile.keys()].filter((f) => f.startsWith("xe1-kit/")).length).toBe(21);
  });
});

describe("exports identiques aux fichiers de référence v0.2.0", () => {
  for (const motif of DEMO_MOTIFS) {
    it(motif, () => {
      const { design } = traceImage(loadMotif(motif), traceOptions({ colors: DEMO_COLORS[motif] ?? 6 }), motif);
      const plan = buildPlan(design);
      expect(sha256(encodePlan(plan, "pes", motif))).toBe(byFile.get(`motifs/${motif}.pes`));
      expect(sha256(encodePlan(plan, "pes6", motif))).toBe(byFile.get(`motifs/${motif}.v6.pes`));
      expect(sha256(encodePlan(plan, "dst", motif))).toBe(byFile.get(`motifs/${motif}.dst`));
    });
  }
});
