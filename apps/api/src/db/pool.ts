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
  // Lot H6 : une connexion inactive coupée par le serveur (redémarrage, bascule, délai) émet une erreur sur le
  // pool ; sans écouteur, Node arrêterait tout le processus. Le pool retire de lui-même la connexion fautive.
  pool.on("error", (err) => console.error(`Connexion PostgreSQL inactive perdue : ${err.message}`));
  return pool;
}

/**
 * Transaction sur une connexion empruntée au pool : BEGIN, `prepare` (contexte éventuel), fn, COMMIT ; ROLLBACK
 * sur toute erreur. Lot H6 : une coupure de la connexion pendant la transaction (serveur redémarré, délai
 * idle_in_transaction dépassé, pg_terminate_backend) est captée ici au lieu d'arrêter le processus, et la
 * connexion est détruite au lieu d'être rendue au pool (test P-LEAK-2).
 */
async function transaction<T>(db: Db, prepare: ((client: Tx) => Promise<void>) | null, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let broken: Error | undefined;
  const onError = (err: Error) => (broken = err);
  client.on("error", onError);
  try {
    await client.query("BEGIN");
    if (prepare) await prepare(client);
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    if (!broken) await client.query("ROLLBACK").catch((err) => (broken = err));
    throw e;
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

/** Exécute fn dans une transaction ; annule en cas d'erreur. */
export function tx<T>(db: Db, fn: (client: Tx) => Promise<T>): Promise<T> {
  return transaction(db, null, fn);
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

export function withUser<T>(db: Db, ctx: UserContext, fn: (client: Tx) => Promise<T>): Promise<T> {
  return transaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `SELECT vyra.ctx_user()::text AS uid
           FROM (SELECT set_config('vyra.user_id', $1, true) AS a, set_config('vyra.session', $2, true) AS b) AS ctx`,
        [ctx.userId, ctx.sessionHash ? ctx.sessionHash.toString("hex") : ""],
      );
      if (rows[0]?.uid !== ctx.userId) throw unauthorized("session_expired", "Session expirée ou révoquée. Reconnectez-vous.");
    },
    fn,
  );
}

/** Requêtes isolées faites pour l'utilisateur : chacune dans sa propre transaction, avec le contexte. */
export function userQueryable(db: Db, ctx: UserContext): Queryable {
  return { query: ((text: string, values?: unknown[]) => withUser(db, ctx, (c) => c.query(text, values as any[]))) as Queryable["query"] };
}
