// Market LOT 1 : profil professionnel (création, modification, demande de vérification), profils publics,
// et back-office (examen des profils, attribution des rôles). Chaque route passe par la matrice `can()` de
// @vyra/shared ; les contrôles de propriété s'ajoutent ici. Toute décision est historisée et journalisée.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ACTIONS,
  can,
  MODERATION_DECISIONS,
  ModerationDecisionInput,
  SellerProfileInput,
  type Action,
  type Actor,
  type DenyReason,
  type PublicSellerDTO,
  type SellerProfileDTO,
  type SellerStatus,
} from "@vyra/shared";
import { tx, type Queryable } from "../db/pool.js";
import { audit } from "../lib/audit.js";
import { conflict, HttpError, notFound } from "../lib/errors.js";

const DENY_MESSAGES: Record<DenyReason, string> = {
  login_required: "Connexion requise.",
  email_unverified: "Confirmez d'abord votre adresse e-mail.",
  mfa_required: "Activez la double authentification pour cette action.",
  role_required: "Accès réservé.",
  seller_profile_required: "Créez d'abord votre profil professionnel.",
  seller_profile_exists: "Vous avez déjà un profil professionnel.",
  seller_not_verified: "Votre profil professionnel doit d'abord être vérifié.",
  seller_suspended: "Votre profil professionnel est suspendu.",
};

export function denyError(reason: DenyReason): HttpError {
  if (reason === "login_required") return new HttpError(401, "unauthorized", DENY_MESSAGES[reason], undefined, reason);
  return new HttpError(403, "forbidden", DENY_MESSAGES[reason], undefined, reason);
}

/** Champs dont la modification sur un profil vérifié impose un nouvel examen. */
const MATERIAL_FIELDS = ["slug", "displayName", "kind", "isBusiness", "country"] as const;

