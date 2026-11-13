import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, lastEmail, setup, signup, teardown, tokenFrom, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

describe("inscription et connexion", () => {
  it("l'inscription n'ouvre pas de session : le lien reçu par e-mail confirme l'adresse et connecte", async () => {
    const c = new Client(ctx.app);
    const r = await c.post("/api/auth/signup", { email: "ana@example.com", password: "un-mot-de-passe-solide", displayName: "Testeur", acceptTerms: true });
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ status: "verification_sent" });
    expect(c.cookie).toBe("");
    const mail = await lastEmail(ctx.db, "ana@example.com");
    expect(mail.template).toBe("verify");
    expect(mail.body_text).toContain("http://vyra.test/account/verify?token=");
    // Avant confirmation : connexion refusée même avec le bon mot de passe (et nouveau lien envoyé).
    const early = await c.post("/api/auth/login", { email: "ana@example.com", password: "un-mot-de-passe-solide" });
    expect(early.status).toBe(403);
    expect(early.json.error.code).toBe("email_unverified");
    const v = await c.post("/api/auth/verify-email", { token: tokenFrom(mail.body_text) });
    expect(v.json.user).toMatchObject({ email: "ana@example.com", emailVerified: true });
    expect((await c.get("/api/auth/me")).json.user.email).toBe("ana@example.com");
    const { rows } = await ctx.db.query("SELECT password_hash FROM users WHERE email = $1", ["ana@example.com"]);
    expect(rows[0].password_hash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(rows[0].password_hash).not.toContain("un-mot-de-passe-solide");
  });

  it("une adresse déjà inscrite reçoit la même réponse ; seul son propriétaire est averti, une fois par heure", async () => {
    const { email } = await signup(ctx.app, "deja@example.com");
    const fresh = new Client(ctx.app);
    const body = { email: "DEJA@example.com", password: "autre-mot-de-passe", displayName: "Intrus", acceptTerms: true };
    const a = await fresh.post("/api/auth/signup", body);
    const unknown = await fresh.post("/api/auth/signup", { ...body, email: "nouvelle@example.com" });
    expect(a.status).toBe(unknown.status);
    expect(a.json).toEqual(unknown.json);
    expect(fresh.cookie).toBe("");
    await fresh.post("/api/auth/signup", body);
    const { rows } = await ctx.db.query("SELECT template FROM email_outbox WHERE to_email = $1 AND template = 'exists'", [email]);
    expect(rows).toHaveLength(1);
    // Le compte existant n'est pas modifié : l'ancien mot de passe fonctionne toujours.
    expect((await new Client(ctx.app).post("/api/auth/login", { email, password: "un-mot-de-passe-solide" })).status).toBe(200);
    expect((await new Client(ctx.app).post("/api/auth/login", { email, password: "autre-mot-de-passe" })).status).toBe(401);
  });

  it("valide les champs avec des messages lisibles", async () => {
    const c = new Client(ctx.app);
    const r = await c.post("/api/auth/signup", { email: "bad", password: "court", displayName: "", acceptTerms: false });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("validation");
    expect(r.json.error.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(["email", "password", "displayName", "acceptTerms"]));
  });

  it("le lien de confirmation ne sert qu'une fois", async () => {
    const c = new Client(ctx.app);
    await c.post("/api/auth/signup", { email: "unefois@example.com", password: "un-mot-de-passe-solide", displayName: "X", acceptTerms: true });
    const token = tokenFrom((await lastEmail(ctx.db, "unefois@example.com")).body_text);
    expect((await c.post("/api/auth/verify-email", { token })).status).toBe(200);
    expect((await new Client(ctx.app).post("/api/auth/verify-email", { token })).status).toBe(400);
  });

  it("déconnecte puis reconnecte ; adresse inconnue et mauvais mot de passe donnent la même réponse", async () => {
    const { c, email } = await signup(ctx.app);
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    expect((await c.get("/api/auth/me")).json.user).toBeNull();
    const wrong = await c.post("/api/auth/login", { email, password: "mauvais-mot-de-passe" });
    const unknown = await c.post("/api/auth/login", { email: "personne@example.com", password: "mauvais-mot-de-passe" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
    const ok = await c.post("/api/auth/login", { email: email.toUpperCase(), password: "un-mot-de-passe-solide" });
    expect(ok.status).toBe(200);
    expect((await c.get("/api/auth/me")).json.user.email).toBe(email);
  });

  it("le verrouillage s'applique de la même façon à une adresse inconnue et à un compte existant", async () => {
    const { email } = await signup(ctx.app);
    const c = new Client(ctx.app);
    const run = async (addr: string) => {
      const codes = [];
      for (let i = 0; i < 9; i++) codes.push((await c.post("/api/auth/login", { email: addr, password: "mauvais-mot-de-passe" })).status);
      return codes;
    };
    const known = await run(email);
    const unknown = await run("fantome@example.com");
    expect(known).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 429]);
    expect(unknown).toEqual(known);
    const lockedKnown = await c.post("/api/auth/login", { email, password: "un-mot-de-passe-solide" });
    const lockedUnknown = await c.post("/api/auth/login", { email: "fantome@example.com", password: "un-mot-de-passe-solide" });
    expect(lockedKnown.status).toBe(429);
    expect(lockedKnown.json).toEqual(lockedUnknown.json);
    expect(lockedKnown.json.error.code).toBe("too_many_attempts");
    // Une autre adresse n'est pas affectée.
    expect((await c.post("/api/auth/login", { email: "autre-fantome@example.com", password: "x" })).status).toBe(401);
  });

  it("un compte suspendu n'est révélé qu'avec le bon mot de passe", async () => {
    const { email, user } = await signup(ctx.app);
    await ctx.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [user.id]);
    const c = new Client(ctx.app);
    const wrong = await c.post("/api/auth/login", { email, password: "mauvais-mot-de-passe" });
    expect(wrong.json.error.code).toBe("invalid_credentials");
    const right = await c.post("/api/auth/login", { email, password: "un-mot-de-passe-solide" });
    expect(right.status).toBe(403);
    expect(right.json.error.code).toBe("account_suspended");
  });

  it("le renvoi du lien de confirmation répond pareil pour toute adresse et ne spamme pas", async () => {
    const c = new Client(ctx.app);
    await c.post("/api/auth/signup", { email: "renvoi@example.com", password: "un-mot-de-passe-solide", displayName: "R", acceptTerms: true });
    const a = await c.post("/api/auth/resend-verification-email", { email: "renvoi@example.com" });
    const b = await c.post("/api/auth/resend-verification-email", { email: "inconnu-renvoi@example.com" });
    expect(a.json).toEqual(b.json);
    await c.post("/api/auth/resend-verification-email", { email: "renvoi@example.com" });
    const { rows } = await ctx.db.query("SELECT count(*)::int n FROM email_outbox WHERE to_email = 'renvoi@example.com'");
    expect(rows[0].n).toBe(2); // inscription + un seul renvoi dans la fenêtre de 5 minutes
  });
});

