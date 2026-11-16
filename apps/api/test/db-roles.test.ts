// Rôles PostgreSQL et schéma vyra (lots H1, H2), essayés sur une instance PostgreSQL LOCALE et isolée :
// attributs et appartenances des sept rôles ; migration par le migrateur sous le rôle propriétaire ; base neuve
// (tables créées directement dans vyra) et base existante du lot H1 (tables déplacées par 008, sans perte) ;
// convergence avec la migration Market 006 appliquée avant ou après ; matrice des droits (009) ; contrôle du
// rôle d'exécution et du chemin de recherche ; NOBYPASSRLS du migrateur ; retour arrière rollback-h2.sql.
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
import { createPool } from "../src/db/pool.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Client, TEST_DB, tokenFrom } from "./helpers.js";
import { compare, snapshot } from "../../../scripts/db-control.mjs";

const ENABLED = process.env.PG_ROLES_TEST === "1";
const ROOT = path.resolve(__dirname, "../../..");
const SQL = (f: string) => fs.readFileSync(path.join(ROOT, "scripts/db", f), "utf8");
const H1 = (f: string) => fs.readFileSync(path.join(__dirname, "support/h1", f), "utf8");
const FILES = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const H1_FILES = FILES.filter((f) => f < "006");
const ROLES = ["vyra_owner", "vyra_migrator", "vyra_app", "vyra_system", "vyra_worker", "vyra_market", "vyra_backup"];
const LOGIN = ROLES.filter((r) => r !== "vyra_owner");
const RUNTIME = ["vyra_app", "vyra_system", "vyra_worker", "vyra_market"];
const SOCLE = ["users", "user_roles", "sessions", "auth_tokens", "email_outbox", "files", "audit_log", "projects", "project_versions", "project_exports",
  "project_files", "user_recovery_codes", "mfa_challenges", "thread_charts", "auth_throttle", "rate_limits", "schema_migrations"].sort();
const H2_FILES = FILES.filter((f) => f > "006"); // migrations du socle postérieures à H1 (007 et suivantes)
const pw: Record<string, string> = Object.fromEntries(LOGIN.map((r) => [r, crypto.randomBytes(16).toString("hex")]));
const u = new URL(TEST_DB);
const urlAs = (role: string, db: string, password = pw[role]) => `postgres://${role}:${password}@${u.host}/${db}`;
const adminUrl = (db: string) => TEST_DB.replace(/\/[^/]+$/, "/" + db);
const created: string[] = [];
const tmpDirs: string[] = [];

