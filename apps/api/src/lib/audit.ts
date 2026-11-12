import type { Queryable } from "../db/pool.js";

/** Journal d'audit : actions sensibles (connexion, mot de passe, suppression, publication, paiement). */
export async function audit(
  q: Queryable,
  e: { actorId?: string | null; action: string; subject?: string | null; ip?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await q.query("INSERT INTO audit_log (actor_id, action, subject, ip, details) VALUES ($1,$2,$3,$4,$5)", [
    e.actorId ?? null,
    e.action,
    e.subject ?? null,
    e.ip ?? null,
    JSON.stringify(e.details ?? {}),
  ]);
}
