// Permissions de la plateforme (Market LOT 1). Une seule matrice, utilisée par l'API (seule autorité) et par
// les interfaces (pour masquer ce qui n'est pas permis). Chaque refus porte une raison stable, traduite côté
// interface (clés « apierr.<raison> »).
import { hasRole, type Role } from "./roles.js";

export const SELLER_KINDS = [
  "independent_embroiderer",
  "workshop",
  "pattern_designer",
  "digitizer",
  "file_creator",
  "influencer",
  "brand",
  "textile_company",
] as const;
export type SellerKind = (typeof SELLER_KINDS)[number];

/** Cycle du profil professionnel : brouillon → en examen → vérifié (ou refusé) ; suspendu par la modération. */
export const SELLER_STATUSES = ["draft", "pending_review", "verified", "rejected", "suspended"] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

export const ACTIONS = [
  "market.browse", // consulter le catalogue et les profils publics
  "market.buy", // acheter, demander un devis, écrire à un vendeur
  "seller.profile.create",
  "seller.profile.edit",
  "seller.profile.submit", // demander la vérification
  "seller.listing.publish", // publier une annonce ou une offre (lots 3-4)
  "seller.payout.manage", // versements (lot 8)
  "backoffice.access",
  "moderation.sellers.review",
  "moderation.content",
  "admin.roles.manage",
  "admin.finance",
] as const;
export type Action = (typeof ACTIONS)[number];

export const DENY_REASONS = [
  "login_required",
  "email_unverified",
  "mfa_required",
  "role_required",
  "seller_profile_required",
  "seller_profile_exists",
  "seller_not_verified",
  "seller_suspended",
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

export interface Actor {
  id: string;
  roles: readonly string[];
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** Statut du profil professionnel, null s'il n'en a pas. */
  sellerStatus: SellerStatus | null;
}

export type Decision = { ok: true } | { ok: false; reason: DenyReason };
const allow: Decision = { ok: true };
const deny = (reason: DenyReason): Decision => ({ ok: false, reason });

/**
 * Décision pour une action, indépendante de la ressource. Les contrôles de propriété (ce profil, cette commande)
 * s'ajoutent dans chaque route.
 */
export function can(actor: Actor | null, action: Action): Decision {
  if (action === "market.browse") return allow;
  if (!actor) return deny("login_required");
  if (!actor.emailVerified) return deny("email_unverified");
  const staff = (role: Role): Decision => (!hasRole(actor.roles, role) ? deny("role_required") : !actor.mfaEnabled ? deny("mfa_required") : allow);
  switch (action) {
    case "market.buy":
      return allow;
    case "seller.profile.create":
      return actor.sellerStatus ? deny("seller_profile_exists") : allow;
    case "seller.profile.edit":
    case "seller.profile.submit":
      if (!actor.sellerStatus) return deny("seller_profile_required");
      if (actor.sellerStatus === "suspended") return deny("seller_suspended");
      // La vérification et tout ce qui touche à la vente exigent la double authentification.
      return action === "seller.profile.submit" && !actor.mfaEnabled ? deny("mfa_required") : allow;
    case "seller.listing.publish":
    case "seller.payout.manage":
      if (!actor.sellerStatus) return deny("seller_profile_required");
      if (actor.sellerStatus === "suspended") return deny("seller_suspended");
      if (actor.sellerStatus !== "verified") return deny("seller_not_verified");
      return actor.mfaEnabled ? allow : deny("mfa_required");
    case "backoffice.access":
    case "moderation.sellers.review":
    case "moderation.content":
      return staff("moderator");
    case "admin.roles.manage":
    case "admin.finance":
      return staff("admin");
  }
}

/** Transitions de statut permises à la modération (le vendeur ne fait que « soumettre »). */
export const MODERATION_DECISIONS = {
  verify: { from: ["pending_review"], to: "verified" },
  reject: { from: ["pending_review"], to: "rejected" },
  suspend: { from: ["draft", "pending_review", "verified", "rejected"], to: "suspended" },
  reinstate: { from: ["suspended"], to: "pending_review" }, // réexamen avant toute nouvelle publication
} as const satisfies Record<string, { from: readonly SellerStatus[]; to: SellerStatus }>;
export type ModerationDecision = keyof typeof MODERATION_DECISIONS;
