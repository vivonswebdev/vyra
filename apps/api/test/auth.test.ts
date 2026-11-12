import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, lastEmail, setup, signup, teardown, tokenFrom, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

describe("inscription et connexion", () => {
  it("crée un compte, ouvre une session et envoie l'e-mail de vérification", async () => {
    const { c, user, email } = await signup(ctx.app, "ana@example.com");
    expect(user).toMatchObject({ email, displayName: "Testeur", emailVerified: false, locale: "fr", roles: [] });
    expect((await c.get("/api/auth/me")).json.user.email).toBe(email);
    const mail = await lastEmail(ctx.db, email);
    expect(mail.template).toBe("verify");
    expect(mail.body_text).toContain("http://vyra.test/account/verify?token=");
    // Le mot de passe n'est jamais stocké en clair.
    const { rows } = await ctx.db.query("SELECT password_hash FROM users WHERE email = $1", [email]);
    expect(rows[0].password_hash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(rows[0].password_hash).not.toContain("un-mot-de-passe-solide");
  });

  it("refuse une deuxième inscription avec la même adresse (casse ignorée)", async () => {
    const c = new Client(ctx.app);
    const r = await c.post("/api/auth/signup", { email: "ANA@example.com", password: "un-mot-de-passe-solide", displayName: "X", acceptTerms: true });
    expect(r.status).toBe(409);
  });

  it("valide les champs avec des messages lisibles", async () => {
    const c = new Client(ctx.app);
    const r = await c.post("/api/auth/signup", { email: "bad", password: "court", displayName: "", acceptTerms: false });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("validation");
    expect(r.json.error.details.map((d: any) => d.path)).toEqual(expect.arrayContaining(["email", "password", "displayName", "acceptTerms"]));
  });

  it("vérifie l'adresse avec le lien reçu, une seule fois", async () => {
    const { c, email } = await signup(ctx.app);
    const token = tokenFrom((await lastEmail(ctx.db, email)).body_text);
    const r = await c.post("/api/auth/verify-email", { token });
    expect(r.status).toBe(200);
    expect(r.json.user.emailVerified).toBe(true);
    expect((await c.post("/api/auth/verify-email", { token })).status).toBe(400);
  });

  it("déconnecte puis reconnecte ; rejette un mauvais mot de passe sans dire si le compte existe", async () => {
    const { c, email } = await signup(ctx.app);
    expect((await c.post("/api/auth/logout")).status).toBe(200);
    expect((await c.get("/api/auth/me")).json.user).toBeNull();
    const wrong = await c.post("/api/auth/login", { email, password: "mauvais-mot-de-passe" });
    const unknown = await c.post("/api/auth/login", { email: "personne@example.com", password: "mauvais-mot-de-passe" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error.message).toBe(unknown.json.error.message);
    const ok = await c.post("/api/auth/login", { email: email.toUpperCase(), password: "un-mot-de-passe-solide" });
    expect(ok.status).toBe(200);
    expect((await c.get("/api/auth/me")).json.user.email).toBe(email);
  });

  it("verrouille le compte après 8 échecs consécutifs", async () => {
    const { email } = await signup(ctx.app);
    const c = new Client(ctx.app);
    for (let i = 0; i < 8; i++) await c.post("/api/auth/login", { email, password: "mauvais-mot-de-passe" });
    const r = await c.post("/api/auth/login", { email, password: "un-mot-de-passe-solide" });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("locked");
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
    const r = await c.post("/api/auth/signup", { email: "cookie@example.com", password: "un-mot-de-passe-solide", displayName: "C", acceptTerms: true });
    const ck = r.res.cookies.find((x) => x.name === "vyra_session")!;
    expect(ck.httpOnly).toBe(true);
    expect(ck.sameSite).toBe("Lax");
    // Le jeton n'est stocké que sous forme d'empreinte.
    const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM sessions WHERE encode(token_hash, 'escape') = $1", [ck.value]);
    expect(rows[0].n).toBe(0);
  });

  it("journalise les actions sensibles", async () => {
    const { rows } = await ctx.db.query("SELECT DISTINCT action FROM audit_log");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["account.signup", "account.login", "account.login_failed", "account.password_reset"]));
  });
});

describe("limitation de débit", () => {
  it("bloque au-delà de la limite par minute sur la connexion", async () => {
    // Base de test partagée : on reconstruit seulement l'application avec une limite basse.
    const { buildApp } = await import("../src/app.js");
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 3 } as any);
    const app = await buildApp({ cfg, db: ctx.db });
    const c = new Client(app);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post("/api/auth/login", { email: "x@example.com", password: "mauvais-mot-de-passe" })).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    await app.close();
  });
});
