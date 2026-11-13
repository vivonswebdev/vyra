import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, timeStep, verifyTotp } from "../src/lib/totp.js";
import { SecretBox } from "../src/lib/secretbox.js";
import { Client, lastEmail, setup, signup, teardown, tokenFrom, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";
const codeAt = (secret: string, step: number) => hotp(base32Decode(secret), step);
const blank = { name: "Toile", widthMm: 100, heightMm: 100, threads: [{ rgb: "#5a3a28", name: "Brun", brand: "", code: "" }], objects: [] };

describe("TOTP (RFC 6238) et chiffrement des secrets", () => {
  it("respecte les vecteurs de test de la RFC 6238 (SHA-1, tronqués à 6 chiffres)", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(hotp(secret, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(secret, Math.floor(1234567890 / 30))).toBe("005924");
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });

  it("accepte ±1 pas, refuse le rejeu et les codes mal formés", () => {
    const s = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1234567890_000;
    const step = timeStep(now);
    expect(verifyTotp(s, codeAt(s, step), { now })).toBe(step);
    expect(verifyTotp(s, codeAt(s, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(s, codeAt(s, step - 3), { now })).toBeNull();
    expect(verifyTotp(s, codeAt(s, step), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(s, "12345", { now })).toBeNull();
  });

  it("chiffre de façon authentifiée", () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString("base64"));
    const sealed = box.seal("SECRET");
    expect(sealed).not.toContain("SECRET");
    expect(box.open(sealed)).toBe("SECRET");
    // Un bit modifié dans le vecteur d'initialisation, l'étiquette ou le chiffré est toujours détecté.
    // (L'ancienne version remplaçait un caractère base64 par lui-même une fois sur 64 : test instable.)
    const parts = sealed.split(".");
    for (const i of [1, 2, 3]) {
      const b = Buffer.from(parts[i], "base64url");
      b[b.length - 1] ^= 0x01;
      const tampered = parts.map((p, j) => (j === i ? b.toString("base64url") : p)).join(".");
      expect(tampered).not.toBe(sealed);
      expect(() => box.open(tampered)).toThrow();
    }
  });
});

describe("double authentification", () => {
  it("s'active avec un code, impose le second facteur à la connexion et refuse le rejeu", async () => {
    const { c, email } = await signup(ctx.app);
    expect((await c.post("/api/me/2fa/setup", { password: "faux" })).status).toBe(400);
    const setupR = await c.post("/api/me/2fa/setup", { password: PW });
    expect(setupR.status).toBe(200);
    expect(setupR.json.qrSvg).toContain("<svg");
    expect(setupR.json.otpauthUri).toMatch(/^otpauth:\/\/totp\/VYRA:/);
    const secret = setupR.json.secret as string;
    // Le secret n'est jamais stocké en clair.
    const { rows } = await ctx.db.query("SELECT totp_pending_enc FROM users WHERE email = $1", [email]);
    expect(rows[0].totp_pending_enc).not.toContain(secret);

    expect((await c.post("/api/me/2fa/enable", { code: "000000" })).status).toBe(400);
    const step = timeStep();
    const en = await c.post("/api/me/2fa/enable", { code: codeAt(secret, step) });
    expect(en.status).toBe(200);
    expect(en.json.recoveryCodes).toHaveLength(10);
    expect((await c.get("/api/me/2fa")).json).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });

    // Connexion : mot de passe seul => aucune session.
    const fresh = new Client(ctx.app);
    const first = await fresh.post("/api/auth/login", { email, password: PW });
    expect(first.json).toMatchObject({ mfaRequired: true });
    expect(fresh.cookie).toBe("");
    expect((await fresh.get("/api/auth/me")).json.user).toBeNull();
    expect((await fresh.post("/api/auth/login/mfa", { mfaToken: first.json.mfaToken, code: "123456" })).status).toBe(401);
    // Le code déjà utilisé à l'activation est refusé (anti-rejeu) ; le suivant est accepté.
    expect((await fresh.post("/api/auth/login/mfa", { mfaToken: first.json.mfaToken, code: codeAt(secret, step) })).status).toBe(401);
    const ok = await fresh.post("/api/auth/login/mfa", { mfaToken: first.json.mfaToken, code: codeAt(secret, step + 1) });
    expect(ok.status).toBe(200);
    expect((await fresh.get("/api/auth/me")).json.user.email).toBe(email);
    // Le défi est à usage unique.
    expect((await new Client(ctx.app).post("/api/auth/login/mfa", { mfaToken: first.json.mfaToken, code: codeAt(secret, step + 1) })).status).toBe(401);

    // Code de secours : une seule fois.
    const recovery = en.json.recoveryCodes[0];
    const other = new Client(ctx.app);
    const t2 = (await other.post("/api/auth/login", { email, password: PW })).json.mfaToken;
    expect((await other.post("/api/auth/login/mfa", { mfaToken: t2, recoveryCode: recovery })).status).toBe(200);
    const third = new Client(ctx.app);
    const t3 = (await third.post("/api/auth/login", { email, password: PW })).json.mfaToken;
    expect((await third.post("/api/auth/login/mfa", { mfaToken: t3, recoveryCode: recovery })).status).toBe(401);
  });

  it("le défi expire après 5 essais", async () => {
    const { c, email } = await signup(ctx.app);
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    await c.post("/api/me/2fa/enable", { code: codeAt(secret, timeStep()) });
    const x = new Client(ctx.app);
    const t = (await x.post("/api/auth/login", { email, password: PW })).json.mfaToken;
    for (let i = 0; i < 5; i++) await x.post("/api/auth/login/mfa", { mfaToken: t, code: "000000" });
    expect((await x.post("/api/auth/login/mfa", { mfaToken: t, code: codeAt(secret, timeStep() + 1) })).status).toBe(401);
  });

  it("la réinitialisation du mot de passe par e-mail ne contourne pas la double authentification", async () => {
    const { c, email } = await signup(ctx.app);
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    await c.post("/api/me/2fa/enable", { code: codeAt(secret, timeStep()) });
    const x = new Client(ctx.app);
    await x.post("/api/auth/forgot-password", { email });
    const r = await x.post("/api/auth/reset-password", { token: tokenFrom((await lastEmail(ctx.db, email)).body_text), password: "nouveau-mot-de-passe" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ user: null, loginRequired: true });
    expect(x.cookie).toBe("");
    expect((await x.post("/api/auth/login", { email, password: "nouveau-mot-de-passe" })).json.mfaRequired).toBe(true);
  });

  it("se désactive avec mot de passe et code", async () => {
    const { c } = await signup(ctx.app);
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    const step = timeStep();
    await c.post("/api/me/2fa/enable", { code: codeAt(secret, step) });
    expect((await c.post("/api/me/2fa/disable", { password: PW, code: "000000" })).status).toBe(400);
    expect((await c.post("/api/me/2fa/disable", { password: PW, code: codeAt(secret, step + 1) })).status).toBe(200);
    expect((await c.get("/api/me/2fa")).json.enabled).toBe(false);
  });
});

