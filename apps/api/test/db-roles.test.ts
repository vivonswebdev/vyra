// Rôles PostgreSQL (lot H1), essayés sur une instance PostgreSQL LOCALE et isolée : attributs, appartenances,
// séparation migrateur / application / système / tâches / Market / sauvegarde, migration avec le rôle
// propriétaire, refus de migrer avec le rôle de l'API, droits de transition, API fonctionnelle sans privilège de
// migration, sauvegarde et restauration (défaut des options actuelles et procédure proposée).
//
// Les rôles PostgreSQL sont globaux à l'instance : ce fichier ne s'exécute qu'avec PG_ROLES_TEST=1 (CI, instance
// de test locale). Il refuse toute instance qui n'est pas locale. Il n'utilise jamais de base distante.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate, migrationStatus, MIGRATIONS_DIR } from "../src/db/migrations.js";
import { checkRuntimeRole } from "../src/db/runtime-role.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Client, TEST_DB, tokenFrom } from "./helpers.js";

const ENABLED = process.env.PG_ROLES_TEST === "1";
const ROOT = path.resolve(__dirname, "../../..");
const SQL = (f: string) => fs.readFileSync(path.join(ROOT, "scripts/db", f), "utf8");
const FILES = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const ROLES = ["vyra_owner", "vyra_migrator", "vyra_app", "vyra_system", "vyra_worker", "vyra_market", "vyra_backup"];
const LOGIN = ROLES.filter((r) => r !== "vyra_owner");
const RUNTIME = ["vyra_app", "vyra_system", "vyra_worker", "vyra_market"];
const pw: Record<string, string> = Object.fromEntries(LOGIN.map((r) => [r, crypto.randomBytes(16).toString("hex")]));
const u = new URL(TEST_DB);
const urlAs = (role: string, db: string, password = pw[role]) => `postgres://${role}:${password}@${u.host}/${db}`;
const adminUrl = (db: string) => TEST_DB.replace(/\/[^/]+$/, "/" + db);
const created: string[] = [];

async function sql(url: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text, params as any[]);
  } finally {
    await c.end();
  }
}
async function newDb(prepare = true) {
  const name = "vyra_roles_" + crypto.randomBytes(4).toString("hex");
  await sql(adminUrl("postgres"), `CREATE DATABASE ${name}`);
  created.push(name);
  if (prepare) await sql(adminUrl(name), SQL("database-setup.sql"));
  return name;
}

