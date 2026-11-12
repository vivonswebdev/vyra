// Comptes : inscription, connexion, déconnexion, vérification d'e-mail,
// mot de passe oublié / réinitialisation, changement de mot de passe, profil et préférences.
import type { FastifyInstance } from "fastify";
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SignupInput,
  UpdateProfileInput,
  VerifyEmailInput,
} from "@vyra/shared";
import { tx } from "../db/pool.js";
import { dummyHash, hashPassword, newToken, tokenHash, verifyPassword } from "../lib/crypto.js";
import { badRequest, conflict, HttpError, unauthorized } from "../lib/errors.js";
import { queueEmail } from "../lib/mailer.js";
import { audit } from "../lib/audit.js";
import { toSessionUser, USER_COLUMNS } from "../plugins/auth.js";

const LOCK_AFTER = 8; // échecs consécutifs
const LOCK_MINUTES = 15;

export default async function authRoutes(app: FastifyInstance) {
  const { db, cfg } = app;
  const strict = { config: { rateLimit: { max: cfg.AUTH_RATE_LIMIT, timeWindow: "1 minute" } } };

  const link = (path: string, token: string) => `${cfg.PUBLIC_URL}${path}?token=${encodeURIComponent(token)}`;

  async function loadUser(id: string) {
    const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
    return toSessionUser(rows[0]);
  }

  app.post("/api/auth/signup", strict, async (req, reply) => {
    const input = SignupInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const userId = await tx(db, async (c) => {
      const exists = await c.query("SELECT 1 FROM users WHERE email = $1", [input.email]);
      if (exists.rowCount) throw conflict("Un compte existe déjà avec cette adresse. Connectez-vous ou réinitialisez votre mot de passe.");
      const { rows } = await c.query(
        "INSERT INTO users (email, password_hash, display_name, locale) VALUES ($1,$2,$3,$4) RETURNING id",
        [input.email, passwordHash, input.displayName, input.locale],
      );
      const id = rows[0].id as string;
      const { token, hash } = newToken();
      await c.query(
        "INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'verify_email', now() + interval '48 hours')",
        [hash, id],
      );
      await queueEmail(c, input.email, "verify", input.locale, { name: input.displayName, link: link("/account/verify", token) });
      await audit(c, { actorId: id, action: "account.signup", subject: `user:${id}`, ip: req.ip });
      await app.startSession(reply, req, id, c);
      return id;
    });
    reply.code(201);
    return { user: await loadUser(userId) };
  });

  app.post("/api/auth/login", strict, async (req, reply) => {
    const input = LoginInput.parse(req.body);
    const { rows } = await db.query(
      "SELECT id, password_hash, status, locked_until FROM users WHERE email = $1",
      [input.email],
    );
    const u = rows[0];
    if (!u) {
      await verifyPassword(input.password, await dummyHash());
      throw unauthorized("Adresse e-mail ou mot de passe incorrect.");
    }
    if (u.locked_until && new Date(u.locked_until) > new Date())
      throw new HttpError(429, "locked", "Trop de tentatives. Réessayez dans quelques minutes ou réinitialisez votre mot de passe.");
    const ok = await verifyPassword(input.password, u.password_hash);
    if (!ok || u.status !== "active") {
      await db.query(
        `UPDATE users SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`,
        [u.id, LOCK_AFTER, LOCK_MINUTES],
      );
      await audit(db, { actorId: u.id, action: "account.login_failed", subject: `user:${u.id}`, ip: req.ip });
      throw unauthorized(u.status === "active" ? "Adresse e-mail ou mot de passe incorrect." : "Ce compte est suspendu.");
    }
    await db.query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [u.id]);
    await app.startSession(reply, req, u.id);
    await audit(db, { actorId: u.id, action: "account.login", subject: `user:${u.id}`, ip: req.ip });
    return { user: await loadUser(u.id) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await app.endSession(reply, req);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({ user: req.user }));

  app.post("/api/auth/verify-email", strict, async (req) => {
    const { token } = VerifyEmailInput.parse(req.body);
    const userId = await tx(db, async (c) => {
      const { rows } = await c.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [tokenHash(token)],
      );
      if (!rows[0]) throw badRequest("Lien invalide ou expiré. Demandez un nouveau lien depuis votre profil.");
      await c.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [rows[0].user_id]);
      await audit(c, { actorId: rows[0].user_id, action: "account.email_verified", subject: `user:${rows[0].user_id}`, ip: req.ip });
      return rows[0].user_id as string;
    });
    return { user: await loadUser(userId) };
  });

  app.post("/api/auth/resend-verification", strict, async (req) => {
    const u = app.requireUser(req);
    if (u.emailVerified) return { ok: true, alreadyVerified: true };
    await tx(db, async (c) => {
      const { token, hash } = newToken();
      await c.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'verify_email' AND used_at IS NULL", [u.id]);
      await c.query(
        "INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'verify_email', now() + interval '48 hours')",
        [hash, u.id],
      );
      await queueEmail(c, u.email, "verify", u.locale, { name: u.displayName, link: link("/account/verify", token) });
    });
    return { ok: true };
  });

  // Réponse identique que le compte existe ou non (pas d'énumération des adresses).
  app.post("/api/auth/forgot-password", strict, async (req) => {
    const { email } = ForgotPasswordInput.parse(req.body);
    await tx(db, async (c) => {
      const { rows } = await c.query("SELECT id, display_name, locale FROM users WHERE email = $1 AND status = 'active'", [email]);
      const u = rows[0];
      if (!u) return;
      const { token, hash } = newToken();
      await c.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [u.id]);
      await c.query(
        "INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'reset_password', now() + interval '1 hour')",
        [hash, u.id],
      );
      await queueEmail(c, email, "reset", u.locale, { name: u.display_name, link: link("/account/reset", token) });
      await audit(c, { actorId: u.id, action: "account.reset_requested", subject: `user:${u.id}`, ip: req.ip });
    });
    return { ok: true };
  });

  app.post("/api/auth/reset-password", strict, async (req, reply) => {
    const input = ResetPasswordInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const userId = await tx(db, async (c) => {
      const { rows } = await c.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [tokenHash(input.token)],
      );
      if (!rows[0]) throw badRequest("Lien invalide ou expiré. Refaites une demande de réinitialisation.");
      const id = rows[0].user_id as string;
      // Le lien reçu par e-mail prouve aussi la possession de l'adresse.
      await c.query(
        `UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL,
           email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`,
        [id, passwordHash],
      );
      await c.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      await audit(c, { actorId: id, action: "account.password_reset", subject: `user:${id}`, ip: req.ip });
      await app.startSession(reply, req, id, c);
      return id;
    });
    return { user: await loadUser(userId) };
  });

  app.post("/api/auth/change-password", strict, async (req, reply) => {
    const u = app.requireUser(req);
    const input = ChangePasswordInput.parse(req.body);
    const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [u.id]);
    if (!(await verifyPassword(input.currentPassword, rows[0].password_hash))) throw badRequest("Mot de passe actuel incorrect.");
    const passwordHash = await hashPassword(input.newPassword);
    await tx(db, async (c) => {
      await c.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [u.id, passwordHash]);
      // Toutes les autres sessions sont fermées ; une nouvelle est ouverte ici.
      await c.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      await audit(c, { actorId: u.id, action: "account.password_changed", subject: `user:${u.id}`, ip: req.ip });
      await app.startSession(reply, req, u.id, c);
    });
    return { ok: true };
  });

  app.patch("/api/me", async (req) => {
    const u = app.requireUser(req);
    const input = UpdateProfileInput.parse(req.body);
    await db.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         locale = COALESCE($3, locale),
         theme = COALESCE($4, theme),
         preferences = preferences || COALESCE($5::jsonb, '{}'::jsonb),
         updated_at = now()
       WHERE id = $1`,
      [u.id, input.displayName ?? null, input.locale ?? null, input.theme ?? null, input.preferences ? JSON.stringify(input.preferences) : null],
    );
    return { user: await loadUser(u.id) };
  });

  app.get("/api/me/sessions", async (req) => {
    const u = app.requireUser(req);
    const { rows } = await db.query(
      "SELECT created_at, last_seen_at, expires_at, ip, user_agent, token_hash = $2 AS current FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC",
      [u.id, req.sessionHash],
    );
    return { sessions: rows };
  });

  app.post("/api/me/sessions/revoke-others", async (req) => {
    const u = app.requireUser(req);
    const r = await db.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [u.id, req.sessionHash]);
    await audit(db, { actorId: u.id, action: "account.sessions_revoked", subject: `user:${u.id}`, ip: req.ip, details: { count: r.rowCount } });
    return { revoked: r.rowCount };
  });
}
