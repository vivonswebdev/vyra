// Dernier administrateur (socle H4) : contrôle fait par l'API avant toute opération qui retirerait un
// administrateur actif ayant la double authentification (retrait du rôle, désactivation ou réinitialisation de
// la 2FA, suppression du compte). Le verrou est le même que celui des déclencheurs de la base : deux opérations
// simultanées sont traitées l'une après l'autre. La base garantit la règle quoi qu'il arrive ; ce contrôle donne
// un message clair.
//
// Lot H6 : verrou d'une ligne réservée au propriétaire (vyra.admin_guard_lock, migration 014) au lieu d'un
// verrou consultatif que tout rôle pouvait prendre et garder ; le nombre d'administrateurs n'est plus lu.
//
// Lot H5 : sous RLS, vyra_app ne voit que les lignes de l'utilisateur du contexte ; la question est posée à
// vyra.admin_guard_is_last, qui ne répond que pour soi-même ou à un administrateur ayant saisi un TOTP récent.
import type { Tx } from "../db/pool.js";
import { conflict } from "./errors.js";

/** À appeler dans la transaction qui va retirer `userId` des administrateurs actifs avec 2FA. */
export async function assertNotLastAdmin(c: Tx, userId: string) {
  await c.query("SELECT vyra.admin_guard_lock()");
  const { rows } = await c.query("SELECT vyra.admin_guard_is_last($1) AS last", [userId]);
  if (rows[0].last)
    throw conflict("last_admin", "Opération refusée : c'est le dernier administrateur actif avec la double authentification. Nommez d'abord un autre administrateur.");
}
