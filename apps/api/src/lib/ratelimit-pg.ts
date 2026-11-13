// Stockage PostgreSQL pour @fastify/rate-limit : les compteurs sont partagés par toutes les instances
// de l'API (une seule requête atomique par appel). Table UNLOGGED : compteurs éphémères, perte
// acceptable en cas d'arrêt brutal de la base.
import type { Db } from "../db/pool.js";

type Cb = (err: Error | null, res: { current: number; ttl: number } | null) => void;

const INCR = `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2::float8 / 1000))
  ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
    reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => $2::float8 / 1000) ELSE rate_limits.reset_at END
  RETURNING count, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (reset_at - now())) * 1000))::bigint AS ttl`;

export function pgRateLimitStore(db: Db, namespace = "") {
  return class PgRateLimitStore {
    constructor(
      _params: unknown,
      private prefix = namespace + "g:",
    ) {}

    incr(key: string, cb: Cb, timeWindow: number) {
      db.query(INCR, [this.prefix + key, timeWindow]).then(
        (r) => cb(null, { current: r.rows[0].count, ttl: Number(r.rows[0].ttl) }),
        (e) => cb(e, null),
      );
    }

    read(key: string, cb: Cb) {
      db.query("SELECT count, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (reset_at - now())) * 1000))::bigint AS ttl FROM rate_limits WHERE key = $1 AND reset_at > now()", [
        this.prefix + key,
      ]).then(
        (r) => cb(null, r.rows[0] ? { current: r.rows[0].count, ttl: Number(r.rows[0].ttl) } : { current: 0, ttl: 0 }),
        (e) => cb(e, null),
      );
    }

    child(routeOptions: { routeInfo: { method: string; url: string } }) {
      return new PgRateLimitStore(routeOptions, `${this.prefix}${routeOptions.routeInfo.method}${routeOptions.routeInfo.url}-`);
    }
  };
}
