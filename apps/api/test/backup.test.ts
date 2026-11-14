// Sauvegarde puis restauration complète (lot H2) : rôles dédiés (vyra_backup, vyra_migrator), propriétaires et
// droits conservés, base neuve obligatoire, contrôle complet après restauration, refus sans aucune écriture.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { appPool, Client, roleUrl, setup, SETUP_SQL, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";

const ROOT = path.resolve(__dirname, "../../..");
const dbUrl = (name: string) => TEST_DB.replace(/\/[^/]+$/, "/" + name);
const node = (script: string, args: string[], env: Record<string, string | undefined>) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
let ctx: Ctx;
let tmp: string;
const created: string[] = [];

async function admin<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
/** Base neuve préparée comme en production (database-setup.sql), sans aucune table. */
async function preparedDb(name: string) {
  await admin(dbUrl("postgres"), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${name}`);
  });
  created.push(name);
  await admin(dbUrl(name), (c) => c.query(fs.readFileSync(SETUP_SQL, "utf8")));
  return dbUrl(name);
}
const objects = (url: string) =>
  admin(url, async (c) => (await c.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('vyra', 'public')")).rows[0].n);

beforeAll(async () => {
  ctx = await setup();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-backup-"));
});
afterAll(async () => {
  await teardown(ctx);
  for (const d of created) await admin(dbUrl("postgres"), (c) => c.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sauvegarde et restauration", () => {
  it("restaure base et fichiers à l'identique (propriétaires, droits, données), dans une base neuve, par les rôles dédiés", async () => {
    const { c, email } = await signup(ctx.app);
    const design = { name: "T", widthMm: 50, heightMm: 50, threads: [{ rgb: "#5a3a28", name: "Brun", brand: "", code: "" }], objects: [] };
    const p = (await c.post("/api/projects", { name: "À sauvegarder", design })).json.project;
    await c.patch(`/api/projects/${p.id}`, { baseRevision: 1, name: "À sauvegarder v2", snapshot: true, snapshotLabel: "Avant sauvegarde" });
    const png = fs.readFileSync(path.join(ROOT, "packages/engine/fixtures/motifs/01-chat.png"));
    const b = "----vyra-bk";
    const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="chat.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${b}--\r\n`)]);
    const file = (await c.req("POST", `/api/projects/${p.id}/source`, body, { "content-type": `multipart/form-data; boundary=${b}` })).json.file;

    // Sauvegarde : seul vyra_backup est accepté.
    expect(node("backup.mjs", [tmp], { BACKUP_DATABASE_URL: TEST_DB, STORAGE_DIR: ctx.storageDir }).status).toBe(2);
    const bk = node("backup.mjs", [tmp], { BACKUP_DATABASE_URL: await roleUrl("vyra_backup"), STORAGE_DIR: ctx.storageDir });
    expect(bk.status, bk.stderr).toBe(0);
    const out = bk.stdout.trim().split("\n").pop()!;
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifeste.json"), "utf8"));
    expect(Object.keys(manifest.fichiers).sort()).toEqual(["base.dump", "controle.json", "stockage.tar.gz"]);
    const listing = execFileSync("pg_restore", ["--list", path.join(out, "base.dump")], { encoding: "utf8" });
    expect(listing).toMatch(/SCHEMA - vyra/);
    expect(listing).toMatch(/ACL vyra TABLE users vyra_owner/);
    expect(listing).toMatch(/DEFAULT ACL - DEFAULT PRIVILEGES FOR FUNCTIONS vyra_owner/);

    // Restauration : base neuve préparée, vyra_migrator (rôle propriétaire), contrôle complet.
    const target = await preparedDb("vyra_restore");
    const migrator = await roleUrl("vyra_migrator", target);
    const restoredStorage = path.join(tmp, "stockage-restaure");
    expect(node("restore.mjs", [out], { RESTORE_DATABASE_URL: target, STORAGE_DIR: restoredStorage }).status).toBe(2); // pas le migrateur
    const rs = node("restore.mjs", [out], { RESTORE_DATABASE_URL: migrator, STORAGE_DIR: restoredStorage });
    expect(rs.status, rs.stderr).toBe(0);
    expect(rs.stderr).toMatch(/restaurée et contrôlée/);
    const owners = await admin(target, async (cl) => (await cl.query("SELECT DISTINCT pg_get_userbyid(relowner) o FROM pg_class WHERE relnamespace = 'vyra'::regnamespace")).rows.map((r) => r.o));
    expect(owners).toEqual(["vyra_owner"]);

    // L'API fonctionne sur la base restaurée avec vyra_app.
    const db2 = appPool(target);
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: target, STORAGE_DIR: restoredStorage, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000 } as any);
    const app2 = await buildApp({ cfg, db: db2 });
    const c2 = new Client(app2);
    expect((await c2.post("/api/auth/login", { email, password: "un-mot-de-passe-solide" })).status).toBe(200);
    expect((await c2.get(`/api/projects/${p.id}`)).json.project.name).toBe("À sauvegarder v2");
    expect((await c2.get(`/api/projects/${p.id}/versions`)).json.versions.map((v: any) => v.label)).toContain("Avant sauvegarde");
    expect(Buffer.compare((await c2.get(`/api/files/${file.id}`)).res.rawPayload, png)).toBe(0);
    await app2.close();
    await db2.end();

    // Une seconde restauration sur la même base est refusée, même avec --remplacer, sans rien modifier.
    const before = await objects(target);
    const again = node("restore.mjs", [out, "--remplacer"], { RESTORE_DATABASE_URL: migrator, STORAGE_DIR: restoredStorage });
    expect(again.status).toBe(4);
    expect(again.stderr).toMatch(/base neuve/);
    expect(await objects(target)).toBe(before);
  }, 180_000);

  it("refus sans écriture : base contenant un seul objet dans vyra, stockage non vide, sauvegarde altérée", async () => {
    const bk = node("backup.mjs", [tmp], { BACKUP_DATABASE_URL: await roleUrl("vyra_backup"), STORAGE_DIR: ctx.storageDir });
    expect(bk.status, bk.stderr).toBe(0);
    const out = bk.stdout.trim().split("\n").pop()!;

    // Cas qui écrasait la base avec l'ancien script (garde limitée au schéma public).
    const busy = await preparedDb("vyra_restore_busy");
    await admin(busy, (c) => c.query("CREATE TABLE vyra.donnees (x int); ALTER TABLE vyra.donnees OWNER TO vyra_owner; INSERT INTO vyra.donnees VALUES (42)"));
    const r1 = node("restore.mjs", [out], { RESTORE_DATABASE_URL: await roleUrl("vyra_migrator", busy), STORAGE_DIR: path.join(tmp, "s1") });
    expect(r1.status).toBe(4);
    expect(await admin(busy, async (c) => (await c.query("SELECT x FROM vyra.donnees")).rows)).toEqual([{ x: 42 }]);

    // Stockage cible non vide : refus AVANT la base, qui reste vide.
    const fresh = await preparedDb("vyra_restore_fresh");
    const full = path.join(tmp, "stockage-plein");
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, "existant.bin"), "x");
    const r2 = node("restore.mjs", [out], { RESTORE_DATABASE_URL: await roleUrl("vyra_migrator", fresh), STORAGE_DIR: full });
    expect(r2.status).toBe(4);
    expect(r2.stderr).toMatch(/stockage cible/);
    expect(await objects(fresh)).toBe(0);

    // Sauvegarde altérée : refusée avant toute écriture.
    fs.appendFileSync(path.join(out, "base.dump"), "x");
    const r3 = node("restore.mjs", [out], { RESTORE_DATABASE_URL: await roleUrl("vyra_migrator", fresh), STORAGE_DIR: path.join(tmp, "s3") });
    expect(r3.status).toBe(3);
    expect(r3.stderr).toMatch(/altérée/);
    expect(await objects(fresh)).toBe(0);
  }, 180_000);
});