describe("appareils connectés", () => {
  it("liste les sessions, en révoque une précise, refuse celles d'un autre compte", async () => {
    const { c, email } = await signup(ctx.app);
    const phone = new Client(ctx.app);
    await phone.req("POST", "/api/auth/login", { email, password: PW }, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" });
    const list = (await c.get("/api/me/sessions")).json.sessions;
    expect(list).toHaveLength(2);
    const other = list.find((s: any) => !s.current);
    expect(other.device).toBe("Safari · iOS");
    const intruder = await signup(ctx.app);
    expect((await intruder.c.del(`/api/me/sessions/${other.id}`)).status).toBe(404);
    expect((await c.del(`/api/me/sessions/${other.id}`)).status).toBe(200);
    expect((await phone.get("/api/auth/me")).json.user).toBeNull();
    expect((await c.get("/api/auth/me")).json.user.email).toBe(email);
  });
});

describe("export des données personnelles", () => {
  it("produit une archive ZIP valide avec compte, projets, versions et fichiers, sans les données d'autrui", async () => {
    const { c, email } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "Mon motif", design: blank })).json.project;
    await c.patch(`/api/projects/${p.id}`, { baseRevision: 1, name: "Mon motif v2", snapshot: true, snapshotLabel: "Étape" });
    const other = await signup(ctx.app);
    await other.c.post("/api/projects", { name: "Projet secret d'un autre", design: blank });

    const r = await c.get("/api/me/export");
    expect(r.status).toBe(200);
    expect(r.res.headers["content-type"]).toBe("application/zip");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-export-"));
    const file = path.join(dir, "export.zip");
    fs.writeFileSync(file, r.res.rawPayload);
    // Lecture par un outil indépendant (zipfile de Python) : liste, intégrité CRC, contenu.
    const out = execFileSync("python3", ["-c", `import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({"names": z.namelist(), "compte": json.loads(z.read("compte.json"))["utilisateur"]["email"], "all": "".join(z.read(n).decode("utf-8","ignore") for n in z.namelist())}))`, file], { encoding: "utf8" });
    const res = JSON.parse(out);
    expect(res.compte).toBe(email);
    expect(res.names).toEqual(expect.arrayContaining(["LISEZMOI.txt", "compte.json", "nuanciers.json"]));
    expect(res.names.some((n: string) => n.startsWith("projets/Mon motif v2-"))).toBe(true);
    expect(res.all).toContain("Étape");
    expect(res.all).not.toContain("Projet secret d'un autre");
    expect(res.all).not.toContain("password_hash");
    expect(res.all).not.toContain("scrypt$");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("suppression du compte", () => {
  it("exige mot de passe et confirmation, efface données et fichiers, préserve les autres comptes", async () => {
    const { c, email, user } = await signup(ctx.app);
    const p = (await c.post("/api/projects", { name: "À effacer", design: blank })).json.project;
    const png = fs.readFileSync(new URL("../../../packages/engine/fixtures/motifs/02-fleur.png", import.meta.url));
    const boundary = "----vyra-del";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await c.req("POST", `/api/projects/${p.id}/source`, body, { "content-type": `multipart/form-data; boundary=${boundary}` });
    expect(up.status).toBe(200);
    const { rows: [f] } = await ctx.db.query("SELECT storage_key FROM files WHERE id = $1", [up.json.file.id]);
    expect(fs.existsSync(path.join(ctx.storageDir, f.storage_key))).toBe(true);

    const keeper = await signup(ctx.app);
    const kept = (await keeper.c.post("/api/projects", { name: "Je reste", design: blank })).json.project;

    expect((await c.del("/api/me", { password: PW, confirm: "oui" })).status).toBe(400);
    expect((await c.del("/api/me", { password: "faux", confirm: "SUPPRIMER" })).status).toBe(400);
    const r = await c.del("/api/me", { password: PW, confirm: "SUPPRIMER" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ deleted: true, filesRemoved: 1 });

    expect(fs.existsSync(path.join(ctx.storageDir, f.storage_key))).toBe(false);
    for (const [sql, arg] of [
      ["SELECT count(*)::int n FROM users WHERE id = $1", user.id],
      ["SELECT count(*)::int n FROM projects WHERE owner_id = $1", user.id],
      ["SELECT count(*)::int n FROM files WHERE owner_id = $1", user.id],
      ["SELECT count(*)::int n FROM sessions WHERE user_id = $1", user.id],
      ["SELECT count(*)::int n FROM email_outbox WHERE to_email = $1 AND template <> 'deleted'", email],
      ["SELECT count(*)::int n FROM audit_log WHERE actor_id = $1", user.id],
    ] as const)
      expect((await ctx.db.query(sql, [arg])).rows[0].n, sql).toBe(0);
    expect((await ctx.db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'account.deleted' AND subject = $1", [`user:${user.id}`])).rows[0].n).toBe(1);
    // Seul reste le message de confirmation de suppression, sans aucun lien ni jeton.
    const { rows: left } = await ctx.db.query("SELECT template, body_text FROM email_outbox WHERE to_email = $1", [email]);
    expect(left).toHaveLength(1);
    expect(left[0].template).toBe("deleted");
    expect(left[0].body_text).not.toMatch(/https?:\/\/|token=/);
    expect((await new Client(ctx.app).post("/api/auth/login", { email, password: PW })).status).toBe(401);
    expect((await keeper.c.get(`/api/projects/${kept.id}`)).status).toBe(200);
  });

  it("exige le code de double authentification quand elle est active", async () => {
    const { c } = await signup(ctx.app);
    const secret = (await c.post("/api/me/2fa/setup", { password: PW })).json.secret;
    const step = timeStep();
    await c.post("/api/me/2fa/enable", { code: codeAt(secret, step) });
    const r = await c.del("/api/me", { password: PW, confirm: "SUPPRIMER" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("mfa_required");
    expect((await c.del("/api/me", { password: PW, confirm: "SUPPRIMER", code: codeAt(secret, step + 1) })).status).toBe(200);
  });
});

describe("cookie de session en HTTPS", () => {
  it("porte le préfixe __Host-, Secure, HttpOnly, SameSite=Lax, sans domaine", async () => {
    const { buildApp } = await import("../src/app.js");
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "https://studio.vyra.example", AUTH_RATE_LIMIT: 10_000 } as any);
    const app = await buildApp({ cfg, db: ctx.db });
    await app.inject({ method: "POST", url: "/api/auth/signup", headers: { "x-vyra-client": "web" }, payload: { email: "https@example.com", password: PW, displayName: "H", acceptTerms: true } });
    const token = tokenFrom((await lastEmail(ctx.db, "https@example.com")).body_text);
    const r = await app.inject({ method: "POST", url: "/api/auth/verify-email", headers: { "x-vyra-client": "web" }, payload: { token } });
    const ck = r.cookies.find((c) => c.name === "__Host-vyra_session")!;
    expect(ck).toBeTruthy();
    expect(ck).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
    expect(ck.domain).toBeUndefined();
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `__Host-vyra_session=${ck.value}` } });
    expect(me.json().user.email).toBe("https@example.com");
    await app.close();
  });
});
