// Durcissement : calculs du moteur bornés, documents malformés ou piégés, limites de taille,
// SVG et injection, intégrité des exports, erreurs serveur sans fuite d'information.
import fs from "node:fs";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { traceImage, traceOptions, type Design } from "@vyra/engine";
import { EnginePool } from "../src/engine/pool.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Client, setup, signup, teardown, type Ctx } from "./helpers.js";

let ctx: Ctx;
let fleur: Design;
const motif = new URL("../../../packages/engine/fixtures/motifs/02-fleur.png", import.meta.url);
const blank = { name: "Toile", widthMm: 100, heightMm: 100, threads: [{ rgb: "#5a3a28", name: "Brun", brand: "", code: "" }], objects: [] as any[] };

beforeAll(async () => {
  ctx = await setup();
  const png = PNG.sync.read(fs.readFileSync(motif));
  fleur = traceImage({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, traceOptions({ colors: 5 }), "02-fleur").design;
});
afterAll(async () => teardown(ctx));

function multipart(filename: string, bytes: Buffer, type: string) {
  const boundary = "----vyra" + crypto.randomBytes(6).toString("hex");
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("pool de calcul du moteur", () => {
  it("interrompt un calcul trop long, puis reprend normalement", async () => {
    const pool = new EnginePool({ size: 1, timeoutMs: 200, maxQueue: 5, maxMemoryMb: 256 });
    const t0 = Date.now();
    await expect(pool.run("spin", { ms: 5000 })).rejects.toMatchObject({ status: 503, code: "engine_timeout" });
    expect(Date.now() - t0).toBeLessThan(2000);
    await expect(pool.run("spin", { ms: 5 })).resolves.toEqual({ done: true });
    expect(pool.stats.timeouts).toBe(1);
    await pool.close();
  });

  it("refuse les tâches au-delà de la file d'attente au lieu de saturer le serveur", async () => {
    const pool = new EnginePool({ size: 1, timeoutMs: 5000, maxQueue: 1, maxMemoryMb: 256 });
    const a = pool.run("spin", { ms: 300 });
    const b = pool.run("spin", { ms: 10 });
    await expect(pool.run("spin", { ms: 10 })).rejects.toMatchObject({ status: 503, code: "engine_busy" });
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
    await pool.close();
  });

  it("par l'API : un export trop long répond 503 sans bloquer les autres requêtes", async () => {
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000, ENGINE_TIMEOUT_MS: 1 } as any);
    const app = await buildApp({ cfg, db: ctx.db });
    const { c } = await signup(app);
    const p = (await c.post("/api/projects", { name: "Lent", design: fleur })).json.project;
    const [r, health] = await Promise.all([c.post(`/api/projects/${p.id}/exports`, { format: "pes" }), c.get("/api/health")]);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("engine_timeout");
    expect(health.status).toBe(200);
    await app.close();
  });
});

describe("documents malformés ou piégés", () => {
  const obj = (over: Record<string, unknown> = {}) => ({
    id: "obj1", name: "o", type: "fill", color: 0, closed: false, visible: true,
    shape: { outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], holes: [] },
    fill: { angle: 45, spacing: 0.4, stitchLength: 3, stagger: 0.33, pullComp: 0.2, underlay: "none", underlaySpacing: 2.5, underlayInset: 0.5 },
    satin: { angle: null, spacing: 0.4, pullComp: 0.25, underlay: "center", width: 2.5 },
    run: { stitchLength: 2.5, repeats: 1 },
    ...over,
  });

  it("refuse une densité nulle (calcul sans fin), un fil inexistant, un type inconnu", async () => {
    const { c } = await signup(ctx.app);
    const bad = [
      obj({ fill: { ...obj().fill, spacing: 0 } }),
      obj({ color: 3 }),
      obj({ type: "script" }),
      obj({ run: { stitchLength: 2.5, repeats: 1000 } }),
    ];
    for (const o of bad) {
      const r = await c.post("/api/projects", { name: "piège", design: { ...blank, objects: [o] } });
      expect(r.status, JSON.stringify(o).slice(0, 80)).toBe(400);
    }
    expect((await c.post("/api/projects", { name: "sain", design: { ...blank, objects: [obj()] } })).status).toBe(201);
  });

  it("refuse un document de plus de 400 000 points", async () => {
    const { c } = await signup(ctx.app);
    const ring = Array.from({ length: 100_000 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100) % 100 }));
    const objects = [0, 1, 2, 3, 4].map((k) => obj({ id: "o" + k, shape: { outer: ring, holes: [] } }));
    const r = await c.post("/api/projects", { name: "énorme", design: { ...blank, objects } });
    expect([400, 413]).toContain(r.status);
  });

  it("refuse un fichier source dont le contenu ne correspond pas à une image", async () => {
    const { c } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "src", design: null })).json.project;
    for (const [name, bytes, type] of [
      ["photo.png", Buffer.from("<?php system($_GET['x']); ?>"), "image/png"],
      ["image.jpg", Buffer.from([0x00, 0x01, 0x02, 0x03]), "image/jpeg"],
      ["vide.png", Buffer.alloc(0), "image/png"],
      ["dessin.txt", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml"],
    ] as const) {
      const mp = multipart(name, bytes as Buffer, type);
      const r = await c.req("POST", `/api/projects/${p.id}/source`, mp.body, { "content-type": mp.contentType });
      expect(r.status, name).toBe(400);
    }
  });

  it("refuse un fichier source de plus de 20 Mo", async () => {
    const { c } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "gros", design: null })).json.project;
    const big = Buffer.concat([fs.readFileSync(motif), Buffer.alloc(21 * 1024 * 1024)]);
    const mp = multipart("gros.png", big, "image/png");
    const r = await c.req("POST", `/api/projects/${p.id}/source`, mp.body, { "content-type": mp.contentType });
    expect([400, 413]).toContain(r.status);
    expect((await ctx.db.query("SELECT count(*)::int n FROM files WHERE kind = 'source_image' AND size_bytes > 20000000")).rows[0].n).toBe(0);
  });

  it("refuse un corps JSON plus grand que la limite", async () => {
    const { c } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "x", design: blank })).json.project;
    const r = await c.patch(`/api/projects/${p.id}`, { baseRevision: 1, design: { ...blank, name: "a".repeat(13 * 1024 * 1024) } });
    expect(r.status).toBe(413);
  });
});

