// Socle H5 : sécurité au niveau des lignes (RLS forcée) et contexte utilisateur vérifié en base.
// Correspondance avec le document 21 et H2-RLS-ARCHITECTURE §7 : P-ISO-1, P-CTX-1, P-CTX-2, U-CTX-1, P-LEAK-1,
// A-LEAK-1, P-PRIV-4, P-FN-1, P-FN-2, liaison d'un fichier d'autrui, suppression d'un compte sous FORCE
// (cascades), révocation au milieu d'une transaction, tâches de fond limitées à leurs lignes, migration de
// données sous FORCE, fonctions d'administration.
//
// Tout passe par les rôles réels (vyra_app, vyra_system, vyra_worker, SET ROLE), jamais en superutilisateur :
// le superutilisateur ne sert qu'à préparer les données et à constater le résultat.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SEARCH_PATH, withUser } from "../src/db/pool.js";
import { tokenHash } from "../src/lib/crypto.js";
import { base32Decode, hotp, timeStep } from "../src/lib/totp.js";
import { Client, setup, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";
const RLS_TABLES = ["audit_log", "auth_tokens", "email_outbox", "files", "project_exports", "project_files", "project_versions", "projects", "sessions",
  "thread_charts", "user_recovery_codes", "user_roles", "users"];
const NO_RLS = ["auth_throttle", "mfa_challenges", "rate_limits", "schema_migrations"];

interface Person { c: Client; id: string; email: string; hash: string; project: string; file: string; chart: string }

const hashOf = (c: Client) => tokenHash(c.cookie.replace(/^vyra_session=/, "")).toString("hex");

/** Compte réel (inscription par l'API) et, écrites par le superutilisateur, des lignes dans chaque table. */
async function person(): Promise<Person> {
  const { c, user, email } = await signup(ctx.app);
  const q = (t: string, p: unknown[]) => ctx.db.query(t, p);
  const project = (await q("INSERT INTO projects (owner_id, name) VALUES ($1, 'P') RETURNING id", [user.id])).rows[0].id;
  await q("INSERT INTO project_versions (project_id, revision, name, settings) VALUES ($1, 1, 'P', '{}')", [project]);
  const file = (await q(
    "INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status) VALUES ($1, 'export', $2, 'f.pes', 'x', 1, repeat('a', 64), 'not_required') RETURNING id",
    [user.id, "k/" + user.id],
  )).rows[0].id;
  await q("INSERT INTO project_exports (project_id, file_id, format, revision, stats, qc) VALUES ($1, $2, 'pes', 1, '{}', '{}')", [project, file]);
  await q("INSERT INTO project_files (project_id, file_id, role) VALUES ($1, $2, 'source')", [project, file]);
  const chart = (await q("INSERT INTO thread_charts (owner_id, brand, product, status, source, entries) VALUES ($1, 'M', 'P', 'utilisateur', 'source', '[]') RETURNING id", [user.id])).rows[0].id;
  await q("INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, '\\x01')", [user.id]);
  await q("INSERT INTO user_roles (user_id, role) VALUES ($1, 'seller')", [user.id]);
  return { c, id: user.id, email, hash: hashOf(c), project, file, chart };
}

/** Connexion vyra_app hors de l'API ; contexte posé comme le fait withUser (ou forgé, pour les essais). */
async function appClient() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("SET ROLE vyra_app");
  await c.query("SET search_path = vyra, public");
  return c;
}
const setCtx = (c: pg.Client, userId: string, hash: string) =>
  c.query("SELECT set_config('vyra.user_id', $1, true), set_config('vyra.session', $2, true)", [userId, hash]);

