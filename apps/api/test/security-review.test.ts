// Socle H6 : corrections de la revue de sécurité (migration 014 et API). Hypothèse d'attaque : une injection SQL
// qui s'exécute sous un rôle de connexion VYRA, le plus souvent sous vyra_app dans le contexte vérifié de
// l'utilisateur lui-même. Chaque test montre que la porte constatée par la revue est fermée, et que le
// fonctionnement normal n'est pas gêné.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { tokenHash } from "../src/lib/crypto.js";
import { base32Decode, hotp, timeStep } from "../src/lib/totp.js";
import { Client, roleUrl, setup, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";
import { compare } from "../../../scripts/db-control.mjs";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";
const codeAt = (secret: string, step: number) => hotp(base32Decode(secret), step);
interface Person { c: Client; id: string; email: string; hash: string; secret?: string }

async function person(): Promise<Person> {
  const { c, user, email } = await signup(ctx.app);
  return { c, id: user.id, email, hash: tokenHash(c.cookie.replace(/^vyra_session=/, "")).toString("hex") };
}
/** Compte avec double authentification ; sa session courante passe au niveau « mfa » (TOTP), avec la même empreinte. */
async function withMfa(admin = false): Promise<Person> {
  const p = await person();
  const secret = (await p.c.post("/api/me/2fa/setup", { password: PW })).json.secret as string;
  expect((await p.c.post("/api/me/2fa/enable", { code: codeAt(secret, timeStep()) })).status).toBe(200);
  if (admin) await ctx.db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [p.id]);
  return { ...p, secret };
}
/** Transaction vyra_app hors de l'API, dans le contexte vérifié de `p` (ce que verrait une injection SQL). */
async function asApp<T>(p: Person, fn: (c: pg.Client) => Promise<T>, commit = false): Promise<T> {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  try {
    await c.query("SET ROLE vyra_app");
    await c.query("SET search_path = vyra, public");
    await c.query("BEGIN");
    await c.query("SELECT set_config('vyra.user_id', $1, true), set_config('vyra.session', $2, true)", [p.id, p.hash]);
    const r = await fn(c);
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } finally {
    await c.end();
  }
}
async function noAdmins() {
  await ctx.db.query("ALTER TABLE user_roles DISABLE TRIGGER user_roles_admin_guard_check");
  await ctx.db.query("DELETE FROM user_roles WHERE role = 'admin'");
  await ctx.db.query("ALTER TABLE user_roles ENABLE TRIGGER user_roles_admin_guard_check");
}

