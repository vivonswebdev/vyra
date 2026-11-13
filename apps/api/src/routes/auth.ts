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
import { badRequest, HttpError, unauthorized } from "../lib/errors.js";
import { clearFailures, isLocked, recordFailure } from "../lib/throttle.js";
import { queueEmail, queueSecurityAlert } from "../lib/mailer.js";
import { audit } from "../lib/audit.js";
import { toSessionUser, USER_COLUMNS } from "../plugins/auth.js";
import { SecretBox } from "../lib/secretbox.js";
import { checkSecondFactor } from "./account.js";
import { z } from "zod";


export default async function authRoutes(app: FastifyInstance) {
  const { db, cfg } = app;
  const strict = { config: { rateLimit: { max: cfg.AUTH_RATE_LIMIT, timeWindow: "1 minute" } } };

  const box = new SecretBox(cfg.secretKey);
  const link = (path: string, token: string) => `${cfg.PUBLIC_URL}${path}?token=${encodeURIComponent(token)}`;

  async function loadUser(id: string) {
    const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
    return toSessionUser(rows[0]);
  }

  // Inscription : même réponse que l'adresse soit libre ou déjà utilisée (aucune énumération).
  // Le compte n'est utilisable qu'après confirmation de l'adresse ; le lien reçu ouvre la session.
  app.post("/api/auth/signup", strict, async (req, reply) => {
    const input = SignupInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    await tx(db, async (c) => {
      const { rows: found } = await c.query("SELECT id, display_name, locale, email_verified_at FROM users WHERE email = $1 FOR UPDATE", [input.email]);
      const existing = found[0];
      if (existing?.email_verified_at) {
        // Avis au propriétaire, au plus un par heure.
        await queueEmail(c, input.email, "exists", existing.locale, { name: existing.display_name, link: `${cfg.PUBLIC_URL}/studio/login` }, {
          dedupeKey: `exists:${existing.id}:${new Date().toISOString().slice(0, 13)}`,
        });
        await audit(c, { actorId: existing.id, action: "account.signup_existing", subject: `user:${existing.id}`, ip: req.ip });
        return;
      }
      let id: string;
      if (existing) {
        // Compte jamais confirmé : on remplace le mot de passe et on renvoie un lien (le premier lien devient caduc).
        id = existing.id;
        await c.query("UPDATE users SET password_hash = $2, display_name = $3, locale = $4, updated_at = now() WHERE id = $1", [id, passwordHash, input.displayName, input.locale]);
        await c.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'verify_email' AND used_at IS NULL", [id]);
      } else {
        const { rows } = await c.query("INSERT INTO users (email, password_hash, display_name, locale) VALUES ($1,$2,$3,$4) RETURNING id", [
          input.email,
          passwordHash,
          input.displayName,
          input.locale,
        ]);
        id = rows[0].id;
      }
      const { token, hash } = newToken();
      await c.query("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'verify_email', now() + interval '48 hours')", [hash, id]);
      await queueEmail(c, input.email, "verify", input.locale, { name: input.displayName, link: link("/account/verify", token) });
      await audit(c, { actorId: id, action: "account.signup", subject: `user:${id}`, ip: req.ip });
    });
    reply.code(202);
    return { status: "verification_sent" };
  });

  // Connexion : réponses identiques pour une adresse inconnue et un mauvais mot de passe ; le
  // verrouillage (par adresse, partagé entre instances) s'applique aussi aux adresses inconnues.
  app.post("/api/auth/login", strict, async (req, reply) => {
    const input = LoginInput.parse(req.body);
    if (await isLocked(db, input.email)) throw new HttpError(429, "too_many_attempts", "Trop de tentatives pour cette adresse. Réessayez dans 15 minutes ou réinitialisez votre mot de passe.");
    const { rows } = await db.query("SELECT id, password_hash, status, totp_enabled_at, email_verified_at, display_name, locale FROM users WHERE email = $1", [input.email]);
    const u = rows[0];
    const ok = await verifyPassword(input.password, u?.password_hash ?? (await dummyHash()));
    if (!u || !ok) {
      const justLocked = await recordFailure(db, input.email);
      if (u) await audit(db, { actorId: u.id, action: "account.login_failed", subject: `user:${u.id}`, ip: req.ip });
      if (u && justLocked) await queueSecurityAlert(db, cfg, { id: u.id, email: input.email, displayName: u.display_name, locale: u.locale }, "login_locked");
      throw new HttpError(401, "invalid_credentials", "Adresse e-mail ou mot de passe incorrect.");
    }
    // À partir d'ici le mot de passe est prouvé : les réponses peuvent être précises.
    await clearFailures(db, input.email);
    if (u.status !== "active") throw new HttpError(403, "account_suspended", "Ce compte est suspendu.");
    if (!u.email_verified_at) {
      const { token, hash } = newToken();
      const fresh = await db.query(
        "SELECT 1 FROM auth_tokens WHERE user_id = $1 AND purpose = 'verify_email' AND used_at IS NULL AND created_at > now() - interval '5 minutes'",
        [u.id],
      );
      if (!fresh.rowCount) {
        await db.query("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'verify_email', now() + interval '48 hours')", [hash, u.id]);
        await queueEmail(db, input.email, "verify", u.locale, { name: u.display_name, link: link("/account/verify", token) });
      }
      throw new HttpError(403, "email_unverified", "Confirmez d'abord votre adresse e-mail : un nouveau lien vient de vous être envoyé.");
    }
    if (u.totp_enabled_at) {
      // Deuxième étape : aucune session n'est ouverte tant que le code n'est pas vérifié.
      const { token, hash } = newToken();
      await db.query("INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')", [hash, u.id]);
      return { mfaRequired: true, mfaToken: token };
    }
    await app.startSession(reply, req, u.id);
    await audit(db, { actorId: u.id, action: "account.login", subject: `user:${u.id}`, ip: req.ip });
    return { user: await loadUser(u.id) };
  });

  app.post("/api/auth/login/mfa", strict, async (req, reply) => {
    const input = z
      .object({ mfaToken: z.string().min(20).max(200), code: z.string().trim().optional(), recoveryCode: z.string().trim().optional() })
      .parse(req.body);
    const hash = tokenHash(input.mfaToken);
    const { rows } = await db.query(
      "UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = $1 AND expires_at > now() RETURNING user_id, attempts",
      [hash],
    );
    const ch = rows[0];
    if (!ch || ch.attempts > 5) {
      await db.query("DELETE FROM mfa_challenges WHERE token_hash = $1", [hash]);
      throw unauthorized("mfa_expired", "Étape de vérification expirée. Reconnectez-vous.");
    }
    const ok = await checkSecondFactor(db, box, ch.user_id, { code: input.code || undefined, recoveryCode: input.recoveryCode || undefined });
    if (!ok) {
      await audit(db, { actorId: ch.user_id, action: "account.mfa_failed", subject: `user:${ch.user_id}`, ip: req.ip });
      throw unauthorized("wrong_code", "Code incorrect.");
    }
    await db.query("DELETE FROM mfa_challenges WHERE token_hash = $1", [hash]);
    await app.startSession(reply, req, ch.user_id);
    if (input.recoveryCode) {
      const mu = await loadUser(ch.user_id);
      await queueSecurityAlert(db, cfg, mu, "recovery_used");
    }
    await audit(db, { actorId: ch.user_id, action: "account.login", subject: `user:${ch.user_id}`, ip: req.ip, details: { mfa: input.recoveryCode ? "recovery" : "totp" } });
    return { user: await loadUser(ch.user_id) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await app.endSession(reply, req);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => ({ user: req.user }));

  app.post("/api/auth/verify-email", strict, async (req, reply) => {
    const { token } = VerifyEmailInput.parse(req.body);
    const userId = await tx(db, async (c) => {
      const { rows } = await c.query(
        `UPDATE auth_tokens SET used_at = now()
          WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [tokenHash(token)],
      );
      if (!rows[0]) throw badRequest("verify_link_invalid", "Lien invalide ou expiré. Demandez un nouveau lien depuis votre profil.");
      await c.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [rows[0].user_id]);
      await audit(c, { actorId: rows[0].user_id, action: "account.email_verified", subject: `user:${rows[0].user_id}`, ip: req.ip });
      return rows[0].user_id as string;
    });
    // Le lien prouve la possession de l'adresse : il ouvre la session, sauf si la 2FA est active.
    const { rows: mfa } = await db.query("SELECT totp_enabled_at FROM users WHERE id = $1", [userId]);
    if (mfa[0].totp_enabled_at) return { user: null, loginRequired: true };
    if (req.user?.id !== userId) await app.startSession(reply, req, userId);
    return { user: await loadUser(userId) };
  });

  // Renvoi du lien sans session : réponse identique que l'adresse existe ou non.
  app.post("/api/auth/resend-verification-email", strict, async (req) => {
    const { email } = ForgotPasswordInput.parse(req.body);
    await tx(db, async (c) => {
      const { rows } = await c.query("SELECT id, display_name, locale FROM users WHERE email = $1 AND email_verified_at IS NULL AND status = 'active'", [email]);
      const u = rows[0];
      if (!u) return;
      const { token, hash } = newToken();
      const queued = await queueEmail(c, email, "verify", u.locale, { name: u.display_name, link: link("/account/verify", token) }, {
        dedupeKey: `resend:${u.id}:${Math.floor(Date.now() / 300_000)}`,
      });
      if (queued) await c.query("INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'verify_email', now() + interval '48 hours')", [hash, u.id]);
    });
    return { ok: true };
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
      if (!rows[0]) throw badRequest("reset_link_invalid", "Lien invalide ou expiré. Refaites une demande de réinitialisation.");
      const id = rows[0].user_id as string;
      // Le lien reçu par e-mail prouve aussi la possession de l'adresse.
      await c.query(
        `UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL,
           email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`,
        [id, passwordHash],
      );
      await c.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      await audit(c, { actorId: id, action: "account.password_reset", subject: `user:${id}`, ip: req.ip });
      const { rows: ur } = await c.query("SELECT email, display_name, locale FROM users WHERE id = $1", [id]);
      await queueSecurityAlert(c, cfg, { id, email: ur[0].email, displayName: ur[0].display_name, locale: ur[0].locale }, "password_changed");
      // Avec la double authentification, l'accès à la boîte e-mail ne suffit pas : connexion complète exigée.
      const mfa = await c.query("SELECT totp_enabled_at FROM users WHERE id = $1", [id]);
      if (mfa.rows[0].totp_enabled_at) return { id, loginRequired: true };
      await app.startSession(reply, req, id, c);
      return { id, loginRequired: false };
    });
    if (userId.loginRequired) return { user: null, loginRequired: true };
    return { user: await loadUser(userId.id) };
  });

  app.post("/api/auth/change-password", strict, async (req, reply) => {
    const u = app.requireUser(req);
    const input = ChangePasswordInput.parse(req.body);
    const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [u.id]);
    if (!(await verifyPassword(input.currentPassword, rows[0].password_hash))) throw badRequest("wrong_current_password", "Mot de passe actuel incorrect.");
    const passwordHash = await hashPassword(input.newPassword);
    await tx(db, async (c) => {
      await c.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [u.id, passwordHash]);
      // Toutes les autres sessions sont fermées ; une nouvelle est ouverte ici.
      await c.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      await audit(c, { actorId: u.id, action: "account.password_changed", subject: `user:${u.id}`, ip: req.ip });
      await queueSecurityAlert(c, cfg, u, "password_changed");
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
}
