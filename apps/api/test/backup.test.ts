// Sauvegarde puis restauration complète dans une autre base et un autre dossier :
// comptes, projets, versions, fichiers et exports sont retrouvés à l'identique.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { Client, setup, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";

const ROOT = path.resolve(__dirname, "../../..");
const RESTORE_DB = TEST_DB.replace(/\/[^/]+$/, "/vyra_restore");
let ctx: Ctx;
let tmp: string;

beforeAll(async () => {
  ctx = await setup();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-backup-"));
  const admin = new pg.Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS vyra_restore");
  await admin.query("CREATE DATABASE vyra_restore");
  await admin.end();
});
afterAll(async () => {
  await teardown(ctx);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sauvegarde et restauration", () => {
  it("restaure base et fichiers à l'identique, refuse une sauvegarde altérée et une cible non vide", async () => {
    const { c, email } = await signup(ctx.app);
    const design = { name: "T", widthMm: 50, heightMm: 50, threads: [{ rgb: "#5a3a28", name: "Brun", brand: "", code: "" }], objects: [] };
    const p = (await c.post("/api/projects", { name: "À sauvegarder", design })).json.project;
    await c.patch(`/api/projects/${p.id}`, { baseRevision: 1, name: "À sauvegarder v2", snapshot: true, snapshotLabel: "Avant sauvegarde" });
    const png = fs.readFileSync(path.join(ROOT, "packages/engine/fixtures/motifs/01-chat.png"));
    const b = "----vyra-bk";
    const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="chat.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${b}--\r\n`)]);
    const file = (await c.req("POST", `/api/projects/${p.id}/source`, body, { "content-type": `multipart/form-data; boundary=${b}` })).json.file;

    const env = { ...process.env, DATABASE_URL: TEST_DB, STORAGE_DIR: ctx.storageDir };
    const out = execFileSync(process.execPath, [path.join(ROOT, "scripts/backup.mjs"), tmp], { env, encoding: "utf8" }).trim().split("\n").pop()!;
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifeste.json"), "utf8"));
    expect(Object.keys(manifest.fichiers).sort()).toEqual(["base.dump", "stockage.tar.gz"]);

    // Restauration dans une base et un dossier neufs.
    const restoredStorage = path.join(tmp, "stockage-restaure");
    const renv = { ...process.env, DATABASE_URL: RESTORE_DB, STORAGE_DIR: restoredStorage };
    execFileSync(process.execPath, [path.join(ROOT, "scripts/restore.mjs"), out], { env: renv, stdio: "pipe" });

    const db2 = createPool(RESTORE_DB);
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: RESTORE_DB, STORAGE_DIR: restoredStorage, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000 } as any);
    const app2 = await buildApp({ cfg, db: db2 });
    const c2 = new Client(app2);
    expect((await c2.post("/api/auth/login", { email, password: "un-mot-de-passe-solide" })).status).toBe(200);
    const restored = (await c2.get(`/api/projects/${p.id}`)).json.project;
    expect(restored.name).toBe("À sauvegarder v2");
    expect((await c2.get(`/api/projects/${p.id}/versions`)).json.versions.map((v: any) => v.label)).toContain("Avant sauvegarde");
    const dl = await c2.get(`/api/files/${file.id}`);
    expect(Buffer.compare(dl.res.rawPayload, png)).toBe(0);
    await app2.close();
    await db2.end();

    // Une seconde restauration sur la même cible est refusée sans --remplacer.
    const again = spawnSync(process.execPath, [path.join(ROOT, "scripts/restore.mjs"), out], { env: renv, encoding: "utf8" });
    expect(again.status).toBe(4);
    expect(again.stderr).toMatch(/--remplacer/);

    // Une sauvegarde altérée est refusée avant toute écriture.
    fs.appendFileSync(path.join(out, "base.dump"), "x");
    const altered = spawnSync(process.execPath, [path.join(ROOT, "scripts/restore.mjs"), out, "--remplacer"], { env: renv, encoding: "utf8" });
    expect(altered.status).toBe(3);
    expect(altered.stderr).toMatch(/altérée/);
  }, 120_000);
});
