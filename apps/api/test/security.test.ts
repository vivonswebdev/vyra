// Tests de sécurité du lot 3.1 : limitation de débit partagée entre instances, procédures de
// révocation de session, protections préservées (CSRF, 2FA).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { base32Decode, hotp, timeStep } from "../src/lib/totp.js";
import { Client, lastEmail, setup, signup, teardown, tokenFrom, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";
const instance = (over: Record<string, unknown> = {}) =>
  buildApp({
    cfg: loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 10_000, ...over } as any),
    db: ctx.db,
  });

describe("limitation de débit partagée entre instances", () => {
  it("deux instances de l'API se partagent le même compteur", async () => {
    const a = await instance({ AUTH_RATE_LIMIT: 4, RATE_LIMIT_NAMESPACE: "multi:" });
    const b = await instance({ AUTH_RATE_LIMIT: 4, RATE_LIMIT_NAMESPACE: "multi:" });
    const ca = new Client(a);
    const cb = new Client(b);
    const codes = [];
    for (const c of [ca, cb, ca, cb, ca, cb]) codes.push((await c.post("/api/auth/forgot-password", { email: "x@example.com" })).status);
    expect(codes).toEqual([200, 200, 200, 200, 429, 429]);
    const r = await cb.post("/api/auth/forgot-password", { email: "x@example.com" });
    expect(r.json.error.code).toBe("rate_limited");
    await a.close();
    await b.close();
  });

  it("le verrouillage par adresse est lui aussi partagé entre instances", async () => {
    const a = await instance();
    const b = await instance();
    for (let i = 0; i < 8; i++) await new Client(i % 2 ? a : b).post("/api/auth/login", { email: "partage@example.com", password: "faux" });
    expect((await new Client(a).post("/api/auth/login", { email: "partage@example.com", password: "faux" })).status).toBe(429);
    expect((await new Client(b).post("/api/auth/login", { email: "partage@example.com", password: "faux" })).status).toBe(429);
    await a.close();
    await b.close();
  });
});

describe("révocation des sessions", () => {
  const twoDevices = async () => {
    const { c, email, user } = await signup(ctx.app);
    const other = new Client(ctx.app);
    expect((await other.post("/api/auth/login", { email, password: PW })).status).toBe(200);
    return { c, other, email, user };
  };
  const alive = async (c: Client) => !!(await c.get("/api/auth/me")).json.user;

  it("déconnexion : seule la session courante est fermée", async () => {
    const { c, other } = await twoDevices();
    await c.post("/api/auth/logout");
    expect(await alive(c)).toBe(false);
    expect(await alive(other)).toBe(true);
  });

  it("« déconnecter les autres appareils » garde la session courante", async () => {
    const { c, other } = await twoDevices();
    expect((await c.post("/api/me/sessions/revoke-others")).json.revoked).toBe(1);
    expect(await alive(c)).toBe(true);
    expect(await alive(other)).toBe(false);
  });

  it("changer le mot de passe ferme toutes les autres sessions", async () => {
    const { c, other } = await twoDevices();
    await c.post("/api/auth/change-password", { currentPassword: PW, newPassword: "nouveau-mot-de-passe" });
    expect(await alive(c)).toBe(true);
    expect(await alive(other)).toBe(false);
  });

  it("réinitialiser le mot de passe par e-mail ferme toutes les sessions existantes", async () => {
    const { c, other, email } = await twoDevices();
    const x = new Client(ctx.app);
    await x.post("/api/auth/forgot-password", { email });
    await x.post("/api/auth/reset-password", { token: tokenFrom((await lastEmail(ctx.db, email)).body_text), password: "nouveau-mot-de-passe" });
    expect(await alive(c)).toBe(false);
    expect(await alive(other)).toBe(false);
    expect(await alive(x)).toBe(true);
  });

  it("activer la double authentification ferme les autres sessions", async () => {
    const { c, other } = await twoDevices();
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    await c.post("/api/me/2fa/enable", { code: hotp(base32Decode(secret), timeStep()) });
    expect(await alive(c)).toBe(true);
    expect(await alive(other)).toBe(false);
  });

  it("une session expirée, ou d'un compte suspendu, n'ouvre plus rien", async () => {
    const { c, other, user } = await twoDevices();
    await ctx.db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND token_hash = (SELECT token_hash FROM sessions WHERE user_id = $1 ORDER BY created_at LIMIT 1)", [user.id]);
    expect(await alive(c)).toBe(false);
    expect(await alive(other)).toBe(true);
    await ctx.db.query("UPDATE users SET status = 'suspended' WHERE id = $1", [user.id]);
    expect(await alive(other)).toBe(false);
  });

  it("la suppression du compte ferme toutes ses sessions", async () => {
    const { c, other } = await twoDevices();
    await c.del("/api/me", { password: PW, confirm: "SUPPRIMER" });
    expect(await alive(c)).toBe(false);
    expect(await alive(other)).toBe(false);
  });
});

describe("protections préservées", () => {
  it("CSRF : toute écriture sans en-tête client ou depuis une autre origine est refusée, y compris sur les nouvelles routes", async () => {
    for (const url of ["/api/auth/signup", "/api/auth/resend-verification-email", "/api/me/2fa/setup", "/api/thread-charts"]) {
      expect((await ctx.app.inject({ method: "POST", url, payload: {} })).statusCode, url).toBe(403);
      expect((await ctx.app.inject({ method: "POST", url, payload: {}, headers: { "x-vyra-client": "web", origin: "https://evil.example" } })).statusCode, url).toBe(403);
    }
  });

  it("la 2FA reste exigée à la connexion et après confirmation d'adresse", async () => {
    const { c, email } = await signup(ctx.app);
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    await c.post("/api/me/2fa/enable", { code: hotp(base32Decode(secret), timeStep()) });
    const x = new Client(ctx.app);
    expect((await x.post("/api/auth/login", { email, password: PW })).json.mfaRequired).toBe(true);
    expect(x.cookie).toBe("");
  });
});
