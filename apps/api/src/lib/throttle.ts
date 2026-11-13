// Verrouillage des connexions par adresse e-mail, indépendant de l'existence du compte.
// Stocké dans PostgreSQL : cohérent entre toutes les instances de l'API.
import crypto from "node:crypto";
import type { Queryable } from "../db/pool.js";

export const LOCK_AFTER = 8;
export const LOCK_MINUTES = 15;
const WINDOW_MINUTES = 15;

const keyFor = (email: string) => crypto.createHash("sha256").update("login:" + email.toLowerCase()).digest();

export async function isLocked(q: Queryable, email: string): Promise<boolean> {
  const { rows } = await q.query("SELECT locked_until FROM auth_throttle WHERE key = $1", [keyFor(email)]);
  return !!rows[0]?.locked_until && new Date(rows[0].locked_until) > new Date();
}

/** Enregistre un échec ; renvoie true si cet échec vient de déclencher le verrouillage. */
export async function recordFailure(q: Queryable, email: string): Promise<boolean> {
  const r = await q.query(
    `INSERT INTO auth_throttle (key, failures, window_start) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN auth_throttle.window_start < now() - make_interval(mins => $3) THEN 1 ELSE auth_throttle.failures + 1 END,
       window_start = CASE WHEN auth_throttle.window_start < now() - make_interval(mins => $3) THEN now() ELSE auth_throttle.window_start END,
       locked_until = CASE
         WHEN (CASE WHEN auth_throttle.window_start < now() - make_interval(mins => $3) THEN 1 ELSE auth_throttle.failures + 1 END) >= $2
         THEN now() + make_interval(mins => $4) ELSE auth_throttle.locked_until END
     RETURNING failures`,
    [keyFor(email), LOCK_AFTER, WINDOW_MINUTES, LOCK_MINUTES],
  );
  return r.rows[0]?.failures === LOCK_AFTER;
}

export async function clearFailures(q: Queryable, email: string): Promise<void> {
  await q.query("DELETE FROM auth_throttle WHERE key = $1", [keyFor(email)]);
}