/** Lignes de `p` visibles par la connexion, table par table. */
async function visibleOf(c: pg.Client, p: Person) {
  const one = async (sql: string, args: unknown[]) => (await c.query(sql, args)).rows[0].n as number;
  return {
    users: await one("SELECT count(*)::int n FROM users WHERE id = $1", [p.id]),
    user_roles: await one("SELECT count(*)::int n FROM user_roles WHERE user_id = $1", [p.id]),
    sessions: await one("SELECT count(*)::int n FROM sessions WHERE user_id = $1", [p.id]),
    auth_tokens: await one("SELECT count(*)::int n FROM auth_tokens WHERE user_id = $1", [p.id]),
    user_recovery_codes: await one("SELECT count(*)::int n FROM user_recovery_codes WHERE user_id = $1", [p.id]),
    email_outbox: await one("SELECT count(*)::int n FROM email_outbox WHERE to_email = $1", [p.email]),
    files: await one("SELECT count(*)::int n FROM files WHERE owner_id = $1", [p.id]),
    audit_log: await one("SELECT count(*)::int n FROM audit_log WHERE actor_id = $1", [p.id]),
    projects: await one("SELECT count(*)::int n FROM projects WHERE owner_id = $1", [p.id]),
    project_versions: await one("SELECT count(*)::int n FROM project_versions WHERE project_id = $1", [p.project]),
    project_exports: await one("SELECT count(*)::int n FROM project_exports WHERE project_id = $1", [p.project]),
    project_files: await one("SELECT count(*)::int n FROM project_files WHERE project_id = $1", [p.project]),
    thread_charts: await one("SELECT count(*)::int n FROM thread_charts WHERE owner_id = $1", [p.id]),
  };
}
const zeros = Object.fromEntries(RLS_TABLES.map((t) => [t, 0]));

