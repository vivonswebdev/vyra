// Montants en centimes (entiers) : jamais de flottants pour l'argent.
export type Currency = "EUR";

export interface Money {
  amountCents: number;
  currency: Currency;
}

export function formatMoney(m: Money, locale = "fr-BE"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency }).format(m.amountCents / 100);
}

/**
 * Commission en points de base (1 % = 100 pb), arrondie au centime inférieur en faveur du vendeur.
 * Les taux viennent de la configuration (table commission_rules), jamais du code.
 */
export function commissionCents(amountCents: number, basisPoints: number, fixedCents = 0): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error("montant invalide");
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new Error("taux invalide");
  return Math.min(amountCents, Math.floor((amountCents * basisPoints) / 10_000) + fixedCents);
}
