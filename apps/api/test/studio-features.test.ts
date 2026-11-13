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

describe("erreurs traduisibles (lot 3.1)", () => {
  it("chaque refus de nuancier porte une raison et ses paramètres", async () => {
    const { c } = await signup(ctx.app);
    const cases: [Record<string, unknown>, string, Record<string, unknown> | undefined][] = [
      [{ ...base, source: "", csv: CSV }, "chart_no_source", undefined],
      [{ ...base, csv: "code;nom\n1;a\n" }, "chart_no_color_column", undefined],
      [{ ...base, csv: "code;hex\n1;#ffffff\n1;#000000\n" }, "chart_line_duplicate", { line: 2, code: "1" }],
      [{ ...base, status: "officiel", source: "un site", csv: CSV }, "chart_official_source", undefined],
      [{ ...base, csv: "code;hex\n1;#zzzzzz\n" }, "chart_line_color", { line: 1, value: "#zzzzzz" }],
    ];
    for (const [body, reason, params] of cases) {
      const r = await c.post("/api/thread-charts", body);
      expect(r.json.error).toMatchObject({ code: "bad_request", reason });
      if (params) expect(r.json.error.params).toEqual(params);
      expect(r.json.error.details[0].reason).toBe(reason);
    }
  });

  it("chaque message du lecteur de nuanciers du moteur figé est rattaché à une raison précise", async () => {
    const { chartReason } = await import("../src/routes/charts.js");
    const src = fs.readFileSync(new URL("../../../packages/engine/src/generated/engine.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("function m_R3"), src.indexOf("function m_kb")) + src.slice(src.indexOf("function parseChartCsv"), src.indexOf("function parseChartCsv") + 3000);
    const msgs = [...body.matchAll(/(?:push\(|errors: \[)\s*(["`])((?:Ligne|[A-Z]).*?)\1/g)].map((m) => m[2].replace(/\$\{[^}]+\}/g, "7"));
    expect(msgs.length).toBeGreaterThanOrEqual(11);
    for (const m of msgs) expect(chartReason(m).reason, m).not.toBe("chart_invalid");
  });

  it("erreurs de validation : code et limites de chaque champ", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/auth/signup", headers: { "x-vyra-client": "web" }, payload: { email: "pas-un-email", password: "court", displayName: "", acceptTerms: false } });
    const d = Object.fromEntries(r.json().error.details.map((x: any) => [x.path, x]));
    expect(d.email).toMatchObject({ issue: "invalid_format", format: "email" });
    expect(d.password).toMatchObject({ issue: "too_small", origin: "string", minimum: 10 });
    expect(d.displayName).toMatchObject({ issue: "too_small", minimum: 1 });
    expect(d.acceptTerms).toMatchObject({ issue: "invalid_value" });
  });

  it("raisons précises sur les refus courants", async () => {
    const { c } = await signup(ctx.app);
    expect((await c.get("/api/projects/00000000-0000-4000-8000-000000000000")).json.error).toMatchObject({ code: "not_found", reason: "project_not_found" });
    expect((await c.post("/api/auth/change-password", { currentPassword: "faux-mot-de-passe", newPassword: "un-nouveau-mot-de-passe" })).json.error).toMatchObject({ reason: "wrong_current_password" });
  });
});