describe("SVG et injection", () => {
  it("un SVG source contenant du script est servi en pièce jointe, dans un bac à sable", async () => {
    const { c } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "svg", design: null })).json.project;
    const evil = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.cookie)</script><rect width="10" height="10"/></svg>`);
    const mp = multipart("logo.svg", evil, "image/svg+xml");
    const up = await c.req("POST", `/api/projects/${p.id}/source`, mp.body, { "content-type": mp.contentType });
    expect(up.status).toBe(200);
    const dl = await c.get(`/api/files/${up.json.file.id}`);
    expect(dl.res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(dl.res.headers["content-security-policy"]).toContain("sandbox");
    expect(dl.res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("un nom de projet hostile n'injecte rien dans la miniature SVG", async () => {
    const { c } = await signup(ctx.app);
    const name = `</title><script>alert(1)</script><title>`;
    const p = (await c.post("/api/projects", { name, design: fleur })).json.project;
    const r = await c.get(p.thumbnailUrl);
    expect(r.status).toBe(200);
    expect(r.res.body).not.toContain("<script");
    expect(r.res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("un nom de fichier hostile n'injecte rien dans l'en-tête de téléchargement", async () => {
    const { c } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "x", design: null })).json.project;
    const mp = multipart('a"\r\nX-Injected: 1\r\n.png', fs.readFileSync(motif), "image/png");
    const up = await c.req("POST", `/api/projects/${p.id}/source`, mp.body, { "content-type": mp.contentType });
    if (up.status === 200) {
      const dl = await c.get(`/api/files/${up.json.file.id}`);
      expect(dl.res.headers["x-injected"]).toBeUndefined();
    } else expect(up.status).toBe(400);
  });
});

describe("intégrité des exports", () => {
  it("l'empreinte annoncée, l'empreinte stockée et les octets téléchargés concordent", async () => {
    const { c } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "02-fleur", design: fleur, settings: { machineId: "brother-xe1", hoopId: "sa439s" } })).json.project;
    for (const format of ["pes", "pes6", "dst"]) {
      const e = (await c.post(`/api/projects/${p.id}/exports`, { format })).json.export;
      const dl = await c.get(e.downloadUrl);
      const sha = crypto.createHash("sha256").update(dl.res.rawPayload).digest("hex");
      expect(sha).toBe(e.sha256);
      expect(dl.res.rawPayload.length).toBe(e.size);
      const { rows } = await ctx.db.query("SELECT f.sha256 FROM project_exports x JOIN files f ON f.id = x.file_id WHERE x.id = $1", [e.id]);
      expect(rows[0].sha256).toBe(sha);
    }
  });

  it("un export d'un autre compte reste inaccessible", async () => {
    const a = await signup(ctx.app);
    const b = await signup(ctx.app);
    const p = (await a.c.post("/api/projects", { name: "privé", design: fleur })).json.project;
    const e = (await a.c.post(`/api/projects/${p.id}/exports`, { format: "dst" })).json.export;
    expect((await b.c.get(e.downloadUrl)).status).toBe(404);
    expect((await new Client(ctx.app).get(e.downloadUrl)).status).toBe(401);
  });
});

describe("erreurs serveur", () => {
  it("une erreur interne ne divulgue ni pile, ni requête SQL, ni chemin", async () => {
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test" } as any);
    const app = await buildApp({ cfg, db: ctx.db });
    app.get("/api/test-boom", async () => {
      await ctx.db.query("SELECT * FROM table_inexistante");
    });
    const r = await app.inject({ method: "GET", url: "/api/test-boom" });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: { code: "internal", message: "Erreur interne. L'incident est journalisé." } });
    expect(r.body).not.toMatch(/table_inexistante|at .*\.ts|\/home\//);
    await app.close();
  });

  it("la boîte aux lettres de développement n'existe que si elle est explicitement activée", async () => {
    expect((await new Client(ctx.app).get("/api/dev/mailbox")).status).toBe(404);
    expect(() => loadConfig({ NODE_ENV: "production", DEV_MAILBOX: "1" } as any)).toThrow(/DEV_MAILBOX/);
  });
});