describe.runIf(ENABLED)("rôles PostgreSQL (instance locale isolée)", () => {
  let db: string; // base migrée et prête
  beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !process.env.CI) throw new Error("Instance non locale : test refusé.");
    // Échec net si l'environnement ne permet pas de créer les rôles (aucune simulation).
    await sql(adminUrl("postgres"), SQL("roles.sql"));
    for (const r of LOGIN) await sql(adminUrl("postgres"), `ALTER ROLE ${r} PASSWORD '${pw[r]}'`);
    db = await newDb();
    const mig = new pg.Pool({ connectionString: urlAs("vyra_migrator", db) });
    await migrate(mig, () => {}, { setRole: "vyra_owner" });
    await mig.end();
    await sql(urlAs("vyra_migrator", db), SQL("grants-h1.sql"));
  }, 120_000);
  afterAll(async () => {
    for (const d of created) await sql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
  });

  it("attributs des sept rôles", async () => {
    const { rows } = await sql(adminUrl("postgres"), "SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname", [ROLES]);
    const m = Object.fromEntries(rows.map((r) => [r.rolname, r]));
    expect(Object.keys(m).sort()).toEqual([...ROLES].sort());
    expect(m.vyra_owner.rolcanlogin).toBe(false);
    for (const r of LOGIN) expect(m[r].rolcanlogin, r).toBe(true);
    for (const r of ROLES) expect([m[r].rolsuper, m[r].rolcreaterole, m[r].rolcreatedb], r).toEqual([false, false, false]);
    expect(rows.filter((r) => r.rolbypassrls).map((r) => r.rolname).sort()).toEqual(["vyra_backup", "vyra_migrator"]);
  });

  it("appartenances : seul le migrateur peut prendre le rôle propriétaire, sans en hériter les droits", async () => {
    const { rows } = await sql(
      adminUrl("postgres"),
      `SELECT o.rolname AS grp, r.rolname AS mem, am.inherit_option, am.set_option, am.admin_option
         FROM pg_auth_members am JOIN pg_roles o ON o.oid = am.roleid JOIN pg_roles r ON r.oid = am.member
        WHERE r.rolname = ANY($1) OR o.rolname = ANY($1) ORDER BY 1, 2`,
      [ROLES],
    );
    expect(rows).toEqual([
      { grp: "pg_read_all_data", mem: "vyra_backup", inherit_option: true, set_option: true, admin_option: false },
      { grp: "vyra_owner", mem: "vyra_migrator", inherit_option: false, set_option: true, admin_option: false },
    ]);
  });

  it("le propriétaire ne peut pas se connecter ; aucun autre rôle ne peut prendre le rôle propriétaire", async () => {
    await expect(sql(`postgres://vyra_owner:x@${u.host}/${db}`, "SELECT 1")).rejects.toThrow(/not permitted to log in|password authentication failed/);
    for (const r of [...RUNTIME, "vyra_backup"]) await expect(sql(urlAs(r, db), "SET ROLE vyra_owner"), r).rejects.toThrow(/permission denied to set role/);
    await expect(sql(urlAs("vyra_migrator", db), "SET ROLE vyra_owner; RESET ROLE")).resolves.toBeTruthy();
    // Le migrateur n'hérite pas des droits du propriétaire sans SET ROLE explicite.
    // (PostgreSQL : « no schema has been selected » quand le rôle n'a même pas USAGE sur le schéma.)
    await expect(sql(urlAs("vyra_migrator", db), "CREATE TABLE intrus (id int)")).rejects.toThrow(/permission denied for schema public|no schema has been selected to create in/);
  });

  it("migration : objets créés par le migrateur mais possédés par vyra_owner", async () => {
    const { rows } = await sql(adminUrl(db), "SELECT c.relname, pg_get_userbyid(c.relowner) o FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','S') ORDER BY 1");
    expect(rows.length).toBeGreaterThanOrEqual(17);
    expect([...new Set(rows.map((r) => r.o))]).toEqual(["vyra_owner"]);
    expect((await sql(adminUrl(db), "SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name)).toEqual(FILES);
  });

  it("refus de migrer avec le rôle de l'API (et avec les autres rôles d'exécution)", async () => {
    const empty = await newDb();
    for (const r of [...RUNTIME, "vyra_backup"]) {
      const p = new pg.Pool({ connectionString: urlAs(r, empty) });
      await expect(migrate(p), r).rejects.toThrow(/permission denied|no schema has been selected to create in/);
      await p.end();
    }
    // Sans SET ROLE, le migrateur lui-même ne peut rien créer.
    const p = new pg.Pool({ connectionString: urlAs("vyra_migrator", empty) });
    await expect(migrate(p)).rejects.toThrow(/permission denied|no schema has been selected to create in/);
    await p.end();
    expect((await sql(adminUrl(empty), "SELECT count(*)::int n FROM pg_class WHERE relnamespace = 'public'::regnamespace")).rows[0].n).toBe(0);
  });

  it("droits de transition : l'API a les seules opérations de données ; système, tâches et Market rien ; sauvegarde en lecture", async () => {
    const tables = (await sql(adminUrl(db), "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1")).rows.map((r) => r.relname);
    const priv = async (role: string, t: string, p: string) => (await sql(adminUrl(db), "SELECT has_table_privilege($1, $2, $3) v", [role, `public.${t}`, p])).rows[0].v;
    for (const t of tables) {
      const dml = t === "schema_migrations" ? [true, false, false, false] : [true, true, true, true];
      expect(await Promise.all(["SELECT", "INSERT", "UPDATE", "DELETE"].map((p) => priv("vyra_app", t, p))), `vyra_app ${t}`).toEqual(dml);
      for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await priv("vyra_app", t, p), `vyra_app ${p} ${t}`).toBe(false);
      for (const r of ["vyra_system", "vyra_worker", "vyra_market"]) expect(await priv(r, t, "SELECT"), `${r} ${t}`).toBe(false);
      expect(await priv("vyra_backup", t, "SELECT"), `backup ${t}`).toBe(true);
      expect(await priv("vyra_backup", t, "INSERT"), `backup ${t}`).toBe(false);
      expect(await priv("public", t, "SELECT"), `PUBLIC ${t}`).toBe(false);
    }
    const db0 = (await sql(adminUrl(db), "SELECT has_database_privilege('public', current_database(), 'CONNECT') c, has_database_privilege('public', current_database(), 'TEMP') t")).rows[0];
    expect(db0).toEqual({ c: false, t: false });
    // Idempotence : réappliquer les droits ne change rien.
    await sql(urlAs("vyra_migrator", db), SQL("grants-h1.sql"));
    expect(await priv("vyra_app", "users", "TRUNCATE")).toBe(false);
    expect(await priv("vyra_app", "users", "DELETE")).toBe(true);
  });

  it("l'API ne peut ni créer, ni modifier, ni vider, ni supprimer de structure, ni écrire dans le registre", async () => {
    const app = urlAs("vyra_app", db);
    for (const stmt of ["CREATE TABLE x (id int)", "ALTER TABLE users ADD COLUMN x int", "DROP TABLE thread_charts", "TRUNCATE users", "INSERT INTO schema_migrations (name, checksum) VALUES ('999_x.sql', 'x')", "CREATE TEMP TABLE t (id int)"])
      await expect(sql(app, stmt), stmt).rejects.toThrow(/permission denied|must be owner/);
    for (const r of ["vyra_system", "vyra_worker", "vyra_market"]) await expect(sql(urlAs(r, db), "SELECT count(*) FROM users"), r).rejects.toThrow(/permission denied/);
    await expect(sql(urlAs("vyra_backup", db), "DELETE FROM sessions")).rejects.toThrow(/permission denied/);
  });

  it("contrôle du rôle d'exécution : vyra_app sans privilège inutile ; migrateur et superutilisateur signalés", async () => {
    const check = async (url: string) => {
      const p = new pg.Pool({ connectionString: url });
      try {
        return await checkRuntimeRole(p);
      } finally {
        await p.end();
      }
    };
    expect(await check(urlAs("vyra_app", db))).toEqual({ role: "vyra_app", problems: [] });
    const m = await check(urlAs("vyra_migrator", db));
    expect(m.problems).toEqual(expect.arrayContaining(["contourne RLS (BYPASSRLS)", "peut prendre le rôle vyra_owner"]));
    expect((await check(adminUrl(db))).problems).toContain("superutilisateur");
  });

  it("l'API fonctionne avec vyra_app, sans aucun privilège de migration", async () => {
    const appPool = new pg.Pool({ connectionString: urlAs("vyra_app", db), max: 5 });
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-roles-"));
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: urlAs("vyra_app", db), STORAGE_DIR: storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000 } as any);
    const app = await buildApp({ cfg, db: appPool });
    try {
      expect(await migrationStatus(appPool)).toEqual({ applied: FILES, pending: [], modified: [], orphans: [] });
      const c = new Client(app);
      expect((await c.post("/api/auth/signup", { email: "role@example.com", password: "un-mot-de-passe-solide", displayName: "Rôle", acceptTerms: true })).status).toBe(202);
      const { rows } = await appPool.query("SELECT body_text FROM email_outbox WHERE to_email = 'role@example.com' AND template = 'verify'");
      expect((await c.post("/api/auth/verify-email", { token: tokenFrom(rows[0].body_text) })).status).toBe(200);
      const p = await c.post("/api/projects", { name: "Essai rôles", design: null });
      expect(p.status).toBe(201);
      expect((await c.get("/api/projects")).json.projects.map((x: any) => x.name)).toEqual(["Essai rôles"]);
      expect((await c.post("/api/auth/logout")).status).toBe(200);
      const ready = await app.inject({ method: "GET", url: "/api/ready" });
      expect(ready.json().checks.migrations).toMatchObject({ ok: true });
      expect(ready.json().checks.database).toMatchObject({ ok: true });
    } finally {
      await app.close();
      await appPool.end();
    }
  });

  it("sauvegarde / restauration : les options actuelles perdent propriétaire et droits ; la procédure proposée les conserve", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-dump-"));
    // 1. pg_dump par vyra_backup (lecture seule) : fonctionne.
    const actual = path.join(dir, "actuel.dump");
    execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", actual, urlAs("vyra_backup", db)]);
    const proposed = path.join(dir, "propose.dump");
    execFileSync("pg_dump", ["--format=custom", "--file", proposed, urlAs("vyra_backup", db)]);
    // 2. Options actuelles (scripts/restore.mjs:32) avec le migrateur : échec, il ne peut rien créer sans le rôle propriétaire.
    const t1 = await newDb();
    expect(() => execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", urlAs("vyra_migrator", t1), actual], { stdio: "pipe" })).toThrow(/permission denied/);
    // 3. Options actuelles avec un superutilisateur : la restauration passe, mais le propriétaire devient le
    //    superutilisateur et l'API perd tous ses droits.
    const t2 = await newDb();
    execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", adminUrl(t2), actual], { stdio: "pipe" });
    const owner2 = (await sql(adminUrl(t2), "SELECT DISTINCT pg_get_userbyid(relowner) o FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'")).rows.map((r) => r.o);
    expect(owner2).not.toContain("vyra_owner");
    expect((await sql(adminUrl(t2), "SELECT has_table_privilege('vyra_app', 'public.users', 'SELECT') v")).rows[0].v).toBe(false);
    // 4. Procédure proposée : sauvegarde avec propriétaires et droits, restauration par le migrateur en prenant
    //    le rôle propriétaire, dans une base préparée.
    const t3 = await newDb();
    execFileSync("pg_restore", ["--exit-on-error", "--role=vyra_owner", "--dbname", urlAs("vyra_migrator", t3), proposed], { stdio: "pipe" });
    const owner3 = (await sql(adminUrl(t3), "SELECT DISTINCT pg_get_userbyid(relowner) o FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S')")).rows.map((r) => r.o);
    expect(owner3).toEqual(["vyra_owner"]);
    const acl = async (d: string) =>
      (await sql(adminUrl(d), "SELECT relname, relacl::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','S') ORDER BY 1")).rows;
    expect(await acl(t3)).toEqual(await acl(db));
    const counts = async (d: string) => (await sql(adminUrl(d), "SELECT (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM projects)::int p, (SELECT count(*) FROM schema_migrations)::int m")).rows[0];
    expect(await counts(t3)).toEqual(await counts(db));
    expect((await sql(urlAs("vyra_app", t3), "SELECT count(*)::int n FROM projects")).rows[0].n).toBe((await counts(db)).p);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