async function sql(url: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(text, params as any[]);
  } finally {
    await c.end();
  }
}
const rows = async (url: string, text: string, params: unknown[] = []) => (await sql(url, text, params)).rows;
/** Base neuve ; préparée par le script du lot H2, par celui du lot H1, ou pas du tout. */
async function newDb(prepare: "h2" | "h1" | "none" = "h2") {
  const name = "vyra_roles_" + crypto.randomBytes(4).toString("hex");
  await sql(adminUrl("postgres"), `CREATE DATABASE ${name}`);
  created.push(name);
  if (prepare === "h2") await sql(adminUrl(name), SQL("database-setup.sql"));
  if (prepare === "h1") await sql(adminUrl(name), H1("database-setup.sql"));
  return name;
}
/** Dossier de migrations : une sélection des fichiers livrés, plus des fichiers supplémentaires. */
function migDir(names: string[], extra: Record<string, string> = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-mig-"));
  tmpDirs.push(d);
  for (const n of names) fs.copyFileSync(path.join(MIGRATIONS_DIR, n), path.join(d, n));
  for (const [n, s] of Object.entries(extra)) fs.writeFileSync(path.join(d, n), s);
  return d;
}
/** Migration comme en production : vyra_migrator, rôle propriétaire pris dans chaque transaction. */
async function migrateAs(db: string, dir?: string) {
  const p = new pg.Pool({ connectionString: urlAs("vyra_migrator", db) });
  try {
    return await migrate(p, () => {}, { setRole: "vyra_owner", dir });
  } finally {
    await p.end();
  }
}
/** Jeu de données couvrant toutes les tables du socle (écrit en administrateur, emplacement par le chemin de recherche). */
async function seed(db: string) {
  await sql(adminUrl(db), `SET search_path = vyra, public;
    INSERT INTO users (id, email, password_hash, display_name) VALUES
      ('00000000-0000-4000-8000-000000000001', 'a@example.com', 'h', 'A'), ('00000000-0000-4000-8000-000000000002', 'b@example.com', 'h', 'B');
    INSERT INTO user_roles (user_id, role, granted_by) VALUES ('00000000-0000-4000-8000-000000000001', 'admin', '00000000-0000-4000-8000-000000000002');
    INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\\x01', '00000000-0000-4000-8000-000000000001', now() + interval '1 day');
    INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ('\\x02', '00000000-0000-4000-8000-000000000001', 'verify_email', now());
    INSERT INTO email_outbox (to_email, template, subject, body_text) VALUES ('a@example.com', 'verify', 's', 'b'), ('b@example.com', 'verify', 's', 'b');
    INSERT INTO files (id, owner_id, kind, storage_key, filename, mime, size_bytes, sha256) VALUES
      ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-000000000001', 'export', 'k1', 'f.pes', 'x', 1, repeat('a', 64));
    INSERT INTO audit_log (actor_id, action) VALUES ('00000000-0000-4000-8000-000000000001', 'x'), (NULL, 'y');
    INSERT INTO projects (id, owner_id, name) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'P');
    INSERT INTO project_versions (project_id, revision, name, settings) VALUES ('00000000-0000-4000-8000-0000000000a1', 1, 'P', '{}');
    INSERT INTO project_exports (project_id, file_id, format, revision, stats, qc) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'pes', 1, '{}', '{}');
    INSERT INTO project_files (project_id, file_id, role) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000f1', 'source');
    INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ('00000000-0000-4000-8000-000000000001', '\\x03');
    INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ('\\x04', '00000000-0000-4000-8000-000000000001', now());
    INSERT INTO thread_charts (owner_id, brand, product, status, source, entries) VALUES ('00000000-0000-4000-8000-000000000001', 'M', 'P', 'utilisateur', 'src', '[]');
    INSERT INTO auth_throttle (key) VALUES ('\\x05');
    INSERT INTO rate_limits (key, count, reset_at) VALUES ('k', 1, now());
    SELECT nextval('audit_log_id_seq'); SELECT nextval('audit_log_id_seq');`);
}
const snap = (db: string) => snapshot(async (t: string, p?: unknown[]) => rows(adminUrl(db), t, p));
/** Contenu (lignes et sommes de contrôle par table, hors registre) et valeurs des séquences, quel que soit le schéma. */
async function content(db: string) {
  const s = await snap(db);
  const strip = (x: any) => ({ ...x, name: x.name.replace(/^(vyra|public)\./, "") });
  const byName = (a: any, b: any) => a.name.localeCompare(b.name);
  // Le registre des migrations change par nature (lignes 007 et suivantes) : vérifié à part. La table sessions
  // gagne des colonnes au lot H4 (niveau de session, valeurs par défaut) : comparée sur ses colonnes du lot H1.
  const schema = (await rows(adminUrl(db), "SELECT n.nspname s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'sessions' AND n.nspname IN ('vyra', 'public')"))[0].s;
  const sessions = (await rows(adminUrl(db), `SELECT count(*)::int AS rows, md5(string_agg(x, E'\\n' ORDER BY x)) AS checksum
     FROM (SELECT (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent, id)::text AS x FROM "${schema}".sessions) t`))[0];
  const tables = s.tables.map(strip).filter((t: any) => t.name !== "schema_migrations" && t.name !== "sessions");
  return { tables: [...tables, { name: "sessions", ...sessions }].sort(byName), sequences: s.sequences.map(strip).sort(byName) };
}
/** Structure (sans données) : propriétaires, droits, contraintes, index, fonctions, politiques. */
async function structure(db: string) {
  const { tables: _t, sequences: _s, ...rest } = await snap(db);
  return rest;
}
const tablesIn = async (db: string, schema: string) =>
  (await rows(adminUrl(db), "SELECT relname FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = 'r' ORDER BY 1", [schema])).map((r) => r.relname);

