// Administration du socle (lot H4) : rôles du personnel et récupération de la double authentification d'un
// autre administrateur. Réservé aux administrateurs ayant saisi un code TOTP depuis moins de 15 minutes
// (document 21 §1) ; tout est journalisé. Ces routes agissent sur vyra_app, dans le contexte de l'administrateur.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROLES } from "@vyra/shared";
import { audit } from "../lib/audit.js";
import { assertNotLastAdmin } from "../lib/admin-guard.js";
import { badRequest, notFound } from "../lib/errors.js";
import { queueSecurityAlert } from "../lib/mailer.js";

export default async function adminRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: app.cfg.AUTH_RATE_LIMIT, timeWindow: "1 minute" } } };

  // Recherche d'un compte par adresse exacte (pas de liste de tous les comptes).
  app.get("/api/admin/users", async (req) => {
    app.requireStaff(req, "roles");
    const { email } = z.object({ email: z.email().transform((e) => e.toLowerCase()) }).parse(req.query);
    const { rows } = await app.asUser(req).query(
      `SELECT u.id, u.email, u.display_name, u.status, u.totp_enabled_at IS NOT NULL AS mfa,
              COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles r WHERE r.user_id = u.id), '{}') AS roles
         FROM users u WHERE u.email = $1`,
      [email],
    );
    if (!rows[0]) throw notFound("user_not_found", "Aucun compte avec cette adresse.");
    const r = rows[0];
    return { user: { id: r.id, email: r.email, displayName: r.display_name, status: r.status, mfaEnabled: r.mfa, roles: r.roles } };
  });

  app.post("/api/admin/users/:id/roles", strict, async (req) => {
    const actor = app.requireStaff(req, "roles");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = z.object({ role: z.enum(ROLES), grant: z.boolean() }).parse(req.body);
    const roles = await app.withUser(req, async (c) => {
      const t = await c.query("SELECT id FROM users WHERE id = $1 AND status = 'active'", [id]);
      if (!t.rows[0]) throw notFound("user_not_found", "Compte introuvable ou inactif.");
      if (input.grant) {
        await c.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, input.role, actor.id]);
      } else {
        if (input.role === "admin") await assertNotLastAdmin(c, id);
        await c.query("DELETE FROM user_roles WHERE user_id = $1 AND role = $2", [id, input.role]);
      }
      await audit(c, { actorId: actor.id, action: input.grant ? "admin.role_granted" : "admin.role_revoked", subject: `user:${id}`, ip: req.ip, details: { role: input.role } });
      const r = await c.query("SELECT COALESCE(array_agg(role ORDER BY role), '{}') AS roles FROM user_roles WHERE user_id = $1", [id]);
      return r.rows[0].roles as string[];
    });
    return { roles };
  });

  // Récupération, cas 2 (document 21 §1) : un administrateur a perdu tous ses facteurs ; un autre administrateur
  // réinitialise sa double authentification. L'intéressé est prévenu par e-mail et déconnecté partout ; il devra
  // l'activer de nouveau avant toute opération sur les rôles.
  app.post("/api/admin/users/:id/2fa/reset", strict, async (req) => {
    const actor = app.requireStaff(req, "roles");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    if (id === actor.id) throw badRequest("own_mfa_reset", "Pour votre propre compte, utilisez les réglages de sécurité.");
    await app.withUser(req, async (c) => {
      const t = await c.query("SELECT id, email, display_name, locale, totp_enabled_at FROM users WHERE id = $1", [id]);
      const u = t.rows[0];
      if (!u) throw notFound("user_not_found", "Compte introuvable.");
      if (!u.totp_enabled_at) throw badRequest("mfa_not_enabled", "La double authentification n'est pas activée sur ce compte.");
      await assertNotLastAdmin(c, id);
      await c.query("UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1", [id]);
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [id]);
      await c.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      await audit(c, { actorId: actor.id, action: "admin.mfa_reset", subject: `user:${id}`, ip: req.ip });
      await queueSecurityAlert(c, app.cfg, { id, email: u.email, displayName: u.display_name, locale: u.locale }, "2fa_reset_by_admin");
    });
    return { ok: true };
  });
}