describe("mot de passe oublié", () => {
  it("répond pareil pour une adresse inconnue et n'envoie rien", async () => {
    const c = new Client(ctx.app);
    const r = await c.post("/api/auth/forgot-password", { email: "inconnu@example.com" });
    expect(r.status).toBe(200);
    expect(await lastEmail(ctx.db, "inconnu@example.com")).toBeUndefined();
  });

  it("réinitialise avec le lien, ferme les autres sessions et refuse un lien réutilisé", async () => {
    const { c: other, email } = await signup(ctx.app);
    const c = new Client(ctx.app);
    expect((await c.post("/api/auth/forgot-password", { email })).status).toBe(200);
    const mail = await lastEmail(ctx.db, email);
    expect(mail.template).toBe("reset");
    const token = tokenFrom(mail.body_text);
    const r = await c.post("/api/auth/reset-password", { token, password: "nouveau-mot-de-passe" });
    expect(r.status).toBe(200);
    expect(r.json.user.emailVerified).toBe(true);
    expect((await other.get("/api/auth/me")).json.user).toBeNull();
    expect((await c.post("/api/auth/reset-password", { token, password: "encore-un-autre" })).status).toBe(400);
    const fresh = new Client(ctx.app);
    expect((await fresh.post("/api/auth/login", { email, password: "nouveau-mot-de-passe" })).status).toBe(200);
  });

  it("refuse un lien expiré", async () => {
    const { email } = await signup(ctx.app);
    const c = new Client(ctx.app);
    await c.post("/api/auth/forgot-password", { email });
    const token = tokenFrom((await lastEmail(ctx.db, email)).body_text);
    await ctx.db.query("UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE purpose = 'reset_password'");
    expect((await c.post("/api/auth/reset-password", { token, password: "nouveau-mot-de-passe" })).status).toBe(400);
  });
});

