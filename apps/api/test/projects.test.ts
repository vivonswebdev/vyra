import fs from "node:fs";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { buildPlan, encodePlan, readEmbroidery, traceImage, traceOptions, type Design } from "@vyra/engine";
import { setup, signup, teardown, type Ctx } from "./helpers.js";

let ctx: Ctx;
let design: Design;
const motifPath = new URL("../../../packages/engine/fixtures/motifs/02-fleur.png", import.meta.url);

beforeAll(async () => {
  ctx = await setup();
  const png = PNG.sync.read(fs.readFileSync(motifPath));
  design = traceImage({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, traceOptions({ colors: 5 }), "02-fleur").design;
});
afterAll(async () => teardown(ctx));

function multipart(field: string, filename: string, bytes: Buffer, type: string) {
  const boundary = "----vyra" + crypto.randomBytes(8).toString("hex");
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("projets : cycle de vie", () => {
  it("crée, liste, ouvre et enregistre un projet avec contrôle de révision", async () => {
    const { c } = await signup(ctx.app);
    const created = await c.post("/api/projects", { name: "Fleur d'été", design, settings: { machineId: "brother-xe1", hoopId: "sa439s", demoMotif: "02-fleur" } });
    expect(created.status).toBe(201);
    const p = created.json.project;
    expect(p).toMatchObject({ name: "Fleur d'été", revision: 1, hasDesign: true, stats: { objects: design.objects.length, colors: 5 } });

    const list = await c.get("/api/projects");
    expect(list.json.projects.map((x: any) => x.id)).toEqual([p.id]);

    const opened = await c.get(`/api/projects/${p.id}`);
    expect(opened.json.project.design).toEqual(JSON.parse(JSON.stringify(design)));

    const renamed = { ...design, objects: design.objects.map((o, i) => (i === 0 ? { ...o, name: "Pétales" } : o)) };
    const saved = await c.patch(`/api/projects/${p.id}`, { baseRevision: 1, design: renamed });
    expect(saved.status).toBe(200);
    expect(saved.json.project.revision).toBe(2);
    expect(saved.json.project.design.objects[0].name).toBe("Pétales");

    // Un autre onglet resté sur la révision 1 ne peut pas écraser le travail.
    const stale = await c.patch(`/api/projects/${p.id}`, { baseRevision: 1, name: "Écrasement" });
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.currentRevision).toBe(2);
  });

  it("retrouve les projets après déconnexion et reconnexion", async () => {
    const { c, email } = await signup(ctx.app);
    const { json } = await c.post("/api/projects", { name: "Persistant", design });
    await c.post("/api/auth/logout");
    expect((await c.get("/api/projects")).status).toBe(401);
    await c.post("/api/auth/login", { email, password: "un-mot-de-passe-solide" });
    const again = await c.get(`/api/projects/${json.project.id}`);
    expect(again.status).toBe(200);
    expect(again.json.project.design.objects.length).toBe(design.objects.length);
  });

  it("isole les projets entre comptes", async () => {
    const a = await signup(ctx.app);
    const b = await signup(ctx.app);
    const { json } = await a.c.post("/api/projects", { name: "Privé", design });
    const id = json.project.id;
    expect((await b.c.get(`/api/projects/${id}`)).status).toBe(404);
    expect((await b.c.patch(`/api/projects/${id}`, { baseRevision: 1, name: "pirate" })).status).toBe(404);
    expect((await b.c.del(`/api/projects/${id}`)).status).toBe(404);
    expect((await b.c.get(`/api/projects/${id}/thumbnail.svg`)).status).toBe(404);
    expect((await b.c.post(`/api/projects/${id}/exports`, { format: "pes" })).status).toBe(404);
    expect((await b.c.get("/api/projects")).json.projects).toEqual([]);
  });

  it("duplique, met à la corbeille, restaure, puis supprime définitivement avec confirmation", async () => {
    const { c } = await signup(ctx.app);
    const { json } = await c.post("/api/projects", { name: "Original", design });
    const id = json.project.id;
    const dup = await c.post(`/api/projects/${id}/duplicate`);
    expect(dup.json.project.name).toBe("Original (copie)");

    expect((await c.del(`/api/projects/${id}`)).status).toBe(200);
    expect((await c.get("/api/projects")).json.projects.map((p: any) => p.name)).toEqual(["Original (copie)"]);
    expect((await c.get("/api/projects?trash=1")).json.projects.map((p: any) => p.name)).toEqual(["Original"]);
    expect((await c.get(`/api/projects/${id}`)).status).toBe(404);

    expect((await c.post(`/api/projects/${id}/restore`)).status).toBe(200);
    expect((await c.get(`/api/projects/${id}`)).status).toBe(200);

    // Suppression définitive : uniquement depuis la corbeille et avec le nom exact.
    expect((await c.del(`/api/projects/${id}/permanent`, { confirmName: "Original" })).status).toBe(404);
    await c.del(`/api/projects/${id}`);
    expect((await c.del(`/api/projects/${id}/permanent`, { confirmName: "original" })).status).toBe(400);
    const gone = await c.del(`/api/projects/${id}/permanent`, { confirmName: "Original" });
    expect(gone.status).toBe(200);
    expect((await c.get("/api/projects?trash=1")).json.projects).toEqual([]);
  });
});

describe("projets : historique des versions", () => {
  it("crée des points d'historique et restaure une version antérieure", async () => {
    const { c } = await signup(ctx.app);
    const { json } = await c.post("/api/projects", { name: "Historique", design });
    const id = json.project.id;
    const fewer = { ...design, objects: design.objects.slice(0, 2) };
    const s1 = await c.patch(`/api/projects/${id}`, { baseRevision: 1, design: fewer, snapshot: true, snapshotLabel: "Deux objets" });
    expect(s1.json.project.revision).toBe(2);

    const versions = (await c.get(`/api/projects/${id}/versions`)).json.versions;
    expect(versions.map((v: any) => [v.revision, v.label])).toEqual([
      [2, "Deux objets"],
      [1, "Création"],
    ]);
    const first = versions.find((v: any) => v.revision === 1);
    const restored = await c.post(`/api/projects/${id}/versions/${first.id}/restore`);
    expect(restored.json.project.revision).toBe(3);
    expect(restored.json.project.design.objects.length).toBe(design.objects.length);
    expect((await c.get(`/api/projects/${id}/versions`)).json.versions[0].label).toBe("Restauration de la révision 1");
  });
});

describe("projets : miniature, image source, exports machine", () => {
  it("calcule la miniature SVG côté serveur avec une politique de sécurité stricte", async () => {
    const { c } = await signup(ctx.app);
    const { json } = await c.post("/api/projects", { name: "Mini", design });
    const r = await c.get(json.project.thumbnailUrl);
    expect(r.status).toBe(200);
    expect(r.res.headers["content-type"]).toContain("image/svg+xml");
    expect(r.res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.res.body).toContain("<svg");
    expect(r.res.body).toContain("aperçu VYRA");
  });

  it("enregistre l'image source après contrôle de sa signature", async () => {
    const { c } = await signup(ctx.app);
    const { json } = await c.post("/api/projects", { name: "Source", design: null });
    const png = fs.readFileSync(motifPath);
    const mp = multipart("file", "fleur.png", png, "image/png");
    const up = await c.req("POST", `/api/projects/${json.project.id}/source`, mp.body, { "content-type": mp.contentType });
    expect(up.status).toBe(200);
    expect(up.json.file).toMatchObject({ kind: "source_image", mime: "image/png", size: png.length });
    const dl = await c.get(`/api/files/${up.json.file.id}`);
    expect(Buffer.compare(dl.res.rawPayload, png)).toBe(0);
    expect(dl.res.headers["content-disposition"]).toContain("attachment");

    const fake = multipart("file", "virus.png", Buffer.from("MZ executable"), "image/png");
    const bad = await c.req("POST", `/api/projects/${json.project.id}/source`, fake.body, { "content-type": fake.contentType });
    expect(bad.status).toBe(400);
  });

  it("exporte PES v1, PES v6 et DST avec le moteur : octets identiques au Studio", async () => {
    const { c } = await signup(ctx.app);
    const { json } = await c.post("/api/projects", { name: "02-fleur", design, settings: { machineId: "brother-xe1", hoopId: "sa439s" } });
    const id = json.project.id;
    const plan = buildPlan(design);
    for (const format of ["pes", "pes6", "dst"] as const) {
      const r = await c.post(`/api/projects/${id}/exports`, { format });
      expect(r.status).toBe(201);
      expect(r.json.export).toMatchObject({ format, revision: 1, stats: { stitches: 9513, colorChanges: 4 } });
      const dl = await c.get(r.json.export.downloadUrl);
      expect(dl.status).toBe(200);
      expect(Buffer.compare(dl.res.rawPayload, Buffer.from(encodePlan(plan, format, "02-fleur")))).toBe(0);
      expect(readEmbroidery(new Uint8Array(dl.res.rawPayload)).stitches.length).toBeGreaterThan(9000);
    }
    expect((await c.get(`/api/projects/${id}/exports`)).json.exports.map((e: any) => e.format)).toEqual(["dst", "pes6", "pes"]);
  });

  it("refuse l'export quand le contrôle qualité bloque (motif plus grand que le cadre)", async () => {
    const { c } = await signup(ctx.app);
    const png = PNG.sync.read(fs.readFileSync(motifPath));
    const big = traceImage({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, traceOptions({ colors: 5, targetWidthMm: 140, maxHeightMm: 250 }), "grand").design;
    const { json } = await c.post("/api/projects", { name: "Grand", design: big, settings: { machineId: "brother-xe1", hoopId: "sa439s" } });
    const r = await c.post(`/api/projects/${json.project.id}/exports`, { format: "pes" });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("export_blocked");
    expect(r.json.error.details.issues.length).toBeGreaterThan(0);
    expect((await c.get(`/api/projects/${json.project.id}/exports`)).json.exports).toEqual([]);
  });
});
