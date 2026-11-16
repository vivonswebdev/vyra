// Socle H4 : niveau d'authentification des sessions, nouvelle saisie du code (step-up), rôles du personnel,
// dernier administrateur (API et base), récupération par un autre administrateur.
// Correspondance avec le document 21 : A-MFA-1, A-MFA-2, A-ADM-1, A-ADM-2, P-ADM-1 ; U-MFA-1 est dans
// packages/shared/test/assurance.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { base32Decode, hotp, timeStep } from "../src/lib/totp.js";
import { tokenHash } from "../src/lib/crypto.js";
import { Client, setup, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";
const codeAt = (secret: string, step: number) => hotp(base32Decode(secret), step);

interface Person { c: Client; id: string; email: string; secret: string; recovery: string[] }

/** Le dernier pas TOTP accepté est mémorisé (anti-rejeu) : on l'efface pour pouvoir saisir un nouveau code. */
const allowNewCode = (id: string) => ctx.db.query("UPDATE users SET totp_last_step = NULL WHERE id = $1", [id]);

/** Compte avec double authentification activée ; sa session courante est de niveau « mfa » (TOTP). */
async function withMfa(): Promise<Person> {
  const { c, user, email } = await signup(ctx.app);
  const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret as string;
  const en = await c.post("/api/me/2fa/enable", { code: codeAt(secret, timeStep()) });
  expect(en.status).toBe(200);
  return { c, id: user.id, email, secret, recovery: en.json.recoveryCodes };
}
/** Administrateur : le premier est nommé directement en base (amorçage, comme le ferait l'exploitant). */
async function admin(): Promise<Person> {
  const p = await withMfa();
  await ctx.db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [p.id]);
  return p;
}
const level = async (id: string) => (await ctx.db.query("SELECT auth_level, mfa_via FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [id])).rows[0];
const isAdmin = async (id: string) => (await ctx.db.query("SELECT count(*)::int n FROM user_roles WHERE user_id = $1 AND role = 'admin'", [id])).rows[0].n === 1;
/**
 * Transaction vyra_app hors de l'API, dans le contexte vérifié d'une personne (sa vraie session, lot H5) : le
 * même contexte que withUser, posé à la main pour piloter les validations simultanées.
 */
async function openAs(p: Person) {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("SET ROLE vyra_app");
  await c.query("SET search_path = vyra, public");
  await c.query("BEGIN");
  const hash = tokenHash(p.c.cookie.replace(/^vyra_session=/, "")).toString("hex");
  await c.query("SELECT set_config('vyra.user_id', $1, true), set_config('vyra.session', $2, true)", [p.id, hash]);
  expect((await c.query("SELECT vyra.ctx_user()::text u")).rows[0].u).toBe(p.id);
  return c;
}
/** Retire tous les administrateurs (chaque test part d'un état connu), sans passer par la garde. */
async function noAdmins() {
  await ctx.db.query("ALTER TABLE user_roles DISABLE TRIGGER user_roles_admin_guard_check");
  await ctx.db.query("DELETE FROM user_roles WHERE role = 'admin'");
  await ctx.db.query("ALTER TABLE user_roles ENABLE TRIGGER user_roles_admin_guard_check");
}

describe("niveau d'authentification des sessions", () => {
  it("mot de passe seul : « password » ; activation de la 2FA : « mfa » (TOTP) ; connexion par TOTP ou par code de secours ; désactivation", async () => {
    const { user, email, c } = await signup(ctx.app);
    expect(await level(user.id)).toEqual({ auth_level: "password", mfa_via: null });
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    const en = await c.post("/api/me/2fa/enable", { code: codeAt(secret, timeStep()) });
    expect(await level(user.id)).toEqual({ auth_level: "mfa", mfa_via: "totp" });
    // Connexion avec TOTP.
    await allowNewCode(user.id);
    const t = new Client(ctx.app);
    const tok = (await t.post("/api/auth/login", { email, password: PW })).json.mfaToken;
    expect((await t.post("/api/auth/login/mfa", { mfaToken: tok, code: codeAt(secret, timeStep()) })).status).toBe(200);
    expect(await level(user.id)).toEqual({ auth_level: "mfa", mfa_via: "totp" });
    // Connexion avec un code de secours : niveau « mfa », mais noté.
    const r = new Client(ctx.app);
    const tok2 = (await r.post("/api/auth/login", { email, password: PW })).json.mfaToken;
    expect((await r.post("/api/auth/login/mfa", { mfaToken: tok2, recoveryCode: en.json.recoveryCodes[0] })).status).toBe(200);
    expect(await level(user.id)).toEqual({ auth_level: "mfa", mfa_via: "recovery" });
    // Désactivation : plus aucune session de niveau « mfa ».
    await allowNewCode(user.id);
    expect((await c.post("/api/me/2fa/disable", { password: PW, code: codeAt(secret, timeStep()) })).status).toBe(200);
    const { rows } = await ctx.db.query("SELECT DISTINCT auth_level FROM sessions WHERE user_id = $1", [user.id]);
    expect(rows).toEqual([{ auth_level: "password" }]);
  });

  it("le changement de mot de passe garde le niveau de la session courante", async () => {
    const p = await withMfa();
    expect((await p.c.post("/api/auth/change-password", { currentPassword: PW, newPassword: "nouveau-mot-de-passe-2" })).status).toBe(200);
    expect(await level(p.id)).toEqual({ auth_level: "mfa", mfa_via: "totp" });
  });
});

describe("rôles du personnel : niveau de confiance exigé (A-MFA-1, A-MFA-2)", () => {
  beforeEach(noAdmins);

  it("refuse sans rôle, sans 2FA, avec un code trop ancien, avec une connexion par code de secours ; accepte après une nouvelle saisie TOTP", async () => {
    const a = await admin();
    const target = await signup(ctx.app);
    const grant = (c: Client) => c.post(`/api/admin/users/${target.user.id}/roles`, { role: "moderator", grant: true });

    // Utilisateur ordinaire.
    expect((await grant(target.c)).json.error.reason).toBe("role_required");
    // Administrateur sans double authentification.
    const noMfa = await signup(ctx.app);
    await ctx.db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [noMfa.user.id]);
    expect((await grant(noMfa.c)).json.error.reason).toBe("mfa_not_enabled");
    await ctx.db.query("DELETE FROM user_roles WHERE user_id = $1", [noMfa.user.id]);
    // Vérification de plus de 15 minutes.
    await ctx.db.query("UPDATE sessions SET mfa_at = now() - interval '16 minutes' WHERE user_id = $1", [a.id]);
    const old = await grant(a.c);
    expect(old.status).toBe(403);
    expect(old.json.error).toMatchObject({ reason: "mfa_step_up_required", params: { min: 15 } });
    // Connexion par code de secours : pas suffisant pour les rôles, même récente.
    const r = new Client(ctx.app);
    const tok = (await r.post("/api/auth/login", { email: a.email, password: PW })).json.mfaToken;
    expect((await r.post("/api/auth/login/mfa", { mfaToken: tok, recoveryCode: a.recovery[0] })).status).toBe(200);
    expect((await grant(r)).json.error.reason).toBe("mfa_step_up_required");
    // Nouvelle saisie : un code de secours n'est pas accepté, un TOTP l'est.
    expect((await a.c.post("/api/auth/step-up", { code: a.recovery[1] })).status).toBe(400);
    await allowNewCode(a.id);
    expect((await a.c.post("/api/auth/step-up", { code: codeAt(a.secret, timeStep()) })).status).toBe(200);
    const ok = await grant(a.c);
    expect(ok.status).toBe(200);
    expect(ok.json.roles).toEqual(["moderator"]);
    const { rows } = await ctx.db.query("SELECT actor_id, details FROM audit_log WHERE action = 'admin.role_granted' AND subject = $1", [`user:${target.user.id}`]);
    expect(rows).toEqual([{ actor_id: a.id, details: { role: "moderator" } }]);
    // Recherche d'un compte par adresse exacte.
    expect((await a.c.get(`/api/admin/users?email=${encodeURIComponent(target.email)}`)).json.user).toMatchObject({ id: target.user.id, roles: ["moderator"] });
    expect((await a.c.get(`/api/admin/users?email=inconnu%40example.com`)).json.error.reason).toBe("user_not_found");
  });
});

describe("dernier administrateur (A-ADM-1, A-ADM-2, P-ADM-1)", () => {
  beforeEach(noAdmins);

  it("refuse de retirer son rôle, de désactiver sa 2FA, de supprimer son compte ou de le suspendre au dernier administrateur", async () => {
    const a = await admin();
    expect((await a.c.post(`/api/admin/users/${a.id}/roles`, { role: "admin", grant: false })).json.error.reason).toBe("last_admin");
    await allowNewCode(a.id);
    expect((await a.c.post("/api/me/2fa/disable", { password: PW, code: codeAt(a.secret, timeStep()) })).json.error.reason).toBe("last_admin");
    await allowNewCode(a.id);
    expect((await a.c.del("/api/me", { password: PW, confirm: "SUPPRIMER", code: codeAt(a.secret, timeStep()) })).json.error.reason).toBe("last_admin");
    // Suspension directe en base (aucune route ne le fait encore) : refusée par la base à la validation.
    await expect(ctx.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [a.id])).rejects.toThrow(/last_admin/);
    expect(await isAdmin(a.id)).toBe(true);
    // Avec un second administrateur, le retrait du premier est accepté.
    const b = await admin();
    expect((await b.c.post(`/api/admin/users/${a.id}/roles`, { role: "admin", grant: false })).status).toBe(200);
    expect(await isAdmin(a.id)).toBe(false);
    await noAdmins();
  });

  it("deux administrateurs qui se retirent mutuellement en même temps : un seul retrait passe", async () => {
    const a = await admin();
    const b = await admin();
    const [ra, rb] = await Promise.all([
      a.c.post(`/api/admin/users/${b.id}/roles`, { role: "admin", grant: false }),
      b.c.post(`/api/admin/users/${a.id}/roles`, { role: "admin", grant: false }),
    ]);
    // L'un passe ; l'autre est refusé, soit par la garde (409), soit plus tôt s'il n'est déjà plus administrateur (403).
    const statuses = [ra.status, rb.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    expect((await ctx.db.query("SELECT vyra.admin_guard_count() n")).rows[0].n).toBe(1);
  });

  it("en base : deux transactions vyra_app qui retirent chacune l'autre administrateur et valident en même temps, une seule passe", async () => {
    const a = await admin();
    const b = await admin();
    // Lot H5 : vyra_app ne retire plus un rôle directement ; il passe par vyra.admin_set_role, dans le contexte
    // vérifié de chaque administrateur (TOTP récent). La garde de la base reste la dernière barrière.
    const [c1, c2] = [await openAs(a), await openAs(b)];
    try {
      await c1.query("SELECT vyra.admin_set_role($1, 'admin', false)", [b.id]);
      await c2.query("SELECT vyra.admin_set_role($1, 'admin', false)", [a.id]);
      const results = await Promise.allSettled([c1.query("COMMIT"), c2.query("COMMIT")]);
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/last_admin/);
    } finally {
      await c1.end();
      await c2.end();
    }
    expect((await ctx.db.query("SELECT vyra.admin_guard_count() n")).rows[0].n).toBe(1);
    await noAdmins();
  });

  it("la base refuse le retrait du dernier rôle admin hors de l'API : DELETE direct interdit à vyra_app, fonction et superutilisateur arrêtés à la validation", async () => {
    const a = await admin();
    // 1. vyra_app n'a plus le droit de supprimer un rôle (lot H5 : passage obligé par vyra.admin_set_role).
    const one = await openAs(a);
    try {
      await expect(one.query("DELETE FROM user_roles WHERE role = 'admin'")).rejects.toThrow(/permission denied/);
    } finally {
      await one.end();
    }
    // 2. Par la fonction, dans le contexte du dernier administrateur lui-même : refus à la validation.
    const two = await openAs(a);
    try {
      expect((await two.query("SELECT vyra.admin_set_role($1, 'admin', false) r", [a.id])).rows[0].r).toEqual([]);
      await expect(two.query("COMMIT")).rejects.toThrow(/last_admin/);
    } finally {
      await two.end();
    }
    // 3. Même un superutilisateur (hors RLS) est arrêté par le déclencheur.
    await expect(ctx.db.query("DELETE FROM user_roles WHERE role = 'admin'")).rejects.toThrow(/last_admin/);
    expect(await isAdmin(a.id)).toBe(true);
    // La purge des comptes non confirmés (vyra_worker) n'est pas gênée par la garde.
    const w = await ctx.workerDb.query("DELETE FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days'");
    expect(w.rowCount).toBeGreaterThanOrEqual(0);
    await noAdmins();
  });
});

