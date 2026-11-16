import pg from "pg";

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
 * Contexte utilisateur transactionnel (lot H3) : l'identifiant de l'utilisateur et l'empreinte de sa session
 * sont posés par set_config(…, true), donc limités à la transaction ; ils disparaissent au COMMIT ou au
 * ROLLBACK et ne passent jamais d'une requête à l'autre par le pool. Au lot H5, les politiques RLS les
 * vérifient (fonction vyra.ctx_user) ; d'ici là, ils sont posés mais pas encore exigés.
 */
export interface UserContext {
  userId: string;
  sessionHash: Buffer | null;
}

export async function withUser<T>(db: Db, ctx: UserContext, fn: (client: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('vyra.user_id', $1, true), set_config('vyra.session', $2, true)", [
      ctx.userId,
      ctx.sessionHash ? ctx.sessionHash.toString("hex") : "",
    ]);
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

/** Requêtes isolées faites pour l'utilisateur : chacune dans sa propre transaction, avec le contexte. */
export function userQueryable(db: Db, ctx: UserContext): Queryable {
  return { query: ((text: string, values?: unknown[]) => withUser(db, ctx, (c) => c.query(text, values as any[]))) as Queryable["query"] };
}
