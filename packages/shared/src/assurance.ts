// Niveau de confiance exigé pour les opérations sensibles du personnel (socle H4, document 21 §1).
// Trois notions distinctes : la double authentification ACTIVÉE sur le compte ; le NIVEAU de la session
// (mot de passe seul, ou second facteur vérifié) et la FRAÎCHEUR de cette vérification ; le RÔLE. La session
// reste valable sa durée normale ; seule la fraîcheur expire, et une nouvelle saisie du code la renouvelle.
// L'API est seule autorité ; les interfaces s'en servent pour proposer la nouvelle saisie au bon moment.

export type AuthLevel = "password" | "mfa";
export type MfaVia = "totp" | "recovery";

export interface SessionAssurance {
  roles: readonly string[];
  /** Double authentification activée sur le compte. */
  mfaEnabled: boolean;
  authLevel: AuthLevel;
  /** Dernière vérification du second facteur dans cette session. */
  mfaAt: Date | null;
  mfaVia: MfaVia | null;
}

export const STAFF_OPERATIONS = {
  /** Attribution et retrait des rôles du personnel, réinitialisation de la 2FA d'un autre administrateur. */
  roles: { role: "admin", maxAgeMin: 15, totpOnly: true },
  /** Modération du Market. */
  moderation: { role: "moderator", maxAgeMin: 60, totpOnly: false },
  /** Remboursements, versements, commissions. */
  finance: { role: "admin", maxAgeMin: 5, totpOnly: true },
} as const;
export type StaffOperation = keyof typeof STAFF_OPERATIONS;

export type AssuranceDecision =
  | { ok: true }
  | { ok: false; reason: "role_required" | "mfa_required" | "mfa_step_up_required"; maxAgeMin?: number };

/**
 * Décide si la session peut effectuer l'opération. « mfa_required » : la double authentification n'est pas
 * activée sur le compte ; « mfa_step_up_required » : elle l'est, mais la session n'a pas de vérification
 * assez récente (ou seulement par code de secours quand un TOTP est exigé).
 */
export function checkAssurance(s: SessionAssurance, op: StaffOperation, now: Date = new Date()): AssuranceDecision {
  const rule = STAFF_OPERATIONS[op];
  const hasStaffRole = s.roles.includes(rule.role) || s.roles.includes("admin");
  if (!hasStaffRole) return { ok: false, reason: "role_required" };
  if (!s.mfaEnabled) return { ok: false, reason: "mfa_required" };
  const fresh = s.authLevel === "mfa" && s.mfaAt != null && now.getTime() - s.mfaAt.getTime() <= rule.maxAgeMin * 60_000 && s.mfaAt.getTime() <= now.getTime() + 60_000;
  const viaOk = !rule.totpOnly || s.mfaVia === "totp";
  if (!fresh || !viaOk) return { ok: false, reason: "mfa_step_up_required", maxAgeMin: rule.maxAgeMin };
  return { ok: true };
}