function toDTO(r: Record<string, any>): SellerProfileDTO {
  return {
    userId: r.user_id,
    slug: r.slug,
    displayName: r.display_name,
    kind: r.kind,
    isBusiness: r.is_business,
    country: r.country,
    languages: r.languages,
    bio: r.bio,
    status: r.status,
    statusReason: r.status_reason,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

async function setStatus(q: Queryable, userId: string, from: SellerStatus | null, to: SellerStatus, actorId: string, reason = "") {
  await q.query(
    `UPDATE seller_profiles SET status = $2, status_reason = NULLIF($3, ''), updated_at = now(),
       submitted_at = CASE WHEN $2 = 'pending_review' THEN now() ELSE submitted_at END,
       reviewed_by = CASE WHEN $4::uuid <> user_id THEN $4::uuid ELSE reviewed_by END,
       reviewed_at = CASE WHEN $4::uuid <> user_id THEN now() ELSE reviewed_at END
     WHERE user_id = $1`,
    [userId, to, reason, actorId],
  );
  await q.query("INSERT INTO seller_status_events (user_id, from_status, to_status, reason, actor_id) VALUES ($1,$2,$3,$4,$5)", [userId, from, to, reason, actorId]);
}

export default async function marketRoutes(app: FastifyInstance) {
  const { db } = app;

  const actorOf = async (req: FastifyRequest): Promise<Actor | null> => {
    const u = req.user;
    if (!u) return null;
    const { rows } = await db.query("SELECT status FROM seller_profiles WHERE user_id = $1", [u.id]);
    return { id: u.id, roles: u.roles, emailVerified: u.emailVerified, mfaEnabled: u.mfaEnabled, sellerStatus: rows[0]?.status ?? null };
  };
  const guard = async (req: FastifyRequest, action: Action): Promise<Actor> => {
    const a = await actorOf(req);
    const d = can(a, action);
    if (!d.ok) throw denyError(d.reason);
    return a!;
  };
  const isSlugTaken = (e: unknown) => (e as { code?: string; constraint?: string }).code === "23505";

  // ---------------------------------------------------------------- Mon profil professionnel

  app.get("/api/market/me/seller", async (req) => {
    const u = app.requireUser(req);
    const actor = (await actorOf(req))!;
    const { rows } = await db.query("SELECT * FROM seller_profiles WHERE user_id = $1", [u.id]);
    // Ce que l'interface peut proposer ; le serveur revérifie à chaque action.
    const permissions = Object.fromEntries(ACTIONS.map((a) => [a, can(actor, a)]));
    return { profile: rows[0] ? toDTO(rows[0]) : null, permissions };
  });

  app.post("/api/market/me/seller", async (req, reply) => {
    const actor = await guard(req, "seller.profile.create");
    const input = SellerProfileInput.parse(req.body);
    try {
      const profile = await tx(db, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO seller_profiles (user_id, slug, display_name, kind, is_business, country, languages, bio)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [actor.id, input.slug, input.displayName, input.kind, input.isBusiness, input.country, input.languages, input.bio],
        );
        await c.query("INSERT INTO seller_status_events (user_id, from_status, to_status, actor_id) VALUES ($1, NULL, 'draft', $1)", [actor.id]);
        await c.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, 'seller', $1) ON CONFLICT DO NOTHING", [actor.id]);
        await audit(c, { actorId: actor.id, action: "seller.profile_created", subject: actor.id, ip: req.ip, details: { slug: input.slug, kind: input.kind } });
        return rows[0];
      });
      reply.code(201);
      return { profile: toDTO(profile) };
    } catch (e) {
      if (isSlugTaken(e)) throw conflict("slug_taken", "Cette adresse de profil est déjà prise.");
      throw e;
    }
  });

  app.patch("/api/market/me/seller", async (req) => {
    const actor = await guard(req, "seller.profile.edit");
    const input = SellerProfileInput.partial().parse(req.body);
    try {
      const profile = await tx(db, async (c) => {
        const cur = (await c.query("SELECT * FROM seller_profiles WHERE user_id = $1 FOR UPDATE", [actor.id])).rows[0];
        const before = toDTO(cur);
        const next = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as SellerProfileDTO;
        await c.query(
          `UPDATE seller_profiles SET slug = $2, display_name = $3, kind = $4, is_business = $5, country = $6, languages = $7, bio = $8, updated_at = now()
           WHERE user_id = $1`,
          [actor.id, next.slug, next.displayName, next.kind, next.isBusiness, next.country, next.languages, next.bio],
        );
        const material = MATERIAL_FIELDS.filter((k) => next[k] !== before[k]);
        // Un profil vérifié dont l'identité change repasse en examen : il n'est plus public entre-temps.
        if (before.status === "verified" && material.length) await setStatus(c, actor.id, "verified", "pending_review", actor.id, "Modification de : " + material.join(", "));
        await audit(c, { actorId: actor.id, action: "seller.profile_updated", subject: actor.id, ip: req.ip, details: { fields: Object.keys(input), material } });
        return (await c.query("SELECT * FROM seller_profiles WHERE user_id = $1", [actor.id])).rows[0];
      });
      return { profile: toDTO(profile) };
    } catch (e) {
      if (isSlugTaken(e)) throw conflict("slug_taken", "Cette adresse de profil est déjà prise.");
      throw e;
    }
  });

  app.post("/api/market/me/seller/submit", async (req) => {
    const actor = await guard(req, "seller.profile.submit");
    const profile = await tx(db, async (c) => {
      const cur = (await c.query("SELECT status FROM seller_profiles WHERE user_id = $1 FOR UPDATE", [actor.id])).rows[0];
      if (cur.status !== "draft" && cur.status !== "rejected") throw conflict("invalid_transition", "Ce profil ne peut pas être soumis dans son état actuel.");
      await setStatus(c, actor.id, cur.status, "pending_review", actor.id);
      await audit(c, { actorId: actor.id, action: "seller.profile_submitted", subject: actor.id, ip: req.ip });
      return (await c.query("SELECT * FROM seller_profiles WHERE user_id = $1", [actor.id])).rows[0];
    });
    return { profile: toDTO(profile) };
  });

  // ---------------------------------------------------------------- Profils publics

  app.get("/api/market/sellers/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string().max(60) }).parse(req.params);
    const { rows } = await db.query(
      `SELECT p.*, u.created_at AS member_since FROM seller_profiles p JOIN users u ON u.id = p.user_id
       WHERE p.slug = lower($1) AND p.status = 'verified' AND u.status = 'active'`,
      [slug],
    );
    if (!rows[0]) throw notFound("seller_not_found", "Profil introuvable.");
    const r = rows[0];
    const seller: PublicSellerDTO = {
      slug: r.slug,
      displayName: r.display_name,
      kind: r.kind,
      isBusiness: r.is_business,
      country: r.country,
      languages: r.languages,
      bio: r.bio,
      memberSince: new Date(r.member_since).toISOString().slice(0, 7),
    };
    return { seller };
  });

  // ---------------------------------------------------------------- Back-office : examen des profils

  app.get("/api/admin/sellers", async (req) => {
    await guard(req, "moderation.sellers.review");
    const { status } = z.object({ status: z.enum(["draft", "pending_review", "verified", "rejected", "suspended"]).default("pending_review") }).parse(req.query);
    const { rows } = await db.query(
      `SELECT p.*, u.email FROM seller_profiles p JOIN users u ON u.id = p.user_id WHERE p.status = $1
       ORDER BY p.submitted_at NULLS LAST, p.created_at LIMIT 200`,
      [status],
    );
    return { sellers: rows.map((r) => ({ ...toDTO(r), email: r.email, submittedAt: r.submitted_at && new Date(r.submitted_at).toISOString() })) };
  });

  app.get("/api/admin/sellers/:userId", async (req) => {
    await guard(req, "moderation.sellers.review");
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const { rows } = await db.query("SELECT p.*, u.email FROM seller_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1", [userId]);
    if (!rows[0]) throw notFound("seller_not_found", "Profil introuvable.");
    const events = (await db.query("SELECT from_status, to_status, reason, actor_id, created_at FROM seller_status_events WHERE user_id = $1 ORDER BY id", [userId])).rows;
    return { profile: { ...toDTO(rows[0]), email: rows[0].email }, events };
  });

  app.post("/api/admin/sellers/:userId/decision", async (req) => {
    const actor = await guard(req, "moderation.sellers.review");
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const { decision, reason } = ModerationDecisionInput.parse(req.body);
    // Personne ne statue sur son propre profil.
    if (userId === actor.id) throw new HttpError(403, "forbidden", "Vous ne pouvez pas examiner votre propre profil.", undefined, "self_review");
    const rule = MODERATION_DECISIONS[decision];
    const profile = await tx(db, async (c) => {
      const cur = (await c.query("SELECT status FROM seller_profiles WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
      if (!cur) throw notFound("seller_not_found", "Profil introuvable.");
      if (!(rule.from as readonly string[]).includes(cur.status)) throw conflict("invalid_transition", "Décision impossible dans l'état actuel du profil.");
      await setStatus(c, userId, cur.status, rule.to, actor.id, reason);
      await audit(c, { actorId: actor.id, action: "seller.status_changed", subject: userId, ip: req.ip, details: { from: cur.status, to: rule.to, decision, reason } });
      return (await c.query("SELECT * FROM seller_profiles WHERE user_id = $1", [userId])).rows[0];
    });
    return { profile: toDTO(profile) };
  });

  // ---------------------------------------------------------------- Back-office : rôles du personnel

  app.post("/api/admin/users/:userId/roles", async (req) => {
    const actor = await guard(req, "admin.roles.manage");
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const { role, grant } = z.object({ role: z.enum(["moderator", "admin"]), grant: z.boolean() }).parse(req.body);
    // Pas de modification de ses propres rôles : évite l'auto-promotion et la perte du dernier administrateur.
    if (userId === actor.id) throw new HttpError(403, "forbidden", "Vous ne pouvez pas modifier vos propres rôles.", undefined, "self_role_change");
    await tx(db, async (c) => {
      const u = (await c.query("SELECT id FROM users WHERE id = $1 AND status = 'active'", [userId])).rows[0];
      if (!u) throw notFound("user_not_found", "Compte introuvable.");
      if (grant) await c.query("INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [userId, role, actor.id]);
      else await c.query("DELETE FROM user_roles WHERE user_id = $1 AND role = $2", [userId, role]);
      await audit(c, { actorId: actor.id, action: grant ? "role.granted" : "role.revoked", subject: userId, ip: req.ip, details: { role } });
    });
    const { rows } = await db.query("SELECT COALESCE(array_agg(role ORDER BY role), '{}') AS roles FROM user_roles WHERE user_id = $1", [userId]);
    return { roles: rows[0].roles };
  });
}
