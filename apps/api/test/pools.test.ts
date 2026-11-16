// Lot H3 : un pool par rôle, contexte utilisateur transactionnel, droits de vyra_app réduits aux requêtes
// faites pour l'utilisateur connecté, ordre des révocations (session courante supprimée en dernier).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withUser } from "../src/db/pool.js";
import { tokenHash } from "../src/lib/crypto.js";
import { Client, setup, signup, teardown, TEST_DB, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";

describe("lot H3 : pools et contexte", () => {
  it("chaque pool de l'application travaille sous son propre rôle", async () => {
    const who = async (db: pg.Pool) => (await db.query("SELECT current_user AS u")).rows[0].u;
    expect(await who(ctx.app.db)).toBe("vyra_app");
    expect(await who(ctx.app.sys)).toBe("vyra_system");
    expect(await who(ctx.app.worker)).toBe("vyra_worker");
  });

  it("le contexte utilisateur vaut pour la transaction seulement, jamais pour la requête suivante sur la même connexion", async () => {
    // Lot H5 : withUser exige un contexte confirmé par vyra.ctx_user() ; on part donc d'une vraie session.
    const { c, user } = await signup(ctx.app);
    const hash = tokenHash(c.cookie.replace(/^vyra_session=/, ""));
    // Pool d'une seule connexion : la requête suivante réutilise forcément la même.
    const one = new pg.Pool({ connectionString: TEST_DB, max: 1 });
    one.on("connect", (cl) => void cl.query("SET ROLE vyra_app"));
    try {
      const inside = await withUser(one, { userId: user.id, sessionHash: hash }, async (cl) =>
        (await cl.query("SELECT current_setting('vyra.user_id', true) AS u, current_setting('vyra.session', true) AS s")).rows[0],
      );
      expect(inside).toEqual({ u: user.id, s: hash.toString("hex") });
      const after = (await one.query("SELECT coalesce(current_setting('vyra.user_id', true), '') AS u")).rows[0].u;
      expect(after).toBe("");
      // Une erreur dans la transaction ne laisse pas non plus de contexte.
      await expect(withUser(one, { userId: user.id, sessionHash: hash }, async (cl) => cl.query("SELECT 1/0"))).rejects.toThrow(/division by zero/);
      expect((await one.query("SELECT coalesce(current_setting('vyra.user_id', true), '') AS u")).rows[0].u).toBe("");
      // Contexte non confirmé (autre utilisateur, sans session) : refusé avant toute requête de la route.
      await expect(withUser(one, { userId: "00000000-0000-4000-8000-000000000002", sessionHash: null }, async (cl) => cl.query("SELECT 1"))).rejects.toThrow(/Session expirée/);
      expect((await one.query("SELECT coalesce(current_setting('vyra.user_id', true), '') AS u")).rows[0].u).toBe("");
    } finally {
      await one.end();
    }
  });

  it("vyra_app n'a plus les droits de l'authentification ni des tâches de fond (010)", async () => {
    const tp = async (role: string, t: string, p: string) => (await ctx.db.query("SELECT has_table_privilege($1, $2, $3) v", [role, `vyra.${t}`, p])).rows[0].v;
    const cp = async (role: string, t: string, c: string, p: string) => (await ctx.db.query("SELECT has_column_privilege($1, $2, $3, $4) v", [role, `vyra.${t}`, c, p])).rows[0].v;
    for (const t of ["mfa_challenges", "auth_throttle", "rate_limits"]) {
      expect((await ctx.db.query("SELECT has_any_column_privilege('vyra_app', $1, 'SELECT,INSERT,UPDATE') v", [`vyra.${t}`])).rows[0].v, t).toBe(false);
      expect(await tp("vyra_app", t, "DELETE"), t).toBe(false);
      expect((await ctx.db.query("SELECT has_any_column_privilege('vyra_system', $1, 'INSERT') v", [`vyra.${t}`])).rows[0].v, `system ${t}`).toBe(true);
    }
    expect(await tp("vyra_app", "users", "INSERT")).toBe(false); // inscription : vyra_system
    expect(await cp("vyra_app", "users", "email_verified_at", "UPDATE")).toBe(false);
    expect(await cp("vyra_app", "users", "failed_logins", "SELECT")).toBe(false);
    expect(await cp("vyra_app", "email_outbox", "body_text", "SELECT")).toBe(false); // envoi : vyra_worker
    expect(await cp("vyra_app", "email_outbox", "sent_at", "UPDATE")).toBe(false);
    expect(await cp("vyra_app", "sessions", "last_seen_at", "UPDATE")).toBe(false); // glissement : vyra_system
    expect(await cp("vyra_app", "auth_tokens", "token_hash", "SELECT")).toBe(false);
    // Ce qui reste : les requêtes faites pour l'utilisateur.
    expect(await tp("vyra_app", "projects", "DELETE")).toBe(true);
    expect(await cp("vyra_app", "users", "display_name", "UPDATE")).toBe(true);
    expect(await tp("vyra_app", "sessions", "DELETE")).toBe(true);
  });
});

describe("lot H3 : ordre des révocations", () => {
  it("changement de mot de passe : la nouvelle session est créée avant la fermeture de toutes les autres", async () => {
    const { c, email } = await signup(ctx.app);
    const other = new Client(ctx.app);
    expect((await other.post("/api/auth/login", { email, password: PW })).status).toBe(200);
    const r = await c.post("/api/auth/change-password", { currentPassword: PW, newPassword: "nouveau-mot-de-passe-1" });
    expect(r.status).toBe(200);
    expect((await c.get("/api/auth/me")).json.user?.email).toBe(email); // nouvelle session valide
    expect((await other.get("/api/auth/me")).json.user).toBeNull(); // autres appareils déconnectés
    const { rows } = await ctx.db.query("SELECT count(*)::int n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1", [email]);
    expect(rows[0].n).toBe(1);
  });

  it("révocation de la session courante : journal écrit, session supprimée, déconnexion", async () => {
    const { c, user } = await signup(ctx.app);
    const current = (await c.get("/api/me/sessions")).json.sessions.find((s: any) => s.current);
    const r = await c.del(`/api/me/sessions/${current.id}`);
    expect(r.json).toEqual({ ok: true, current: true });
    expect((await c.get("/api/auth/me")).json.user).toBeNull();
    const { rows } = await ctx.db.query("SELECT count(*)::int n FROM audit_log WHERE actor_id = $1 AND action = 'account.session_revoked'", [user.id]);
    expect(rows[0].n).toBe(1);
  });

  it("suppression du compte : trace et confirmation écrites avant la suppression, auteur anonymisé ensuite", async () => {
    const { c, user, email } = await signup(ctx.app);
    expect((await c.del("/api/me", { password: PW, confirm: "SUPPRIMER" })).status).toBe(200);
    const trace = await ctx.db.query("SELECT actor_id, subject FROM audit_log WHERE action = 'account.deleted' AND subject = $1", [`user:${user.id}`]);
    expect(trace.rows).toEqual([{ actor_id: null, subject: `user:${user.id}` }]);
    const mails = await ctx.db.query("SELECT template FROM email_outbox WHERE to_email = $1", [email]);
    expect(mails.rows.map((m) => m.template)).toEqual(["deleted"]);
    expect((await ctx.db.query("SELECT count(*)::int n FROM users WHERE id = $1", [user.id])).rows[0].n).toBe(0);
  });
});
