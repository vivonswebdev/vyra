// Registre des migrations (lot H1) : concurrence entre processus, absence de réexécution, empreintes,
// migrations orphelines, libération du verrou en cas d'erreur, état en lecture seule.
// Chaque test travaille sur une base neuve et jetable de l'instance de test locale.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate, migrationStatus, MIGRATION_LOCK_KEY, MIGRATIONS_DIR } from "../src/db/migrations.js";
import { TEST_DB } from "./helpers.js";

const ROOT = path.resolve(__dirname, "../../..");
const RUNNER = path.join(ROOT, "apps/api/src/db/migrations.ts");
const CHILD = path.join(ROOT, "apps/api/test/support/migrate-child.ts");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const FILES = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const created: string[] = [];
const urlFor = (db: string) => TEST_DB.replace(/\/[^/]+$/, "/" + db);

async function freshDb(): Promise<string> {
  const name = "vyra_mig_" + crypto.randomBytes(4).toString("hex");
  const a = new pg.Client({ connectionString: urlFor("postgres") });
  await a.connect();
  await a.query(`CREATE DATABASE ${name}`);
  await a.end();
  created.push(name);
  return urlFor(name);
}
const pool = (url: string) => new pg.Pool({ connectionString: url, max: 4 });
async function registry(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query("SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name")).rows;
  } finally {
    await c.end();
  }
}
function child(url: string, dir?: string): Promise<{ code: number | null; result: any }> {
  return new Promise((resolve) => {
    const p = spawn(TSX, [CHILD, RUNNER, url, ...(dir ? [dir] : [])], { cwd: ROOT });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => {
      const last = out.trim().split("\n").pop() ?? "";
      let result: any = { raw: out };
      try {
        result = JSON.parse(last);
      } catch {}
      resolve({ code, result });
    });
  });
}
async function waiters(c: pg.Client) {
  return (await c.query("SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1 AND NOT granted", [MIGRATION_LOCK_KEY])).rows[0].n;
}
function copyDir(extra: Record<string, string> = {}, omit: string[] = [], rename: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-mig-"));
  for (const f of FILES) if (!omit.includes(f)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, rename[f] ?? f));
  for (const [n, sql] of Object.entries(extra)) fs.writeFileSync(path.join(dir, n), sql);
  return dir;
}

afterAll(async () => {
  const a = new pg.Client({ connectionString: urlFor("postgres") });
  await a.connect();
  for (const d of created) await a.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
  await a.end();
});

describe("registre des migrations", () => {
  it("deux processus concurrents : le second ne rejoue jamais ce que le premier a appliqué", async () => {
    const url = await freshDb();
    // Le test tient le verrou : les deux processus démarrent et se bloquent tous deux dessus.
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    const runs = [child(url), child(url)];
    for (let i = 0; i < 300 && (await waiters(holder)) < 2; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await waiters(holder)).toBe(2);
    await holder.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    const [a, b] = await Promise.all(runs);
    await holder.end();
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(a.result.ok && b.result.ok).toBe(true);
    // Exactement un processus a tout appliqué, l'autre rien.
    const lists = [a.result.applied, b.result.applied].sort((x: string[], y: string[]) => y.length - x.length);
    expect(lists).toEqual([FILES, []]);
    const reg = await registry(url);
    expect(reg.map((r) => r.name)).toEqual(FILES);
  }, 120_000);

  it("six appels simultanés (connexions distinctes) : chaque migration appliquée une seule fois", async () => {
    const url = await freshDb();
    const pools = Array.from({ length: 6 }, () => pool(url));
    const results = await Promise.all(pools.map((p) => migrate(p)));
    await Promise.all(pools.map((p) => p.end()));
    expect(results.flat().sort()).toEqual(FILES);
    expect((await registry(url)).length).toBe(FILES.length);
  });

  it("aucune réexécution : un second passage n'applique rien et ne touche pas au registre", async () => {
    const url = await freshDb();
    const p = pool(url);
    expect(await migrate(p)).toEqual(FILES);
    const before = await registry(url);
    expect(await migrate(p)).toEqual([]);
    expect(await registry(url)).toEqual(before);
    await p.end();
  });

  it("empreinte : une migration appliquée puis modifiée bloque toute nouvelle application", async () => {
    const url = await freshDb();
    const p = pool(url);
    await migrate(p);
    // Contenu de 002 changé après application (simulé par un dossier modifié).
    const dir = copyDir({ "002_studio.sql": fs.readFileSync(path.join(MIGRATIONS_DIR, "002_studio.sql"), "utf8") + "\n-- modifié\n", "900_suivante.sql": "SELECT 1;" });
    await expect(migrate(p, () => {}, { dir })).rejects.toThrow(/modifiée.*002_studio\.sql/);
    expect((await migrationStatus(p, { dir })).modified).toEqual(["002_studio.sql"]);
    expect((await registry(url)).map((r) => r.name)).not.toContain("900_suivante.sql");
    // Les empreintes enregistrées sont bien le SHA-256 du contenu.
    const reg = await registry(url);
    for (const r of reg) expect(r.checksum).toBe(crypto.createHash("sha256").update(fs.readFileSync(path.join(MIGRATIONS_DIR, r.name), "utf8")).digest("hex"));
    await p.end();
  });

  it("renommage : l'ancien nom devient orphelin, le nouveau n'est PAS réexécuté (refus)", async () => {
    const url = await freshDb();
    const p = pool(url);
    await migrate(p);
    const dir = copyDir({}, [], { "004_thread_charts.sql": "004_nuanciers.sql" });
    const s = await migrationStatus(p, { dir });
    expect(s.orphans).toEqual(["004_thread_charts.sql"]);
    expect(s.pending).toEqual(["004_nuanciers.sql"]);
    await expect(migrate(p, () => {}, { dir })).rejects.toThrow(/sans fichier.*004_thread_charts\.sql/);
    expect((await registry(url)).map((r) => r.name)).toEqual(FILES);
    await p.end();
  });

  it("erreur : migration annulée, rien enregistré, verrou relâché, reprise possible après correction", async () => {
    const url = await freshDb();
    const p = pool(url);
    const bad = copyDir({ "900_essai.sql": "CREATE TABLE essai_h1 (id int); SELECT 1/0;" });
    await expect(migrate(p, () => {}, { dir: bad })).rejects.toThrow(/900_essai\.sql/);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    expect((await c.query("SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1", [MIGRATION_LOCK_KEY])).rows[0].n).toBe(0);
    expect((await c.query("SELECT to_regclass('essai_h1') t")).rows[0].t).toBeNull();
    await c.end();
    expect((await registry(url)).map((r) => r.name)).toEqual(FILES);
    const fixed = copyDir({ "900_essai.sql": "CREATE TABLE essai_h1 (id int);" });
    expect(await migrate(p, () => {}, { dir: fixed })).toEqual(["900_essai.sql"]);
    await p.end();
  });

  it("état en lecture seule : base vide, rien n'est créé", async () => {
    const url = await freshDb();
    const p = pool(url);
    const s = await migrationStatus(p);
    expect(s).toEqual({ applied: [], pending: FILES, modified: [], orphans: [] });
    expect((await p.query("SELECT to_regclass('schema_migrations') t")).rows[0].t).toBeNull();
    await p.end();
  });
});
