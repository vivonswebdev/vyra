import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signup, teardown, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const CSV = "code;nom;hex\n1001;Blanc;#FFFFFF\n1147;Rouge vif;#C8102E\n1971;Brun;5A3A28\n";
const base = { brand: "Marque test", product: "Polyester 40", status: "utilisateur", source: "Relevé au colorimètre, atelier, 11/2026" };

describe("nuanciers CSV", () => {
  it("importe un nuancier sourcé et le liste pour son propriétaire seulement", async () => {
    const { c } = await signup(ctx.app);
    const r = await c.post("/api/thread-charts", { ...base, csv: CSV });
    expect(r.status).toBe(201);
    expect(r.json.chart.entries).toEqual([
      { code: "1001", name: "Blanc", rgb: "#ffffff" },
      { code: "1147", name: "Rouge vif", rgb: "#c8102e" },
      { code: "1971", name: "Brun", rgb: "#5a3a28" },
    ]);
    expect((await c.get("/api/thread-charts")).json.charts).toHaveLength(1);
    const other = await signup(ctx.app);
    expect((await other.c.get("/api/thread-charts")).json.charts).toEqual([]);
    expect((await other.c.del(`/api/thread-charts/${r.json.chart.id}`)).status).toBe(404);
    expect((await c.del(`/api/thread-charts/${r.json.chart.id}`)).status).toBe(200);
  });

  it("refuse un nuancier sans source, sans colonne de couleur, avec doublons ou officiel sans référence", async () => {
    const { c } = await signup(ctx.app);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...base, source: "", csv: CSV }, /Source manquante/],
      [{ ...base, csv: "code;nom\n1;a\n" }, /Colonne de couleur/],
      [{ ...base, csv: "code;hex\n1;#ffffff\n1;#000000\n" }, /double/],
      [{ ...base, status: "officiel", source: "un site", csv: CSV }, /officiel/],
      [{ ...base, csv: "code;hex\n1;#zzzzzz\n" }, /invalide/],
    ];
    for (const [body, msg] of cases) {
      const r = await c.post("/api/thread-charts", body);
      expect(r.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(JSON.stringify(r.json.error)).toMatch(msg);
    }
  });
});

describe("import d'un projet .stitch.json de la v0.2", () => {
  it("accepte le fichier produit par l'ancien Studio et refuse un document incohérent", async () => {
    const { c } = await signup(ctx.app);
    const design = JSON.parse(fs.readFileSync(new URL("../../../e2e/fixtures/02-fleur-v0.2.stitch.json", import.meta.url), "utf8"));
    const r = await c.post("/api/projects", { name: "02-fleur", design, settings: { machineId: "brother-xe1", hoopId: "sa439s", importedFrom: "02-fleur.stitch.json" } });
    expect(r.status).toBe(201);
    // Chaîne complète v0.2 → import → export serveur : empreinte identique au fichier de référence v0.2.0.
    const expected = { pes: "2c3ad4431a9567fca9eea33169800594a58be1a1769bf2e524bb2accfca7bcf0", pes6: "7b932bce2ac0fa137cd1a11bfb9eaf101173694496b4f85477ca7074088a601c", dst: "c78e0c5b7b669b21c2bc0e8af558ca3b0f836795723ab8dc496b05438926b6fa" };
    const registry = fs.readFileSync(new URL("../../../packages/engine/fixtures/empreintes-reference-v0.2.0.sha256", import.meta.url), "utf8");
    for (const [format, sha] of Object.entries(expected)) {
      expect(registry).toContain(sha);
      const e = await c.post(`/api/projects/${r.json.project.id}/exports`, { format });
      expect(e.json.export.stats.stitches).toBe(9513);
      expect(e.json.export.sha256).toBe(sha);
    }
    const broken = { ...design, objects: design.objects.map((o: any) => ({ ...o, color: 99 })) };
    expect((await c.post("/api/projects", { name: "Cassé", design: broken })).status).toBe(400);
  });
});
