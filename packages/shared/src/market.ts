// Contrats du Market (LOT 1) : profil professionnel et décisions de modération.
import { z } from "zod";
import { LANGS } from "./contracts.js";
import { MODERATION_DECISIONS, SELLER_KINDS, type SellerKind, type SellerStatus } from "./permissions.js";

/** Adresse publique du profil : minuscules, chiffres, tirets, 3 à 40 caractères. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
/** Adresses réservées : pages de la plateforme ou noms trompeurs. */
export const RESERVED_SLUGS = ["admin", "api", "studio", "market", "vyra", "support", "help", "aide", "moderation", "official", "officiel", "staff", "login", "signup", "account", "compte"];

export const SellerProfileInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, { error: "Adresse invalide : lettres minuscules, chiffres et tirets, 3 à 40 caractères." })
    .refine((s) => !RESERVED_SLUGS.includes(s) && !s.includes("--"), { error: "Adresse réservée." }),
  displayName: z.string().trim().min(2).max(80),
  kind: z.enum(SELLER_KINDS),
  /** Professionnel (entreprise, indépendant immatriculé) ou particulier : obligations différentes. */
  isBusiness: z.boolean(),
  /** Code pays ISO 3166-1 alpha-2. */
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  languages: z.array(z.enum(LANGS)).max(4).default([]),
  bio: z.string().trim().max(4000).default(""),
});
export type SellerProfileInput = z.infer<typeof SellerProfileInput>;

export const ModerationDecisionInput = z
  .object({
    decision: z.enum(Object.keys(MODERATION_DECISIONS) as [keyof typeof MODERATION_DECISIONS, ...(keyof typeof MODERATION_DECISIONS)[]]),
    /** Motivation communiquée au vendeur : obligatoire pour un refus ou une suspension. */
    reason: z.string().trim().max(2000).default(""),
  })
  .refine((x) => !(x.decision === "reject" || x.decision === "suspend") || x.reason.length >= 10, { error: "Motivation requise (10 caractères au moins).", path: ["reason"] });

export interface SellerProfileDTO {
  userId: string;
  slug: string;
  displayName: string;
  kind: SellerKind;
  isBusiness: boolean;
  country: string;
  languages: string[];
  bio: string;
  status: SellerStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Profil public : seulement les champs destinés aux visiteurs, et seulement s'il est vérifié. */
export interface PublicSellerDTO {
  slug: string;
  displayName: string;
  kind: SellerKind;
  isBusiness: boolean;
  country: string;
  languages: string[];
  bio: string;
  memberSince: string;
}