describe("sessions et jetons créés dans le contexte de l'utilisateur", () => {
  it("ni session éternelle, ni vérification datée du futur, ni lien de réinitialisation du mot de passe", async () => {
    const a = await person();
    await asApp(a, async (c) => {
      await c.query("SAVEPOINT s");
      await expect(c.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\\xaa', $1, now() + interval '10 years')", [a.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      await expect(c.query("UPDATE sessions SET auth_level = 'mfa', mfa_at = now() + interval '10 years', mfa_via = 'totp' WHERE user_id = $1", [a.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      await expect(c.query("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ('\\xab', $1, 'reset_password', now() + interval '1 hour')", [a.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      await expect(c.query("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ('\\xac', $1, 'verify_email', now() + interval '1 year')", [a.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      // Ce que l'API fait réellement reste permis.
      expect((await c.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('\\xad', $1, now() + interval '30 days')", [a.id])).rowCount).toBe(1);
      expect((await c.query("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ('\\xae', $1, 'verify_email', now() + interval '48 hours')", [a.id])).rowCount).toBe(1);
    });
  });

  it("une vérification datée du futur ne vaut pas « récente » pour le personnel (has_staff_role)", async () => {
    await noAdmins();
    const a = await withMfa(true);
    const a2 = { ...a, hash: tokenHash(a.c.cookie.replace(/^vyra_session=/, "")).toString("hex") };
    expect(await asApp(a2, async (c) => (await c.query("SELECT vyra.has_staff_role('admin', 15, true) v")).rows[0].v)).toBe(true);
    await ctx.db.query("UPDATE sessions SET mfa_at = now() + interval '1 hour' WHERE user_id = $1", [a.id]);
    expect(await asApp(a2, async (c) => (await c.query("SELECT vyra.has_staff_role('admin', 15, true) v")).rows[0].v)).toBe(false);
    await noAdmins();
  });
});

describe("garde du dernier administrateur", () => {
  beforeEach(noAdmins);

  it("un rôle qui garde l'ancien verrou consultatif ne bloque plus les opérations gardées", async () => {
    const a = await withMfa(true);
    const b = await withMfa(true);
    const blocker = new pg.Client({ connectionString: await roleUrl("vyra_market") });
    await blocker.connect();
    try {
      await blocker.query("SELECT pg_advisory_lock(7279432)");
      const t0 = Date.now();
      const r = await a.c.post(`/api/admin/users/${b.id}/roles`, { role: "admin", grant: false });
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(5_000);
      // Le nouveau verrou et l'état de la garde sont hors de portée des rôles de connexion.
      for (const stmt of ["SELECT * FROM vyra.admin_guard_lock FOR UPDATE", "SELECT * FROM vyra.admin_guard_tx", "SELECT vyra.admin_guard_lock()"])
        await expect(blocker.query(stmt), stmt).rejects.toThrow(/permission denied/);
    } finally {
      await blocker.end();
    }
    await noAdmins();
  });

  it("poser soi-même l'ancien paramètre « avant » à 0 ne désarme plus la garde ; le nombre d'administrateurs n'est plus lisible", async () => {
    const a = await withMfa(true);
    const a2 = { ...a, hash: tokenHash(a.c.cookie.replace(/^vyra_session=/, "")).toString("hex") };
    await expect(
      asApp(a2, async (c) => {
        await c.query("SELECT set_config('vyra.admin_guard_before', '0', true)");
        await c.query("SELECT vyra.admin_set_role($1, 'admin', false)", [a.id]);
      }, true),
    ).rejects.toThrow(/last_admin/);
    expect((await ctx.db.query("SELECT count(*)::int n FROM user_roles WHERE user_id = $1 AND role = 'admin'", [a.id])).rows[0].n).toBe(1);
    await expect(asApp(a2, (c) => c.query("SELECT vyra.admin_guard_count()"))).rejects.toThrow(/permission denied/);
    // L'API garde son message clair.
    expect((await a.c.post(`/api/admin/users/${a.id}/roles`, { role: "admin", grant: false })).json.error.reason).toBe("last_admin");
    await noAdmins();
  });
});

describe("fichiers, journal, e-mails, versions", () => {
  it("l'utilisateur ne peut ni se déclarer « sain » ni déplacer un fichier ; le dépôt normal fonctionne toujours", async () => {
    const a = await person();
    await asApp(a, async (c) => {
      await c.query("SAVEPOINT s");
      await expect(c.query(
        "INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status) VALUES ($1, 'source_image', 'x/1', 'a.png', 'image/png', 1, repeat('a', 64), 'clean')",
        [a.id],
      )).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      await expect(c.query(
        "INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status) VALUES ($1, 'source_image', 'x/2', 'a.png', 'image/png', 1, repeat('a', 64), 'not_required')",
        [a.id],
      )).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      const id = (await c.query(
        "INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status) VALUES ($1, 'source_image', 'x/3', 'a.png', 'image/png', 1, repeat('a', 64), 'pending') RETURNING id",
        [a.id],
      )).rows[0].id;
      await c.query("SAVEPOINT t");
      await expect(c.query("UPDATE files SET scan_status = 'clean' WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK TO t");
      await expect(c.query("UPDATE files SET storage_key = 'ailleurs' WHERE id = $1", [id])).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK TO t");
      expect((await c.query("UPDATE files SET deleted_at = now() WHERE id = $1", [id])).rowCount).toBe(1); // corbeille : permise
    });
  });

  it("journal d'audit : modification refusée, anonymisation permise", async () => {
    const a = await person();
    await asApp(a, async (c) => {
      await c.query("SAVEPOINT s");
      await expect(c.query("UPDATE audit_log SET details = '{\"falsifié\": true}' WHERE actor_id = $1", [a.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      await expect(c.query("UPDATE audit_log SET ip = '1.2.3.4' WHERE actor_id = $1", [a.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      expect((await c.query("UPDATE audit_log SET ip = NULL, details = '{}'::jsonb WHERE actor_id = $1", [a.id])).rowCount).toBeGreaterThan(0);
    });
  });

  it("e-mails : impossible d'occuper d'avance la clé anti-doublon de l'alerte d'un autre compte", async () => {
    const a = await person();
    const b = await person();
    const victimKey = `security:password_changed:${b.id}:${new Date().toISOString().slice(0, 13)}`;
    await asApp(a, async (c) => {
      await c.query("SAVEPOINT s");
      await expect(c.query("INSERT INTO email_outbox (to_email, template, subject, body_text, dedupe_key) VALUES ($1, 'security', 's', 'b', $2)", [a.email, victimKey])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      // Sa propre clé : permise (c'est ce que fait l'API).
      const own = `security:password_changed:${a.id}:${new Date().toISOString().slice(0, 13)}`;
      expect((await c.query("INSERT INTO email_outbox (to_email, template, subject, body_text, dedupe_key) VALUES ($1, 'security', 's', 'b', $2)", [a.email, own])).rowCount).toBe(1);
    });
    // L'alerte réelle de B est bien mise en file par l'API.
    expect((await b.c.post("/api/auth/change-password", { currentPassword: PW, newPassword: "un-autre-mot-de-passe-1" })).status).toBe(200);
    expect((await ctx.db.query("SELECT count(*)::int n FROM email_outbox WHERE dedupe_key = $1", [victimKey])).rows[0].n).toBe(1);
  });

  it("versions : l'auteur ne peut pas être un autre compte", async () => {
    const a = await person();
    const b = await person();
    const project = (await a.c.post("/api/projects", { name: "V", design: null })).json.project.id;
    await asApp(a, async (c) => {
      await c.query("SAVEPOINT s");
      await expect(c.query("INSERT INTO project_versions (project_id, revision, name, settings, created_by) VALUES ($1, 9, 'x', '{}', $2)", [project, b.id])).rejects.toThrow(/row-level security/);
      await c.query("ROLLBACK TO s");
      expect((await c.query("INSERT INTO project_versions (project_id, revision, name, settings, created_by) VALUES ($1, 9, 'x', '{}', $2)", [project, a.id])).rowCount).toBe(1);
    });
  });
});

describe("second facteur : rejeu d'un même code", () => {
  it("deux saisies simultanées du même code TOTP : une seule est acceptée", async () => {
    const a = await withMfa();
    await ctx.db.query("UPDATE users SET totp_last_step = NULL WHERE id = $1", [a.id]);
    const code = codeAt(a.secret!, timeStep());
    const [r1, r2] = await Promise.all([a.c.post("/api/auth/step-up", { code }), a.c.post("/api/auth/step-up", { code })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    // Et le même code, de nouveau, plus tard : refusé.
    expect((await a.c.post("/api/auth/step-up", { code })).status).toBe(400);
  });
});

describe("récupération hors application du seul administrateur (cas 3)", () => {
  it("le script efface ses facteurs malgré la garde et RLS, ne touche à rien d'autre, rétablit tout ; refus pour une adresse inconnue", async () => {
    await noAdmins();
    const a = await withMfa(true);
    const other = await withMfa(); // un autre compte avec 2FA : intact
    const script = path.resolve(__dirname, "../../../scripts/db/recover-last-admin.sql");
    const run = async (email: string) =>
      execFileSync("psql", [await roleUrl("vyra_migrator"), "-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-v", `email=${email}`, "-f", script], { stdio: "pipe" });
    await expect(run("inconnu@example.com")).rejects.toThrow(/Aucun administrateur actif/);
    expect((await ctx.db.query("SELECT totp_enabled_at IS NOT NULL v FROM users WHERE id = $1", [a.id])).rows[0].v).toBe(true);
    await run(a.email.toUpperCase());
    const u = (await ctx.db.query("SELECT totp_enabled_at, totp_secret_enc FROM users WHERE id = $1", [a.id])).rows[0];
    expect(u).toEqual({ totp_enabled_at: null, totp_secret_enc: null });
    expect((await ctx.db.query("SELECT count(*)::int n FROM sessions WHERE user_id = $1", [a.id])).rows[0].n).toBe(0);
    expect((await ctx.db.query("SELECT count(*)::int n FROM user_recovery_codes WHERE user_id = $1", [a.id])).rows[0].n).toBe(0);
    expect((await ctx.db.query("SELECT totp_enabled_at IS NOT NULL v FROM users WHERE id = $1", [other.id])).rows[0].v).toBe(true);
    expect((await ctx.db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'ops.admin_mfa_recovered' AND subject = $1", [`user:${a.id}`])).rows[0].n).toBe(1);
    // Forçage RLS et garde rétablis.
    const st = await ctx.db.query(`SELECT bool_and(relforcerowsecurity) f FROM pg_class WHERE oid IN ('vyra.users'::regclass, 'vyra.sessions'::regclass, 'vyra.user_recovery_codes'::regclass, 'vyra.audit_log'::regclass)`);
    expect(st.rows[0].f).toBe(true);
    expect((await ctx.db.query("SELECT tgenabled FROM pg_trigger WHERE tgname = 'users_admin_guard_check'")).rows[0].tgenabled).toBe("O");
    await noAdmins();
  });
});

describe("contrôle de restauration", () => {
  it("une séquence lue par pg_dump après l'instantané (valeur supérieure) n'est pas une différence ; une valeur inférieure l'est", () => {
    const expected = { sequences: [{ name: "vyra.audit_log_id_seq", last_value: "10" }] };
    expect(compare(expected, { sequences: [{ name: "vyra.audit_log_id_seq", last_value: "12" }] }, { sequencesAtLeast: true })).toEqual([]);
    expect(compare(expected, { sequences: [{ name: "vyra.audit_log_id_seq", last_value: "9" }] }, { sequencesAtLeast: true })).toHaveLength(1);
    expect(compare(expected, { sequences: [{ name: "vyra.audit_log_id_seq", last_value: "12" }] })).toHaveLength(1);
  });
});