describe("isolation des utilisateurs (P-ISO-1)", () => {
  it("A voit toutes ses lignes et aucune de B, table par table ; aucune écriture sur les lignes de B", async () => {
    const a = await person();
    const b = await person();
    const c = await appClient();
    try {
      await c.query("BEGIN");
      await setCtx(c, a.id, a.hash);
      const own = await visibleOf(c, a);
      // L'essai n'est pas vide : chaque table contient au moins une ligne de A, visible par A.
      for (const t of RLS_TABLES) expect(own[t as keyof typeof own], `A voit ses lignes : ${t}`).toBeGreaterThan(0);
      expect(await visibleOf(c, b)).toEqual(zeros);
      const writes: [string, unknown[]][] = [
        ["UPDATE users SET display_name = 'pirate' WHERE id = $1", [b.id]],
        ["DELETE FROM users WHERE id = $1", [b.id]],
        ["DELETE FROM sessions WHERE user_id = $1", [b.id]],
        ["UPDATE auth_tokens SET used_at = now() WHERE user_id = $1", [b.id]],
        ["UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1", [b.id]],
        ["DELETE FROM user_recovery_codes WHERE user_id = $1", [b.id]],
        ["DELETE FROM email_outbox WHERE to_email = $1", [b.email]],
        ["UPDATE files SET deleted_at = now() WHERE owner_id = $1", [b.id]],
        ["UPDATE audit_log SET details = '{}' WHERE actor_id = $1", [b.id]],
        ["UPDATE projects SET name = 'pirate' WHERE id = $1", [b.project]],
        ["DELETE FROM projects WHERE id = $1", [b.project]],
        ["DELETE FROM project_versions WHERE project_id = $1", [b.project]],
        ["DELETE FROM thread_charts WHERE id = $1", [b.chart]],
      ];
      for (const [sql, args] of writes) expect((await c.query(sql, args)).rowCount, sql).toBe(0);
      await c.query("COMMIT");
    } finally {
      await c.end();
    }
    // Constat en superutilisateur : rien n'a bougé chez B.
    const adm = await ctx.db.query("SELECT display_name, (SELECT count(*)::int FROM projects WHERE owner_id = $1 AND name = 'P') AS p FROM users WHERE id = $1", [b.id]);
    expect(adm.rows[0]).toEqual({ display_name: "Testeur", p: 1 });
  });

  it("A ne peut rien créer au nom de B, ni relier le fichier de B à son propre projet (les clés étrangères ignorent RLS)", async () => {
    const a = await person();
    const b = await person();
    const c = await appClient();
    try {
      const attempts: [string, unknown[]][] = [
        ["INSERT INTO projects (owner_id, name, design, settings, revision) VALUES ($1, 'x', NULL, '{}', 1)", [b.id]],
        ["INSERT INTO thread_charts (owner_id, brand, product, status, source, entries) VALUES ($1, 'M', 'P', 'utilisateur', 'source', '[]')", [b.id]],
        ["INSERT INTO audit_log (actor_id, action) VALUES ($1, 'faux')", [b.id]],
        ["INSERT INTO email_outbox (to_email, template, subject, body_text) VALUES ($1, 'verify', 's', 'b')", [b.email]],
        ["INSERT INTO project_versions (project_id, revision, name, settings) VALUES ($1, 2, 'x', '{}')", [b.project]],
        ["INSERT INTO project_files (project_id, file_id, role) VALUES ($1, $2, 'source')", [a.project, b.file]],
        ["INSERT INTO project_exports (project_id, file_id, format, revision, stats, qc) VALUES ($1, $2, 'pes', 1, '{}', '{}')", [a.project, b.file]],
        ["INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\\x99', $1, now() + interval '1 day')", [b.id]],
      ];
      for (const [sql, args] of attempts) {
        await c.query("BEGIN");
        await setCtx(c, a.id, a.hash);
        await expect(c.query(sql, args), sql).rejects.toThrow(/row-level security/);
        await c.query("ROLLBACK");
      }
      // A peut relier son propre fichier à son propre projet (la politique n'est pas trop stricte).
      await c.query("BEGIN");
      await setCtx(c, a.id, a.hash);
      const f = (await c.query(
        "INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status) VALUES ($1, 'export', $2, 'g.pes', 'x', 1, repeat('b', 64), 'not_required') RETURNING id",
        [a.id, "k2/" + a.id],
      )).rows[0].id;
      expect((await c.query("INSERT INTO project_files (project_id, file_id, role) VALUES ($1, $2, 'source')", [a.project, f])).rowCount).toBe(1);
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  });

  it("routes Studio avec les identifiants de B : 404, comme avant (A-ISO-1)", async () => {
    const a = await person();
    const b = await person();
    expect((await a.c.get(`/api/projects/${b.project}`)).status).toBe(404);
    expect((await a.c.del(`/api/thread-charts/${b.chart}`)).status).toBe(404);
    expect((await a.c.get(`/api/files/${b.file}`)).status).toBe(404);
  });
});

describe("contexte absent ou falsifié (P-CTX-1, P-CTX-2)", () => {
  it("sans contexte : aucune ligne, aucune écriture", async () => {
    const a = await person();
    const c = await appClient();
    try {
      expect(await visibleOf(c, a)).toEqual(zeros);
      await expect(c.query("INSERT INTO projects (owner_id, name, design, settings, revision) VALUES ($1, 'x', NULL, '{}', 1)", [a.id])).rejects.toThrow(/row-level security/);
      expect((await c.query("UPDATE projects SET name = 'x' WHERE owner_id = $1", [a.id])).rowCount).toBe(0);
      expect((await c.query("SELECT vyra.ctx_user() u")).rows[0].u).toBeNull();
    } finally {
      await c.end();
    }
  });

  it("contexte forgé, session inventée, expirée ou d'un compte suspendu : ctx_user() = NULL et aucune ligne", async () => {
    const a = await person();
    const b = await person();
    const expired = await person();
    await ctx.db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [expired.id]);
    const suspended = await person();
    await ctx.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [suspended.id]);
    const cases: [string, string, string, Person][] = [
      ["identifiant de B, session de A", b.id, a.hash, b],
      ["identifiant de B, sans session", b.id, "", b],
      ["identifiant de A, empreinte inventée", a.id, "cd".repeat(32), a],
      ["session expirée", expired.id, expired.hash, expired],
      ["compte suspendu", suspended.id, suspended.hash, suspended],
      ["identifiant mal formé", "pas-un-uuid' OR true --", a.hash, a],
      ["empreinte mal formée", a.id, "zz" + "'; DROP TABLE vyra.users; --", a],
      ["valeurs démesurées", "x".repeat(10_000), "f".repeat(10_000), a],
    ];
    const c = await appClient();
    try {
      for (const [label, id, hash, target] of cases) {
        await c.query("BEGIN");
        await setCtx(c, id, hash);
        expect((await c.query("SELECT vyra.ctx_user() u")).rows[0].u, label).toBeNull();
        expect(await visibleOf(c, target), label).toEqual(zeros);
        await c.query("ROLLBACK");
      }
    } finally {
      await c.end();
    }
    // Par l'API, la même session est refusée net : 401 (et non une réponse vide).
    expect((await expired.c.get("/api/projects")).status).toBe(401);
    await expect(withUser(ctx.appDb, { userId: b.id, sessionHash: Buffer.from(a.hash, "hex") }, async (cl) => cl.query("SELECT 1"))).rejects.toThrow(/Session expirée/);
  });

  it("session révoquée au milieu d'une transaction : l'instruction suivante ne voit plus rien", async () => {
    const a = await person();
    const c = await appClient();
    try {
      await c.query("BEGIN");
      await setCtx(c, a.id, a.hash);
      expect((await visibleOf(c, a)).projects).toBe(1);
      await ctx.sysDb.query("DELETE FROM sessions WHERE token_hash = $1", [Buffer.from(a.hash, "hex")]); // autre connexion, validée
      expect(await visibleOf(c, a)).toEqual(zeros);
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  });

  it("U-CTX-1 : le contexte n'est posé qu'à un seul endroit du code, toujours limité à la transaction", () => {
    const src = path.resolve(__dirname, "../src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|mjs|js)$/.test(e.name)) files.push(p);
      }
    };
    walk(src);
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      if (/\.sql$/.test(f)) continue;
      if (/set_config\s*\(/i.test(text)) hits.push(path.relative(src, f));
      expect(text, f).not.toMatch(/set_config\s*\([^)]*,\s*false\s*\)/i);
      expect(text, f).not.toMatch(/\bSET\s+(SESSION\s+)?vyra\./i);
    }
    expect(hits).toEqual([path.join("db", "pool.ts")]);
    const pool = fs.readFileSync(path.join(src, "db/pool.ts"), "utf8");
    expect(pool.match(/set_config\('vyra\.[a-z_]+', \$\d, true\)/g)).toHaveLength(2);
  });
});

