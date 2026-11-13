// E-mails transmis à un VRAI serveur SMTP de test (Mailpit, local et CI) : contenu reçu, liens
// utilisables, expirations, alertes de sécurité, absence de doublon, erreurs d'envoi et reprise.
// Exécuté si SMTP_TEST_URL et MAILPIT_TEST_API sont définis. Aucun message commercial.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSender, flushOutbox } from "../src/lib/mailer.js";
import { base32Decode, hotp, timeStep } from "../src/lib/totp.js";
import { Client, setup, teardown, tokenFrom, type Ctx } from "./helpers.js";

const SMTP = process.env.SMTP_TEST_URL ?? "";
const API = process.env.MAILPIT_TEST_API ?? "";
const PW = "un-mot-de-passe-solide";

describe.runIf(!!SMTP && !!API)("e-mails réels par SMTP (Mailpit)", () => {
  let ctx: Ctx;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cfg: ReturnType<typeof loadConfig>;

  const inbox = async (to: string) => {
    const r = await (await fetch(`${API}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`)).json();
    const out = [];
    for (const m of r.messages ?? []) {
      const full = await (await fetch(`${API}/api/v1/message/${m.ID}`)).json();
      out.push({ subject: full.Subject as string, text: full.Text as string, from: full.From.Address as string });
    }
    return out;
  };
  const flush = () => flushOutbox(ctx.db, cfg, createSender(cfg));
  const fullSignup = async (email: string) => {
    const c = new Client(app);
    await c.post("/api/auth/signup", { email, password: PW, displayName: "Atelier", acceptTerms: true, locale: "fr" });
    await flush();
    const [m] = await inbox(email);
    expect((await c.post("/api/auth/verify-email", { token: tokenFrom(m.text) })).status).toBe(200);
    return c;
  };

  beforeAll(async () => {
    ctx = await setup();
    cfg = loadConfig({ NODE_ENV: "test" } as any, {
      DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test",
      AUTH_RATE_LIMIT: 10_000, MAIL_TRANSPORT: "smtp", SMTP_URL: SMTP, MAIL_FROM: "VYRA Test <no-reply@vyra.test>",
    } as any);
    app = await buildApp({ cfg, db: ctx.db });
  });
  beforeEach(async () => {
    await fetch(`${API}/api/v1/messages`, { method: "DELETE" });
  });
  afterAll(async () => {
    await app.close();
    await teardown(ctx);
  });

  it("vérification de compte : message reçu, lien valable 48 h, lien utilisable une fois", async () => {
    const c = new Client(app);
    await c.post("/api/auth/signup", { email: "verif@example.com", password: PW, displayName: "Ana", acceptTerms: true, locale: "fr" });
    expect(await flush()).toBe(1);
    const [m] = await inbox("verif@example.com");
    expect(m.subject).toBe("Confirmez votre adresse e-mail VYRA");
    expect(m.from).toBe("no-reply@vyra.test");
    expect(m.text).toContain("Bonjour Ana");
    expect(m.text).toContain("48 heures");
    const link = /http:\/\/vyra\.test\/account\/verify\?token=\S+/.exec(m.text)![0];
    const token = tokenFrom(link);
    expect((await c.post("/api/auth/verify-email", { token })).json.user.emailVerified).toBe(true);
    expect((await new Client(app).post("/api/auth/verify-email", { token })).status).toBe(400);
  });

  it("réinitialisation : lien valable 1 h, utilisable une fois, alerte « mot de passe modifié » ensuite", async () => {
    await fullSignup("reset@example.com");
    await fetch(`${API}/api/v1/messages`, { method: "DELETE" });
    const x = new Client(app);
    await x.post("/api/auth/forgot-password", { email: "reset@example.com" });
    await flush();
    const [m] = await inbox("reset@example.com");
    expect(m.subject).toBe("Réinitialisation de votre mot de passe VYRA");
    expect(m.text).toContain("1 heure");
    const token = tokenFrom(m.text);
    expect((await x.post("/api/auth/reset-password", { token, password: "nouveau-mot-de-passe" })).status).toBe(200);
    expect((await x.post("/api/auth/reset-password", { token, password: "encore-un-autre" })).status).toBe(400);
    await flush();
    const all = await inbox("reset@example.com");
    expect(all.map((x) => x.subject)).toContain("Alerte de sécurité sur votre compte VYRA");
    expect(all.find((x) => x.subject.startsWith("Alerte"))!.text).toContain("Votre mot de passe vient d'être modifié.");
  });

  it("alertes de sécurité 2FA : activation, code de secours utilisé, désactivation", async () => {
    const c = await fullSignup("deuxfa@example.com");
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    const step = timeStep();
    const codes = (await c.post("/api/me/2fa/enable", { code: hotp(base32Decode(secret), step) })).json.recoveryCodes;
    const x = new Client(app);
    const t = (await x.post("/api/auth/login", { email: "deuxfa@example.com", password: PW })).json.mfaToken;
    await x.post("/api/auth/login/mfa", { mfaToken: t, recoveryCode: codes[0] });
    await c.post("/api/me/2fa/disable", { password: PW, code: hotp(base32Decode(secret), step + 1) });
    await flush();
    const texts = (await inbox("deuxfa@example.com")).filter((m) => m.subject.startsWith("Alerte")).map((m) => m.text);
    expect(texts.some((t) => t.includes("double authentification vient d'être activée"))).toBe(true);
    expect(texts.some((t) => t.includes("Un code de secours vient d'être utilisé"))).toBe(true);
    expect(texts.some((t) => t.includes("double authentification vient d'être désactivée"))).toBe(true);
    for (const tx of texts) expect(tx).toContain("http://vyra.test/studio/account");
  });

  it("alerte de verrouillage : une seule, même après de nouveaux échecs", async () => {
    await fullSignup("verrou@example.com");
    await fetch(`${API}/api/v1/messages`, { method: "DELETE" });
    const x = new Client(app);
    for (let i = 0; i < 12; i++) await x.post("/api/auth/login", { email: "verrou@example.com", password: "faux" });
    await flush();
    const alerts = (await inbox("verrou@example.com")).filter((m) => m.text.includes("bloquées pendant 15 minutes"));
    expect(alerts).toHaveLength(1);
  });

  it("deux instances qui envoient en même temps ne produisent aucun doublon", async () => {
    for (let i = 0; i < 6; i++) await new Client(app).post("/api/auth/forgot-password", { email: "verif@example.com" });
    const before = (await ctx.db.query("SELECT count(*)::int n FROM email_outbox WHERE sent_at IS NULL")).rows[0].n;
    const [a, b] = await Promise.all([flush(), flush()]);
    expect(a + b).toBe(before);
    expect((await inbox("verif@example.com")).length).toBe(before);
  });

  it("panne SMTP : message conservé, erreur notée, nouvel essai différé puis livré une seule fois", async () => {
    await new Client(app).post("/api/auth/forgot-password", { email: "verif@example.com" });
    const broken = createSender({ ...cfg, SMTP_URL: "smtp://127.0.0.1:1" } as any);
    expect(await flushOutbox(ctx.db, cfg, broken)).toBe(0);
    const { rows } = await ctx.db.query("SELECT id, attempts, last_error, sent_at, claimed_until > now() AS delayed FROM email_outbox WHERE sent_at IS NULL ORDER BY id DESC LIMIT 1");
    expect(rows[0]).toMatchObject({ attempts: 1, sent_at: null, delayed: true });
    expect(rows[0].last_error).toMatch(/ECONNREFUSED|connect/i);
    expect(await flush()).toBe(0); // reprise différée : pas encore
    await ctx.db.query("UPDATE email_outbox SET claimed_until = now() - interval '1 second' WHERE id = $1", [rows[0].id]);
    expect(await flush()).toBe(1);
    expect(await flush()).toBe(0);
    expect((await inbox("verif@example.com")).length).toBe(1);
  });

  it("après 5 échecs, un message n'est plus retenté", async () => {
    await new Client(app).post("/api/auth/forgot-password", { email: "verif@example.com" });
    const broken = createSender({ ...cfg, SMTP_URL: "smtp://127.0.0.1:1" } as any);
    for (let i = 0; i < 6; i++) {
      await ctx.db.query("UPDATE email_outbox SET claimed_until = NULL WHERE sent_at IS NULL");
      await flushOutbox(ctx.db, cfg, broken);
    }
    const { rows } = await ctx.db.query("SELECT attempts FROM email_outbox WHERE sent_at IS NULL ORDER BY id DESC LIMIT 1");
    expect(rows[0].attempts).toBe(5);
  });
});
