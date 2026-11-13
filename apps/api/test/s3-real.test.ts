// Stockage S3 contre un VRAI serveur compatible S3 (MinIO en local et en CI ; tout fournisseur via les
// mêmes variables). Exécuté si S3_TEST_ENDPOINT est défini, avec des identifiants de TEST uniquement.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "../src/lib/s3storage.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { Client, setup, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";

const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "";
const AK = process.env.S3_TEST_ACCESS_KEY ?? "";
const SK = process.env.S3_TEST_SECRET_KEY ?? "";
const REGION = process.env.S3_TEST_REGION ?? "us-east-1";
const BUCKET = "vyra-test-" + crypto.randomBytes(4).toString("hex");
const ROOT = path.resolve(__dirname, "../../..");
const PNG = fs.readFileSync(path.join(ROOT, "packages/engine/fixtures/motifs/02-fleur.png"));

describe.runIf(!!ENDPOINT)(`stockage S3 réel (${ENDPOINT || "non configuré"})`, () => {
  let ctx: Ctx;
  const store = (over: Partial<ConstructorParameters<typeof S3Storage>[0]> = {}) =>
    new S3Storage({ endpoint: ENDPOINT, region: REGION, bucket: BUCKET, prefix: "app", accessKeyId: AK, secretAccessKey: SK, ...over });

  beforeAll(async () => {
    ctx = await setup();
    const admin = new S3Client({ endpoint: ENDPOINT, region: REGION, forcePathStyle: true, credentials: { accessKeyId: AK, secretAccessKey: SK } });
    await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
  });
  afterAll(async () => teardown(ctx));

  it("dépose, relit, liste et supprime", async () => {
    const s = store();
    const bytes = crypto.randomBytes(200_000);
    await s.put("exports/a/b.pes", bytes);
    expect(Buffer.compare(await s.get("exports/a/b.pes"), bytes)).toBe(0);
    expect(await s.exists("exports/a/b.pes")).toBe(true);
    expect(await s.list()).toContain("exports/a/b.pes");
    await s.delete("exports/a/b.pes");
    expect(await s.exists("exports/a/b.pes")).toBe(false);
  });

  it("les objets sont privés : aucun accès anonyme à l'objet ni à la liste", async () => {
    await store().put("sources/prive.png", PNG);
    expect((await fetch(`${ENDPOINT}/${BUCKET}/app/sources/prive.png`)).status).toBe(403);
    expect((await fetch(`${ENDPOINT}/${BUCKET}?list-type=2`)).status).toBe(403);
  });

  it("URL temporaire : valide, en pièce jointe et type neutre, puis expirée", async () => {
    const s = store();
    await s.put("sources/temp.png", PNG);
    const url = await s.presignGet("sources/temp.png", { expiresInSeconds: 60, filename: "fleur d'été.png" });
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.compare(Buffer.from(await r.arrayBuffer()), PNG)).toBe(0);
    const short = await s.presignGet("sources/temp.png", { expiresInSeconds: 1, filename: "x.png" });
    await new Promise((res) => setTimeout(res, 2500));
    expect((await fetch(short)).status).toBe(403);
    // Une URL modifiée (autre objet) est refusée.
    expect((await fetch(url.replace("temp.png", "prive.png"))).status).toBe(403);
  });

  it("erreurs d'authentification et réseau : échec net et rapide, aucune écriture", async () => {
    await expect(store({ secretAccessKey: "mauvais-secret" }).put("x/y.bin", Buffer.from("x"))).rejects.toMatchObject({ name: expect.stringMatching(/SignatureDoesNotMatch|InvalidAccessKeyId|AccessDenied/) });
    await expect(store({ accessKeyId: "INCONNU" }).get("sources/prive.png")).rejects.toBeTruthy();
    const t0 = Date.now();
    await expect(store({ endpoint: "http://127.0.0.1:1", connectionTimeoutMs: 1000 }).put("x/y.bin", Buffer.from("x"))).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(await store().exists("x/y.bin")).toBe(false);
  });

  it("parcours API : fichier déposé dans S3, téléchargement par URL temporaire après contrôle d'accès", async () => {
    const cfg = loadConfig({ NODE_ENV: "test" } as any, {
      DATABASE_URL: "unused", LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000,
      STORAGE_DRIVER: "s3", S3_ENDPOINT: ENDPOINT, S3_REGION: REGION, S3_BUCKET: BUCKET, S3_PREFIX: "api",
      S3_ACCESS_KEY_ID: AK, S3_SECRET_ACCESS_KEY: SK, S3_PRESIGNED_DOWNLOADS: "true", S3_PRESIGN_TTL_SECONDS: 30,
    } as any);
    const app = await buildApp({ cfg, db: ctx.db });
    const { c } = await signup(app);
    const p = (await c.post("/api/projects", { name: "s3", design: null })).json.project;
    const b = "----vyra-s3";
    const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]);
    const up = await c.req("POST", `/api/projects/${p.id}/source`, body, { "content-type": `multipart/form-data; boundary=${b}` });
    expect(up.status).toBe(200);
    const dl = await c.get(`/api/files/${up.json.file.id}`);
    expect(dl.status).toBe(302);
    const loc = String(dl.res.headers.location);
    expect(loc).toContain(`/${BUCKET}/api/sources/`);
    expect(loc).toContain("X-Amz-Expires=30");
    expect(Buffer.compare(Buffer.from(await (await fetch(loc)).arrayBuffer()), PNG)).toBe(0);
    // Sans session, ou pour un autre compte : aucune URL n'est délivrée.
    expect((await new Client(app).get(`/api/files/${up.json.file.id}`)).status).toBe(401);
    expect((await (await signup(app)).c.get(`/api/files/${up.json.file.id}`)).status).toBe(404);
    await app.close();
  });

  it("sauvegarde puis restauration complètes avec stockage S3", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-s3-backup-"));
    const env = { ...process.env, DATABASE_URL: TEST_DB, STORAGE_DRIVER: "s3", S3_ENDPOINT: ENDPOINT, S3_REGION: REGION, S3_BUCKET: BUCKET, S3_PREFIX: "api", S3_ACCESS_KEY_ID: AK, S3_SECRET_ACCESS_KEY: SK };
    const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/backup.mjs"), tmp], { env, encoding: "utf8" }).trim().split("\n").pop()!;
    const admin = new pg.Client({ connectionString: TEST_DB });
    await admin.connect();
    await admin.query("DROP DATABASE IF EXISTS vyra_restore");
    await admin.query("CREATE DATABASE vyra_restore");
    await admin.end();
    const RESTORE_DB = TEST_DB.replace(/\/[^/]+$/, "/vyra_restore");
    execFileSync(process.execPath, [path.join(ROOT, "scripts/restore.mjs"), out], { env: { ...env, DATABASE_URL: RESTORE_DB, S3_PREFIX: "restaure" }, stdio: "pipe" });
    const db2 = createPool(RESTORE_DB);
    const { rows } = await db2.query("SELECT storage_key, sha256 FROM files WHERE kind = 'source_image' AND deleted_at IS NULL LIMIT 1");
    const restored = await store({ prefix: "restaure" }).get(rows[0].storage_key);
    expect(crypto.createHash("sha256").update(restored).digest("hex")).toBe(rows[0].sha256);
    await db2.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 120_000);
});
