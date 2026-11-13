// Matrice de permissions du Market : chaque action, chaque profil d'acteur, une raison de refus stable.
import { describe, expect, it } from "vitest";
import { ACTIONS, can, MODERATION_DECISIONS, SELLER_STATUSES, type Actor } from "../src/permissions.js";
import { ModerationDecisionInput, SellerProfileInput } from "../src/market.js";

const base: Actor = { id: "u1", roles: [], emailVerified: true, mfaEnabled: false, sellerStatus: null };
const who = (over: Partial<Actor>): Actor => ({ ...base, ...over });
const reason = (a: Actor | null, action: (typeof ACTIONS)[number]) => {
  const d = can(a, action);
  return d.ok ? "ok" : d.reason;
};

describe("matrice de permissions", () => {
  it("visiteur : consulter seulement", () => {
    for (const a of ACTIONS) expect(reason(null, a), a).toBe(a === "market.browse" ? "ok" : "login_required");
  });

  it("adresse non confirmée : rien d'autre que consulter", () => {
    for (const a of ACTIONS) expect(reason(who({ emailVerified: false }), a), a).toBe(a === "market.browse" ? "ok" : "email_unverified");
  });

  it("acheteur : acheter, ouvrir un profil, rien de professionnel", () => {
    const b = who({});
    expect(reason(b, "market.buy")).toBe("ok");
    expect(reason(b, "seller.profile.create")).toBe("ok");
    expect(reason(b, "seller.profile.edit")).toBe("seller_profile_required");
    expect(reason(b, "seller.listing.publish")).toBe("seller_profile_required");
    expect(reason(b, "backoffice.access")).toBe("role_required");
    expect(reason(b, "admin.roles.manage")).toBe("role_required");
  });

  it("vendeur : publier exige un profil vérifié et la double authentification", () => {
    expect(reason(who({ sellerStatus: "draft" }), "seller.profile.create")).toBe("seller_profile_exists");
    expect(reason(who({ sellerStatus: "draft" }), "seller.profile.edit")).toBe("ok");
    expect(reason(who({ sellerStatus: "draft" }), "seller.profile.submit")).toBe("mfa_required");
    expect(reason(who({ sellerStatus: "draft", mfaEnabled: true }), "seller.profile.submit")).toBe("ok");
    for (const s of ["draft", "pending_review", "rejected"] as const)
      expect(reason(who({ sellerStatus: s, mfaEnabled: true }), "seller.listing.publish"), s).toBe("seller_not_verified");
    expect(reason(who({ sellerStatus: "verified" }), "seller.listing.publish")).toBe("mfa_required");
    expect(reason(who({ sellerStatus: "verified", mfaEnabled: true }), "seller.listing.publish")).toBe("ok");
    expect(reason(who({ sellerStatus: "verified", mfaEnabled: true }), "seller.payout.manage")).toBe("ok");
  });

  it("vendeur suspendu : plus de modification, de soumission ni de vente", () => {
    const s = who({ sellerStatus: "suspended", mfaEnabled: true });
    for (const a of ["seller.profile.edit", "seller.profile.submit", "seller.listing.publish", "seller.payout.manage"] as const) expect(reason(s, a), a).toBe("seller_suspended");
    expect(reason(s, "market.buy")).toBe("ok"); // il reste acheteur
  });

  it("personnel : rôle ET double authentification ; le rôle vendeur ne donne aucun accès au back-office", () => {
    expect(reason(who({ roles: ["seller"], sellerStatus: "verified", mfaEnabled: true }), "backoffice.access")).toBe("role_required");
    expect(reason(who({ roles: ["moderator"] }), "moderation.sellers.review")).toBe("mfa_required");
    expect(reason(who({ roles: ["moderator"], mfaEnabled: true }), "moderation.sellers.review")).toBe("ok");
    expect(reason(who({ roles: ["moderator"], mfaEnabled: true }), "admin.roles.manage")).toBe("role_required");
    expect(reason(who({ roles: ["admin"], mfaEnabled: true }), "admin.roles.manage")).toBe("ok");
    expect(reason(who({ roles: ["admin"], mfaEnabled: true }), "moderation.content")).toBe("ok"); // admin inclut modérateur
    expect(reason(who({ roles: ["admin"] }), "admin.finance")).toBe("mfa_required");
  });

  it("chaque action et chaque statut donnent une décision (aucun cas oublié)", () => {
    for (const a of ACTIONS)
      for (const s of [null, ...SELLER_STATUSES])
        for (const roles of [[], ["moderator"], ["admin"]])
          for (const mfaEnabled of [false, true]) expect(can(who({ sellerStatus: s, roles, mfaEnabled }), a)).toHaveProperty("ok");
  });

  it("transitions de modération : uniquement depuis les statuts prévus", () => {
    expect(MODERATION_DECISIONS.verify.from).toEqual(["pending_review"]);
    expect(MODERATION_DECISIONS.reinstate.to).toBe("pending_review");
    expect(ModerationDecisionInput.safeParse({ decision: "reject", reason: "court" }).success).toBe(false);
    expect(ModerationDecisionInput.safeParse({ decision: "reject", reason: "Portfolio sans lien avec la broderie." }).success).toBe(true);
    expect(ModerationDecisionInput.safeParse({ decision: "verify" }).success).toBe(true);
  });

  it("adresse de profil : format et noms réservés", () => {
    const p = { displayName: "Atelier Lin", kind: "workshop", isBusiness: true, country: "be" };
    expect(SellerProfileInput.parse({ ...p, slug: "Atelier-Lin" })).toMatchObject({ slug: "atelier-lin", country: "BE" });
    for (const slug of ["ab", "-atelier", "atelier-", "ate--lier", "admin", "vyra", "a".repeat(41), "atelier_lin"]) expect(SellerProfileInput.safeParse({ ...p, slug }).success, slug).toBe(false);
    expect(SellerProfileInput.safeParse({ ...p, slug: "ok-123", kind: "pirate" }).success).toBe(false);
  });
});
