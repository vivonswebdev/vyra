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