describe.runIf(ENABLED)("rôles PostgreSQL et schéma vyra (instance locale isolée)", () => {
  let db: string; // base neuve, migrée, prête
  beforeAll(async () => {
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !process.env.CI) throw new Error("Instance non locale : test refusé.");
    // Échec net si l'environnement ne permet pas de créer les rôles (aucune simulation).
    await sql(adminUrl("postgres"), SQL("roles.sql"));
    for (const r of LOGIN) await sql(adminUrl("postgres"), `ALTER ROLE ${r} PASSWORD '${pw[r]}'`);
    db = await newDb();
    await migrateAs(db);
  }, 120_000);
  afterAll(async () => {
    for (const d of created) await sql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it("attributs des sept rôles : seul vyra_backup contourne RLS (le migrateur n'en a plus besoin)", async () => {
    const r = await rows(adminUrl("postgres"), "SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname", [ROLES]);
    const m = Object.fromEntries(r.map((x) => [x.rolname, x]));
    expect(Object.keys(m).sort()).toEqual([...ROLES].sort());
    expect(m.vyra_owner.rolcanlogin).toBe(false);
    for (const x of LOGIN) expect(m[x].rolcanlogin, x).toBe(true);
    for (const x of ROLES) expect([m[x].rolsuper, m[x].rolcreaterole, m[x].rolcreatedb], x).toEqual([false, false, false]);
    expect(r.filter((x) => x.rolbypassrls).map((x) => x.rolname)).toEqual(["vyra_backup"]);
  });

  it("appartenances : seul le migrateur peut prendre le rôle propriétaire, sans en hériter les droits", async () => {
    const r = await rows(
      adminUrl("postgres"),
      `SELECT o.rolname AS grp, r.rolname AS mem, am.inherit_option, am.set_option, am.admin_option
         FROM pg_auth_members am JOIN pg_roles o ON o.oid = am.roleid JOIN pg_roles r ON r.oid = am.member
        WHERE r.rolname = ANY($1) OR o.rolname = ANY($1) ORDER BY 1, 2`,
      [ROLES],
    );
    expect(r).toEqual([
      { grp: "pg_read_all_data", mem: "vyra_backup", inherit_option: true, set_option: true, admin_option: false },
      { grp: "vyra_owner", mem: "vyra_migrator", inherit_option: false, set_option: true, admin_option: false },
    ]);
  });

  it("le propriétaire ne peut pas se connecter ; aucun autre rôle ne peut prendre le rôle propriétaire ni créer d'objet", async () => {
    await expect(sql(`postgres://vyra_owner:x@${u.host}/${db}`, "SELECT 1")).rejects.toThrow(/not permitted to log in|password authentication failed/);
    for (const r of [...RUNTIME, "vyra_backup"]) await expect(sql(urlAs(r, db), "SET ROLE vyra_owner"), r).rejects.toThrow(/permission denied to set role/);
    await expect(sql(urlAs("vyra_migrator", db), "SET ROLE vyra_owner; RESET ROLE")).resolves.toBeTruthy();
    for (const r of [...RUNTIME, "vyra_backup", "vyra_migrator"]) {
      await expect(sql(urlAs(r, db), "CREATE TABLE vyra.intrus (id int)"), r).rejects.toThrow(/permission denied for schema vyra/);
      await expect(sql(urlAs(r, db), "CREATE TABLE public.intrus (id int)"), r).rejects.toThrow(/permission denied for schema public/);
    }
  });

  it("base neuve : tables créées directement dans vyra, au propriétaire vyra_owner ; public vide ; registre complet", async () => {
    expect(await tablesIn(db, "vyra")).toEqual(SOCLE);
    expect(await tablesIn(db, "public")).toEqual([]);
    const owners = await rows(adminUrl(db), "SELECT DISTINCT pg_get_userbyid(relowner) o FROM pg_class WHERE relnamespace = 'vyra'::regnamespace");
    expect(owners.map((r) => r.o)).toEqual(["vyra_owner"]);
    expect((await rows(adminUrl(db), "SELECT name FROM vyra.schema_migrations ORDER BY name")).map((r) => r.name)).toEqual(FILES);
    expect((await rows(adminUrl(db), "SELECT sequencename, sequenceowner FROM pg_sequences WHERE schemaname = 'vyra' ORDER BY 1")).map((r) => [r.sequencename, r.sequenceowner])).toEqual([
      ["audit_log_id_seq", "vyra_owner"], ["email_outbox_id_seq", "vyra_owner"], ["project_versions_id_seq", "vyra_owner"], ["user_recovery_codes_id_seq", "vyra_owner"],
    ]);
  });

  it("base existante du lot H1 : 007 → 008 → 009 en un passage, tables déplacées sans perte, structure identique à une base neuve", async () => {
    // 1. Base exactement dans l'état H1 : préparation H1, migrations 001-005, droits de transition H1, données.
    const old = await newDb("h1");
    await migrateAs(old, migDir(H1_FILES));
    await sql(urlAs("vyra_migrator", old), H1("grants-h1.sql"));
    await seed(old);
    expect(await tablesIn(old, "public")).toEqual(SOCLE);
    const before = await content(old);
    // 2. Passage à H2 : préparation H2 (schéma vyra, chemin de recherche), puis migrations.
    await sql(adminUrl(old), SQL("database-setup.sql"));
    expect(await migrateAs(old)).toEqual(H2_FILES);
    expect(await migrateAs(old)).toEqual([]);
    // 3. Aucune perte : mêmes lignes, mêmes sommes de contrôle, mêmes valeurs de séquences.
    expect(await content(old)).toEqual(before);
    expect(await tablesIn(old, "public")).toEqual([]);
    expect(await tablesIn(old, "vyra")).toEqual(SOCLE);
    // 4. Même structure (propriétaires, droits par table et par colonne, contraintes, index) qu'une base neuve.
    expect(compare(await structure(db), await structure(old))).toEqual([]);
    // 5. Clé corrigée par 007 : supprimer l'administrateur qui a attribué un rôle fonctionne.
    await sql(adminUrl(old), "DELETE FROM vyra.users WHERE id = '00000000-0000-4000-8000-000000000002'");
    expect((await rows(adminUrl(old), "SELECT granted_by FROM vyra.user_roles"))[0].granted_by).toBeNull();
  }, 120_000);

  it("convergence avec la migration Market 006 (copie exacte) appliquée avant ou après les migrations du socle", async () => {
    const m006 = { "006_market_identity.sql": H1("006_market_identity.sql") };
    const fk = async (d: string) => (await rows(adminUrl(d), "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'user_roles_granted_by_fkey'"))[0].d;
    // a. Base neuve, 006 dans l'ordre (001…009).
    const a = await newDb();
    await migrateAs(a, migDir(FILES, m006));
    // b. Base H2 à jour, 006 arrive ensuite (ordre inverse) : elle crée ses tables dans vyra, schéma courant.
    const b = await newDb();
    await migrateAs(b);
    expect(await migrateAs(b, migDir(FILES, m006))).toEqual(["006_market_identity.sql"]);
    for (const d of [a, b]) {
      expect(await tablesIn(d, "vyra"), d).toEqual([...SOCLE, "seller_profiles", "seller_status_events"].sort());
      expect(await tablesIn(d, "public"), d).toEqual([]);
      expect(await fk(d), d).toMatch(/ON DELETE SET NULL/);
    }
    // c. Base de développement H1 ayant déjà appliqué 006 : 008 ne déplace que les tables du socle (les tables
    //    Market restent dans public, normalisées plus tard par 050_market_hardening) ; la clé reste correcte.
    const c = await newDb("h1");
    await migrateAs(c, migDir(H1_FILES, m006));
    await sql(adminUrl(c), SQL("database-setup.sql"));
    expect(await migrateAs(c, migDir(FILES, m006))).toEqual(H2_FILES);
    expect(await tablesIn(c, "public")).toEqual(["seller_profiles", "seller_status_events"]);
    expect(await tablesIn(c, "vyra")).toEqual(SOCLE);
    expect(await fk(c)).toMatch(/ON DELETE SET NULL/);
  }, 120_000);

  it("008 refuse une table présente dans les deux schémas (aucune fusion) et annule tout", async () => {
    const d = await newDb("h1");
    await migrateAs(d, migDir(H1_FILES));
    await sql(adminUrl(d), SQL("database-setup.sql"));
    await sql(adminUrl(d), "CREATE TABLE vyra.files (x int); ALTER TABLE vyra.files OWNER TO vyra_owner");
    await expect(migrateAs(d)).rejects.toThrow(/files présente dans public et dans vyra/);
    expect(await tablesIn(d, "public")).toEqual(SOCLE);
    expect((await rows(adminUrl(d), "SELECT name FROM public.schema_migrations ORDER BY name")).map((r) => r.name)).toEqual([...H1_FILES, "007_core_user_roles_fk.sql"]);
  }, 60_000);

  it("le runner refuse d'appliquer une migration si vyra existe sans être le schéma courant", async () => {
    const d = await newDb();
    const p = new pg.Pool({ connectionString: urlAs("vyra_migrator", d), options: "-c search_path=public" });
    await expect(migrate(p, () => {}, { setRole: "vyra_owner" })).rejects.toThrow(/Chemin de recherche incorrect/);
    await p.end();
    expect(await tablesIn(d, "public")).toEqual([]);
    expect(await tablesIn(d, "vyra")).toEqual(["schema_migrations"]);
  });

  it("matrice des droits (009) : aucun droit de structure ; Market sans accès au socle ; système et tâches limités ; registre en lecture", async () => {
    const tp = async (role: string, t: string, p: string) => (await rows(adminUrl(db), "SELECT has_table_privilege($1, $2, $3) v", [role, `vyra.${t}`, p]))[0].v;
    const anyCol = async (role: string, t: string) => (await rows(adminUrl(db), "SELECT has_any_column_privilege($1, $2, 'SELECT,INSERT,UPDATE') v", [role, `vyra.${t}`]))[0].v;
    const cp = async (role: string, t: string, c: string, p: string) => (await rows(adminUrl(db), "SELECT has_column_privilege($1, $2, $3, $4) v", [role, `vyra.${t}`, c, p]))[0].v;
    for (const t of SOCLE) {
      for (const r of RUNTIME) for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await tp(r, t, p), `${r} ${p} ${t}`).toBe(false);
      expect(await anyCol("vyra_market", t), `market ${t}`).toBe(false);
      expect(await tp("vyra_market", t, "DELETE"), `market ${t}`).toBe(false);
      expect(await tp("vyra_backup", t, "SELECT"), `backup ${t}`).toBe(true);
      expect(await tp("vyra_backup", t, "INSERT"), `backup ${t}`).toBe(false);
      expect(await tp("public", t, "SELECT"), `PUBLIC ${t}`).toBe(false);
    }
    for (const t of ["projects", "project_versions", "project_exports", "project_files", "thread_charts", "files"]) expect(await anyCol("vyra_system", t), `system ${t}`).toBe(false);
    for (const t of ["user_roles", "user_recovery_codes", "project_versions", "project_exports", "project_files", "thread_charts"]) expect(await anyCol("vyra_worker", t), `worker ${t}`).toBe(false);
    expect(await cp("vyra_worker", "users", "password_hash", "SELECT")).toBe(false);
    expect(await cp("vyra_worker", "users", "email", "SELECT")).toBe(false);
    expect(await cp("vyra_worker", "projects", "design", "SELECT")).toBe(false);
    expect(await cp("vyra_system", "users", "totp_pending_enc", "SELECT")).toBe(false);
    expect(await cp("vyra_system", "users", "status", "UPDATE")).toBe(false);
    for (const r of ["vyra_app", "vyra_system"]) {
      expect(await cp(r, "users", "email", "UPDATE"), `${r} email`).toBe(false);
      expect(await cp(r, "users", "id", "UPDATE"), `${r} id`).toBe(false);
      expect(await cp(r, "users", "status", "UPDATE"), `${r} status`).toBe(false);
      expect(await cp(r, "files", "owner_id", "UPDATE"), `${r} owner_id`).toBe(false);
      expect(await cp(r, "audit_log", "action", "UPDATE"), `${r} audit`).toBe(false);
    }
    for (const r of RUNTIME) for (const p of ["INSERT", "UPDATE", "DELETE"]) expect(await tp(r, "schema_migrations", p), `${r} ${p} registre`).toBe(false);
    expect(await tp("vyra_app", "schema_migrations", "SELECT")).toBe(true);
    expect(await tp("vyra_market", "schema_migrations", "SELECT")).toBe(false);
    // Privilège par défaut : une fonction future du propriétaire n'est pas exécutable par tous.
    expect((await rows(adminUrl(db), "SELECT defaclacl::text a FROM pg_default_acl WHERE defaclrole = 'vyra_owner'::regrole AND defaclobjtype = 'f'"))[0].a).toBe("{vyra_owner=X/vyra_owner}");
    // Effectif, connecté sous chaque rôle.
    await expect(sql(urlAs("vyra_market", db), "SELECT count(*) FROM vyra.users")).rejects.toThrow(/permission denied/);
    await expect(sql(urlAs("vyra_worker", db), "SELECT password_hash FROM vyra.users")).rejects.toThrow(/permission denied/);
    await expect(sql(urlAs("vyra_system", db), "SELECT name FROM vyra.projects")).rejects.toThrow(/permission denied/);
    await expect(sql(urlAs("vyra_backup", db), "DELETE FROM vyra.sessions")).rejects.toThrow(/permission denied/);
    for (const stmt of ["ALTER TABLE vyra.users ADD COLUMN x int", "DROP TABLE vyra.thread_charts", "TRUNCATE vyra.users", "INSERT INTO vyra.schema_migrations (name, checksum) VALUES ('999_x.sql', 'x')", "CREATE TEMP TABLE t (id int)"])
      await expect(sql(urlAs("vyra_app", db), stmt), stmt).rejects.toThrow(/permission denied|must be owner/);
  });

  it("contrôle du rôle d'exécution : vyra_app sans problème ; mauvais chemin de recherche, migrateur et superutilisateur signalés", async () => {
    const check = async (url: string, options?: string) => {
      const p = new pg.Pool({ connectionString: url, options });
      try {
        return await checkRuntimeRole(p);
      } finally {
        await p.end();
      }
    };
    expect(await check(urlAs("vyra_app", db))).toEqual({ role: "vyra_app", problems: [] });
    expect((await check(urlAs("vyra_app", db), "-c search_path=public")).problems).toEqual([expect.stringMatching(/chemin de recherche incorrect/)]);
    // Le migrateur n'a aucun droit propre sur vyra (tout passe par le rôle propriétaire) : pas de schéma courant.
    expect((await check(urlAs("vyra_migrator", db))).problems).toEqual(["chemin de recherche incorrect (schéma courant : aucun, attendu : vyra)", "peut prendre le rôle vyra_owner"]);
    expect((await check(adminUrl(db))).problems).toContain("superutilisateur");
  });

  it("le migrateur ne contourne plus RLS, et ne le pouvait pas sous le rôle propriétaire (FORCE)", async () => {
    const d = await newDb();
    await sql(adminUrl(d), "CREATE TABLE vyra.sonde (x int); ALTER TABLE vyra.sonde OWNER TO vyra_owner; INSERT INTO vyra.sonde VALUES (1), (2); ALTER TABLE vyra.sonde ENABLE ROW LEVEL SECURITY; ALTER TABLE vyra.sonde FORCE ROW LEVEL SECURITY");
    const c = new pg.Client({ connectionString: urlAs("vyra_migrator", d) });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE vyra_owner");
      expect((await c.query("SELECT count(*)::int n FROM vyra.sonde")).rows[0].n).toBe(0);
      expect((await c.query("UPDATE vyra.sonde SET x = x + 10")).rowCount).toBe(0);
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
    expect((await rows(adminUrl(d), "SELECT array_agg(x ORDER BY x) a FROM vyra.sonde"))[0].a).toEqual([1, 2]);
  });

  it("l'API fonctionne avec vyra_app (connexion réelle par mot de passe), sans privilège de migration", async () => {
    // Lot H3 : un pool par rôle, chacun connecté avec son propre mot de passe.
    const appPool = createPool(urlAs("vyra_app", db));
    const sysPool = createPool(urlAs("vyra_system", db));
    const workerPool = createPool(urlAs("vyra_worker", db));
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-roles-"));
    tmpDirs.push(storageDir);
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: urlAs("vyra_app", db), STORAGE_DIR: storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000 } as any);
    const app = await buildApp({ cfg, db: appPool, sys: sysPool, worker: workerPool });
    try {
      expect(await migrationStatus(appPool)).toEqual({ applied: FILES, pending: [], modified: [], orphans: [] });
      const c = new Client(app);
      expect((await c.post("/api/auth/signup", { email: "role@example.com", password: "un-mot-de-passe-solide", displayName: "Rôle", acceptTerms: true })).status).toBe(202);
      const { rows: m } = await workerPool.query("SELECT body_text FROM email_outbox WHERE to_email = 'role@example.com' AND template = 'verify'");
      expect((await c.post("/api/auth/verify-email", { token: tokenFrom(m[0].body_text) })).status).toBe(200);
      expect((await c.post("/api/projects", { name: "Essai rôles", design: null })).status).toBe(201);
      expect((await c.get("/api/projects")).json.projects.map((x: any) => x.name)).toEqual(["Essai rôles"]);
      expect((await c.post("/api/auth/logout")).status).toBe(200);
      const ready = await app.inject({ method: "GET", url: "/api/ready" });
      expect(ready.json().checks.migrations).toMatchObject({ ok: true });
    } finally {
      await app.close();
      await Promise.all([appPool.end(), sysPool.end(), workerPool.end()]);
    }
  });

  it("retour arrière rollback-h2.sql : retour exact à l'état H1 sans perte, puis nouveau passage à H2", async () => {
    const d = await newDb("h1");
    await migrateAs(d, migDir(H1_FILES));
    await sql(urlAs("vyra_migrator", d), H1("grants-h1.sql"));
    await seed(d);
    const h1Content = await content(d);
    const h1Structure = await structure(d);
    await sql(adminUrl(d), SQL("database-setup.sql"));
    await migrateAs(d);
    // Retour arrière, par le migrateur, en une transaction.
    execFileSync("psql", [urlAs("vyra_migrator", d), "-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-f", path.join(ROOT, "scripts/db/rollback-h2.sql")], { stdio: "pipe" });
    expect(await tablesIn(d, "public")).toEqual(SOCLE);
    expect((await rows(adminUrl(d), "SELECT to_regnamespace('vyra') IS NULL v"))[0].v).toBe(true);
    expect(await content(d)).toEqual(h1Content);
    // Mêmes droits, propriétaires, contraintes et index qu'en H1, sauf la clé corrigée par 007 (conservée).
    // Restent volontairement : la clé corrigée par 007 et les colonnes de niveau de session de 011 (aucune donnée
    // effacée par le retour arrière ; valeurs par défaut compatibles avec le code H1).
    expect(compare(h1Structure, await structure(d)).sort()).toEqual([
      expect.stringMatching(/^constraints : public\.sessions\.sessions_auth_level_check en trop/),
      expect.stringMatching(/^constraints : public\.sessions\.sessions_mfa_consistent en trop/),
      expect.stringMatching(/^constraints : public\.sessions\.sessions_mfa_via_check en trop/),
      expect.stringMatching(/^constraints : public\.user_roles\.user_roles_granted_by_fkey différent/),
    ]);
    // Le runner du lot H1 (fichiers 001-005) voit une base à jour, sans orpheline.
    const p = new pg.Pool({ connectionString: urlAs("vyra_app", d) });
    expect(await migrationStatus(p, { dir: migDir(H1_FILES) })).toMatchObject({ pending: [], modified: [], orphans: [] });
    await p.end();
    // Nouveau passage à H2 : 007-009 réappliquées, données toujours identiques.
    await sql(adminUrl(d), SQL("database-setup.sql"));
    expect(await migrateAs(d)).toEqual(H2_FILES);
    expect(await content(d)).toEqual(h1Content);
  }, 120_000);
});