describe("fuite entre transactions (P-LEAK-1, A-LEAK-1)", () => {
  it("même connexion : transaction de A validée ou annulée, puis B ou aucune transaction : rien de A ne reste", async () => {
    const a = await person();
    const b = await person();
    const c = await appClient();
    try {
      for (const end of ["COMMIT", "ROLLBACK"]) {
        await c.query("BEGIN");
        await setCtx(c, a.id, a.hash);
        expect((await visibleOf(c, a)).projects).toBe(1);
        await c.query(end);
        expect((await c.query("SELECT coalesce(current_setting('vyra.user_id', true), '') u")).rows[0].u, end).toBe("");
        expect(await visibleOf(c, a), end).toEqual(zeros); // hors transaction
        await c.query("BEGIN");
        await setCtx(c, b.id, b.hash);
        expect(await visibleOf(c, a), end).toEqual(zeros);
        expect((await visibleOf(c, b)).projects, end).toBe(1);
        await c.query("COMMIT");
      }
    } finally {
      await c.end();
    }
  });

  it("pool d'une seule connexion : 200 requêtes alternées de A et B en parallèle, aucune réponse ne contient les données de l'autre", async () => {
    const one = new pg.Pool({ connectionString: TEST_DB, max: 1, options: `-c search_path=${SEARCH_PATH.replace(" ", "")}` });
    one.on("connect", (cl) => void cl.query("SET ROLE vyra_app"));
    const app = await buildApp({
      cfg: loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: TEST_DB, STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 100_000 } as any),
      db: one,
      sys: ctx.sysDb,
      worker: ctx.workerDb,
    });
    try {
      const a = await signup(app);
      const b = await signup(app);
      expect((await a.c.post("/api/projects", { name: "Projet de A", design: null })).status).toBe(201);
      expect((await b.c.post("/api/projects", { name: "Projet de B", design: null })).status).toBe(201);
      const runs = await Promise.all(
        Array.from({ length: 200 }, (_, i) => (i % 2 ? b : a).c.get("/api/projects").then((r) => ({ who: i % 2 ? "B" : "A", status: r.status, names: r.json.projects?.map((p: any) => p.name) }))),
      );
      for (const r of runs) {
        expect(r.status).toBe(200);
        expect(r.names).toEqual([`Projet de ${r.who}`]);
      }
    } finally {
      await app.close();
      await one.end();
    }
  });
});

