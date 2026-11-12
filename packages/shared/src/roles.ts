// Rôles de la plateforme. Tout compte est client (acheteur) et créateur (Studio).
// « seller » s'obtient en ouvrant une boutique ; « moderator » et « admin » sont attribués.
export const ROLES = ["seller", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function hasRole(roles: readonly string[], role: Role): boolean {
  return roles.includes(role) || roles.includes("admin");
}
