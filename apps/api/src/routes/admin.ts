// Administration du socle (lot H4) : rôles du personnel et récupération de la double authentification d'un
// autre administrateur. Réservé aux administrateurs ayant saisi un code TOTP depuis moins de 15 minutes
// (document 21 §1) ; tout est journalisé. Ces routes agissent sur vyra_app, dans le contexte de l'administrateur.
// Lot H5 : sous RLS, vyra_app ne voit que les lignes de l'utilisateur du contexte ; les comptes des autres ne
// sont lus et modifiés que par les fonctions vyra.admin_* (012), qui vérifient de nouveau, en base, le rôle et la
// fraîcheur du TOTP, et ne renvoient jamais d'empreinte de mot de passe, de secret ni d'empreinte de session.
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
    const { rows } = await app.asUser(req).query("SELECT id, email, display_name, status, mfa, roles FROM vyra.admin_find_user($1)", [email]);
    if (!rows[0]) throw notFound("user_not_found", "Aucun compte avec cette adresse.");
    const r = rows[0];
    return { user: { id: r.id, email: r.email, displayName: r.display_name, status: r.status, mfaEnabled: r.mfa, roles: r.roles } };
  });

  app.post("/api/admin/users/:id/roles", strict, async (req) => {
    const actor = app.requireStaff(req, "roles");
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const input = z.object({ role: z.enum(ROLES), grant: z.boolean() }).parse(req.body);
    const roles = await app.withUser(req, async (c) => {
      if (!input.grant && input.role === "admin") await assertNotLastAdmin(c, id);
      const r = await c.query("SELECT vyra.admin_set_role($1, $2, $3) AS roles", [id, input.role, input.grant]);
      if (r.rows[0].roles == null) throw notFound("user_not_found", "Compte introuvable ou inactif.");
      await audit(c, { actorId: actor.id, action: input.grant ? "admin.role_granted" : "admin.role_revoked", subject: `user:${id}`, ip: req.ip, details: { role: input.role } });
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
      await assertNotLastAdmin(c, id);
      // Facteurs effacés, codes de secours supprimés, sessions fermées : en une fois, par la fonction d'administration.
      const { rows } = await c.query("SELECT status, email, display_name, locale FROM vyra.admin_reset_mfa($1)", [id]);
      const u = rows[0];
      if (u.status === "not_found") throw notFound("user_not_found", "Compte introuvable.");
      if (u.status === "not_enabled") throw badRequest("mfa_not_enabled", "La double authentification n'est pas activée sur ce compte.");
      if (u.status === "self") throw badRequest("own_mfa_reset", "Pour votre propre compte, utilisez les réglages de sécurité.");
      await audit(c, { actorId: actor.id, action: "admin.mfa_reset", subject: `user:${id}`, ip: req.ip });
      await queueSecurityAlert(c, app.cfg, { id, email: u.email, displayName: u.display_name, locale: u.locale }, "2fa_reset_by_admin");
    });
    return { ok: true };
  });
}