describe("récupération : un administrateur réinitialise la 2FA d'un autre (document 21 §1, cas 2)", () => {
  beforeEach(noAdmins);

  it("efface les facteurs, ferme les sessions, prévient l'intéressé, journalise ; refus pour soi-même", async () => {
    const a = await admin();
    const b = await admin();
    expect((await a.c.post(`/api/admin/users/${a.id}/2fa/reset`, {})).json.error.reason).toBe("own_mfa_reset");
    expect((await a.c.post(`/api/admin/users/${b.id}/2fa/reset`, {})).status).toBe(200);
    const u = (await ctx.db.query("SELECT totp_enabled_at, totp_secret_enc FROM users WHERE id = $1", [b.id])).rows[0];
    expect(u).toEqual({ totp_enabled_at: null, totp_secret_enc: null });
    expect((await ctx.db.query("SELECT count(*)::int n FROM user_recovery_codes WHERE user_id = $1", [b.id])).rows[0].n).toBe(0);
    expect((await b.c.get("/api/auth/me")).json.user).toBeNull();
    const mail = (await ctx.db.query("SELECT body_text FROM email_outbox WHERE to_email = $1 AND template = 'security' ORDER BY id DESC LIMIT 1", [b.email])).rows[0];
    expect(mail.body_text).toMatch(/réinitialisé votre double authentification/);
    expect((await ctx.db.query("SELECT actor_id FROM audit_log WHERE action = 'admin.mfa_reset' AND subject = $1", [`user:${b.id}`])).rows).toEqual([{ actor_id: a.id }]);
    // b reste administrateur mais ne peut plus rien faire sur les rôles avant d'avoir réactivé sa 2FA.
    const again = new Client(ctx.app);
    expect((await again.post("/api/auth/login", { email: b.email, password: PW })).status).toBe(200);
    expect((await again.post(`/api/admin/users/${a.id}/roles`, { role: "moderator", grant: true })).json.error.reason).toBe("mfa_not_enabled");
    await noAdmins();
  });
});