describe("profil, préférences et sécurité", () => {
  it("met à jour nom, langue, thème et préférences", async () => {
    const { c } = await signup(ctx.app);
    const r = await c.patch("/api/me", { displayName: "Atelier Rose", locale: "nl", theme: "dark", preferences: { uiMode: "expert", defaultHoopId: "sa449s" } });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ displayName: "Atelier Rose", locale: "nl", theme: "dark", preferences: { uiMode: "expert", defaultHoopId: "sa449s" } });
    const again = await c.patch("/api/me", { preferences: { units: "mm" } });
    expect(again.json.user.preferences).toEqual({ uiMode: "expert", defaultHoopId: "sa449s", units: "mm" });
  });

  it("change le mot de passe en exigeant l'actuel", async () => {
    const { c, email } = await signup(ctx.app);
    expect((await c.post("/api/auth/change-password", { currentPassword: "faux", newPassword: "nouveau-mot-de-passe" })).status).toBe(400);
    expect((await c.post("/api/auth/change-password", { currentPassword: "un-mot-de-passe-solide", newPassword: "nouveau-mot-de-passe" })).status).toBe(200);
    expect((await c.get("/api/auth/me")).json.user.email).toBe(email);
  });

  it("bloque une écriture sans l'en-tête anti-CSRF ou depuis une autre origine", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(403);
    const res2 = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { "x-vyra-client": "web", origin: "https://evil.example" } });
    expect(res2.statusCode).toBe(403);
  });

  it("refuse les routes protégées sans session et pose un cookie httpOnly SameSite=Lax", async () => {
    const c = new Client(ctx.app);
    expect((await c.get("/api/projects")).status).toBe(401);
    await c.post("/api/auth/signup", { email: "cookie@example.com", password: "un-mot-de-passe-solide", displayName: "C", acceptTerms: true });
    const r = await c.post("/api/auth/verify-email", { token: tokenFrom((await lastEmail(ctx.db, "cookie@example.com")).body_text) });
    const ck = r.res.cookies.find((x) => x.name === "vyra_session")!;
    expect(ck.httpOnly).toBe(true);
    expect(ck.sameSite).toBe("Lax");
    // Le jeton n'est stocké que sous forme d'empreinte.
    const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM sessions WHERE encode(token_hash, 'escape') = $1", [ck.value]);
    expect(rows[0].n).toBe(0);
  });

  it("journalise les actions sensibles", async () => {
    const { rows } = await ctx.db.query("SELECT DISTINCT action FROM audit_log");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["account.signup", "account.signup_existing", "account.email_verified", "account.login", "account.login_failed", "account.password_reset"]));
  });
});

describe("limitation de débit", () => {
  it("bloque au-delà de la limite par minute sur la connexion", async () => {
    // Base de test partagée : on reconstruit seulement l'application avec une limite basse.
    const { buildApp } = await import("../src/app.js");
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 3, RATE_LIMIT_NAMESPACE: "limite-test:" } as any);
    const app = await buildApp({ cfg, db: ctx.db });
    const c = new Client(app);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post("/api/auth/login", { email: "x@example.com", password: "mauvais-mot-de-passe" })).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    await app.close();
  });
});
