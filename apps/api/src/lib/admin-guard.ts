// Dernier administrateur (socle H4) : contrôle fait par l'API avant toute opération qui retirerait un
// administrateur actif ayant la double authentification (retrait du rôle, désactivation ou réinitialisation de
// la 2FA, suppression du compte). Le verrou consultatif est le même que celui des déclencheurs de la base
// (migration 011) : deux opérations simultanées sont traitées l'une après l'autre. La base garantit la règle
// quoi qu'il arrive ; ce contrôle donne un message clair.
//
// Lot H5 : sous RLS, vyra_app ne voit que les lignes de l'utilisateur du contexte. L'appartenance de `userId`
// aux administrateurs comptés est donc lue par vyra.admin_guard_counts (012), qui ne répond que pour soi-même
// ou à un administrateur ayant saisi un TOTP récent.
import type { Tx } from "../db/pool.js";
import { conflict } from "./errors.js";

export const ADMIN_GUARD_LOCK = 7279432;

/** À appeler dans la transaction qui va retirer `userId` des administrateurs actifs avec 2FA. */
export async function assertNotLastAdmin(c: Tx, userId: string) {
  await c.query("SELECT pg_advisory_xact_lock($1)", [ADMIN_GUARD_LOCK]);
  const { rows } = await c.query("SELECT vyra.admin_guard_count() AS n, vyra.admin_guard_counts($1) AS self", [userId]);
  if (rows[0].self && rows[0].n <= 1)
    throw conflict("last_admin", "Opération refusée : c'est le dernier administrateur actif avec la double authentification. Nommez d'abord un autre administrateur.");
}
