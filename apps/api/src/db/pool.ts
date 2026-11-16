import pg from "pg";
import { unauthorized } from "../lib/errors.js";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = Pick<pg.Pool, "query">;

/**
 * Chemin de recherche imposé à chaque connexion (lot H2) : les requêtes, non qualifiées, se résolvent dans le
 * schéma vyra, puis dans public pendant la transition (base antérieure à 008_core_schema_vyra). Il ne dépend ni
 * du réglage des rôles ni de celui de la base.
 */
export const SEARCH_PATH = "vyra, public";

export function createPool(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, options: `-c search_path=${SEARCH_PATH.replace(" ", "")}` });
  return pool;
}

/** Exécute fn dans une transaction ; annule en cas d'erreur. */
export async function tx<T>(db: Db, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Contexte utilisateur transactionnel (lots H3 et H5) : l'identifiant de l'utilisateur et l'empreinte de sa
 * session sont posés par set_config(…, true), donc limités à la transaction ; ils disparaissent au COMMIT ou au
 * ROLLBACK et ne passent jamais d'une requête à l'autre par le pool. C'est le SEUL endroit du code qui pose ce
 * contexte (test U-CTX-1).
 *
 * Lot H5 : les politiques RLS ne retiennent l'utilisateur que si vyra.ctx_user() le confirme (session non
 * expirée de cet utilisateur, compte actif, avec cette empreinte). La confirmation est demandée dans la même
 * instruction que la pose du contexte : si la session vient d'être révoquée ou le compte suspendu, la requête
 * échoue tout de suite (401) au lieu de ne voir silencieusement aucune ligne.
 */
export interface UserContext {
  userId: string;
  sessionHash: Buffer | null;
}

export async function withUser<T>(db: Db, ctx: UserContext, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT vyra.ctx_user()::text AS uid
         FROM (SELECT set_config('vyra.user_id', $1, true) AS a, set_config('vyra.session', $2, true) AS b) AS ctx`,
      [ctx.userId, ctx.sessionHash ? ctx.sessionHash.toString("hex") : ""],
    );
    if (rows[0]?.uid !== ctx.userId) throw unauthorized("session_expired", "Session expirée ou révoquée. Reconnectez-vous.");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    // Une connexion dont l'annulation échoue n'est pas rendue au pool : elle est détruite.
    await client.query("ROLLBACK").catch((err) => (broken = err));
    throw e;
  } finally {
    client.release(broken);
  }
}

/** Requêtes isolées faites pour l'utilisateur : chacune dans sa propre transaction, avec le contexte. */
export function userQueryable(db: Db, ctx: UserContext): Queryable {
  return { query: ((text: string, values?: unknown[]) => withUser(db, ctx, (c) => c.query(text, values as any[]))) as Queryable["query"] };
}