describe("catalogue (P-PRIV-4, P-FN-1, P-FN-2)", () => {
  it("toute table de vyra a RLS active et forcée, avec des politiques à rôle explicite, sauf les 4 tables techniques documentées", async () => {
    const { rows } = await ctx.db.query(
      `SELECT c.relname t, c.relrowsecurity rls, c.relforcerowsecurity f, (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'vyra' AND p.tablename = c.relname) n
         FROM pg_class c WHERE c.relnamespace = 'vyra'::regnamespace AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(rows.filter((r) => r.rls && r.f && r.n > 0).map((r) => r.t)).toEqual(RLS_TABLES);
    expect(rows.filter((r) => !r.rls).map((r) => r.t)).toEqual(NO_RLS);
    // Tables techniques : vyra_app n'y a aucun droit (sauf la lecture du registre des migrations).
    for (const t of NO_RLS.filter((x) => x !== "schema_migrations"))
      expect((await ctx.db.query("SELECT has_any_column_privilege('vyra_app', $1, 'SELECT,INSERT,UPDATE') v", [`vyra.${t}`])).rows[0].v, t).toBe(false);
    const pub = await ctx.db.query("SELECT policyname FROM pg_policies WHERE schemaname = 'vyra' AND (roles @> '{public}' OR cardinality(roles) = 0)");
    expect(pub.rows).toEqual([]);
    // Aucune politique pour vyra_market sur le socle.
    expect((await ctx.db.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname = 'vyra' AND roles @> '{vyra_market}'")).rows[0].n).toBe(0);
  });

  it("fonctions : toutes SECURITY DEFINER à chemin de recherche vide, aucun EXECUTE public, EXECUTE pour vyra_app seulement", async () => {
    const { rows } = await ctx.db.query(
      `SELECT p.proname n, p.prosecdef d, p.proconfig::text cfg, has_function_privilege('public', p.oid, 'EXECUTE') pub,
              has_function_privilege('vyra_app', p.oid, 'EXECUTE') app, has_function_privilege('vyra_system', p.oid, 'EXECUTE') sys,
              has_function_privilege('vyra_worker', p.oid, 'EXECUTE') wrk, has_function_privilege('vyra_market', p.oid, 'EXECUTE') mkt
         FROM pg_proc p WHERE p.pronamespace = 'vyra'::regnamespace ORDER BY 1`,
    );
    expect(rows.map((r) => r.n)).toEqual(["admin_find_user", "admin_guard_check", "admin_guard_count", "admin_guard_counts", "admin_guard_note",
      "admin_reset_mfa", "admin_set_role", "ctx_user", "has_staff_role"]);
    for (const r of rows) {
      expect([r.d, r.cfg, r.pub, r.sys, r.wrk, r.mkt], r.n).toEqual([true, '{"search_path=\\"\\""}', false, false, false, false]);
      expect(r.app, r.n).toBe(!["admin_guard_check", "admin_guard_note"].includes(r.n));
    }
  });

  it("une table temporaire homonyme ne détourne pas ctx_user() (noms qualifiés, chemin vide)", async () => {
    const a = await person();
    const c = new pg.Client({ connectionString: TEST_DB }); // superutilisateur : seul à pouvoir créer des tables temporaires ici
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("CREATE TEMP TABLE sessions (token_hash bytea, user_id uuid, expires_at timestamptz) ON COMMIT DROP");
      await c.query("CREATE TEMP TABLE users (id uuid, status text) ON COMMIT DROP");
      await c.query("INSERT INTO pg_temp.sessions VALUES ('\\xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd', $1, now() + interval '1 day')", [a.id]);
      await c.query("INSERT INTO pg_temp.users VALUES ($1, 'active')", [a.id]);
      await setCtx(c, a.id, "cd".repeat(32));
      expect((await c.query("SELECT vyra.ctx_user() u")).rows[0].u).toBeNull();
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  });
});

describe("rôles système et tâches de fond", () => {
  it("vyra_worker ne purge que ce que chaque purge vise ; vyra_system n'a aucun accès aux projets", async () => {
    const a = await person();
    // Sessions : seules les expirées. Jetons : seuls ceux expirés depuis 7 jours. Comptes : seuls les non
    // confirmés depuis plus de 7 jours. (vyra_worker ne lit que expires_at : il ne peut même pas filtrer par compte.)
    await expect(ctx.workerDb.query("DELETE FROM sessions WHERE user_id = $1", [a.id])).rejects.toThrow(/permission denied/);
    await ctx.workerDb.query("DELETE FROM sessions");
    await ctx.workerDb.query("DELETE FROM auth_tokens");
    expect((await ctx.workerDb.query("DELETE FROM users WHERE id = $1", [a.id])).rowCount).toBe(0);
    expect((await ctx.db.query("SELECT count(*)::int n FROM auth_tokens WHERE user_id = $1", [a.id])).rows[0].n).toBe(1);
    const old = (await ctx.db.query("INSERT INTO users (email, password_hash, display_name, created_at) VALUES ('vieux-' || gen_random_uuid() || '@example.com', 'h', 'V', now() - interval '8 days') RETURNING id")).rows[0].id;
    await ctx.db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\\x77', $1, now() - interval '1 minute')", [old]);
    expect((await ctx.workerDb.query("DELETE FROM sessions WHERE expires_at < now()")).rowCount).toBeGreaterThanOrEqual(1);
    expect((await ctx.workerDb.query("DELETE FROM users WHERE id = $1", [old])).rowCount).toBe(1);
    expect((await ctx.db.query("SELECT count(*)::int n FROM sessions WHERE user_id = $1", [a.id])).rows[0].n).toBe(1);
    await expect(ctx.sysDb.query("SELECT count(*) FROM projects")).rejects.toThrow(/permission denied/);
  });
});

describe("suppression d'un compte sous RLS forcée (cascades)", () => {
  it("toutes les lignes du compte disparaissent, celles des autres restent", async () => {
    const a = await person();
    const b = await person();
    expect((await a.c.del("/api/me", { password: PW, confirm: "SUPPRIMER" })).status).toBe(200);
    const left = async (p: Person) => {
      const n = async (sql: string, args: unknown[]) => (await ctx.db.query(sql, args)).rows[0].n;
      return {
        users: await n("SELECT count(*)::int n FROM users WHERE id = $1", [p.id]),
        sessions: await n("SELECT count(*)::int n FROM sessions WHERE user_id = $1", [p.id]),
        roles: await n("SELECT count(*)::int n FROM user_roles WHERE user_id = $1", [p.id]),
        codes: await n("SELECT count(*)::int n FROM user_recovery_codes WHERE user_id = $1", [p.id]),
        files: await n("SELECT count(*)::int n FROM files WHERE owner_id = $1", [p.id]),
        projects: await n("SELECT count(*)::int n FROM projects WHERE owner_id = $1", [p.id]),
        versions: await n("SELECT count(*)::int n FROM project_versions WHERE project_id = $1", [p.project]),
        exports: await n("SELECT count(*)::int n FROM project_exports WHERE project_id = $1", [p.project]),
        charts: await n("SELECT count(*)::int n FROM thread_charts WHERE owner_id = $1", [p.id]),
      };
    };
    expect(await left(a)).toEqual({ users: 0, sessions: 0, roles: 0, codes: 0, files: 0, projects: 0, versions: 0, exports: 0, charts: 0 });
    expect(Object.values(await left(b)).every((v) => v > 0)).toBe(true);
  });
});

describe("migrations de données sous FORCE (règle de 013)", () => {
  it("en vyra_owner, une mise à jour touche 0 ligne sans erreur ; avec NO FORCE dans la même transaction, elle s'applique, puis FORCE est rétabli", async () => {
    await person();
    const c = new pg.Client({ connectionString: TEST_DB });
    await c.connect();
    try {
      await c.query("SET ROLE vyra_migrator");
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE vyra_owner");
      expect((await c.query("UPDATE vyra.projects SET name = name")).rowCount).toBe(0);
      await c.query("ALTER TABLE vyra.projects NO FORCE ROW LEVEL SECURITY");
      expect((await c.query("UPDATE vyra.projects SET name = name")).rowCount).toBeGreaterThan(0);
      await c.query("ALTER TABLE vyra.projects FORCE ROW LEVEL SECURITY");
      expect((await c.query("UPDATE vyra.projects SET name = name")).rowCount).toBe(0);
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
    expect((await ctx.db.query("SELECT relforcerowsecurity f FROM pg_class WHERE oid = 'vyra.projects'::regclass")).rows[0].f).toBe(true);
  });
});

describe("fonctions d'administration : seconde barrière en base", () => {
  const codeAt = (secret: string, step: number) => hotp(base32Decode(secret), step);

  it("refusées sans rôle admin ou sans TOTP récent ; jamais d'empreinte ni de secret renvoyés", async () => {
    const a = await person();
    const b = await person();
    const c = await appClient();
    const call = async (p: Person, sql: string, args: unknown[]) => {
      await c.query("BEGIN");
      await setCtx(c, p.id, p.hash);
      try {
        return await c.query(sql, args);
      } finally {
        await c.query("ROLLBACK");
      }
    };
    try {
      // Utilisateur ordinaire.
      for (const [sql, args] of [
        ["SELECT * FROM vyra.admin_find_user($1)", [b.email]],
        ["SELECT vyra.admin_set_role($1, 'admin', true)", [a.id]],
        ["SELECT * FROM vyra.admin_reset_mfa($1)", [b.id]],
      ] as [string, unknown[]][])
        await expect(call(a, sql, args), sql).rejects.toThrow(/staff_required/);
      expect((await call(a, "SELECT vyra.admin_guard_counts($1) v", [b.id])).rows[0].v).toBeNull();
      expect((await call(a, "SELECT vyra.admin_guard_counts($1) v", [a.id])).rows[0].v).toBe(false);
      // Administrateur avec 2FA et TOTP récent (activation de la 2FA dans cette session) : accepté…
      await ctx.db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [a.id]);
      const secret = (await a.c.post("/api/me/2fa/setup", { password: PW })).json.secret;
      expect((await a.c.post("/api/me/2fa/enable", { code: codeAt(secret, timeStep()) })).status).toBe(200);
      const found = (await call(a, "SELECT * FROM vyra.admin_find_user($1)", [b.email.toUpperCase()])).rows;
      expect(found).toEqual([{ id: b.id, email: b.email, display_name: "Testeur", status: "active", mfa: false, roles: ["seller"] }]);
      // … mais plus avec une vérification de plus de 15 minutes.
      await ctx.db.query("UPDATE sessions SET mfa_at = now() - interval '16 minutes' WHERE user_id = $1", [a.id]);
      await expect(call(a, "SELECT * FROM vyra.admin_find_user($1)", [b.email])).rejects.toThrow(/staff_required/);
      // Ni vyra_system ni vyra_worker ne peuvent appeler ces fonctions.
      await expect(ctx.sysDb.query("SELECT vyra.ctx_user()")).rejects.toThrow(/permission denied/);
      await expect(ctx.workerDb.query("SELECT * FROM vyra.admin_find_user('x@example.com')")).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
      await ctx.db.query("ALTER TABLE user_roles DISABLE TRIGGER user_roles_admin_guard_check");
      await ctx.db.query("DELETE FROM user_roles WHERE role = 'admin'");
      await ctx.db.query("ALTER TABLE user_roles ENABLE TRIGGER user_roles_admin_guard_check");
    }
  });
});

