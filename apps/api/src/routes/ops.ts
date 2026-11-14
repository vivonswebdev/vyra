// Exploitation : vivacité (/api/health), disponibilité détaillée (/api/ready), métriques Prometheus
// (/api/metrics, protégées par jeton). Aucune donnée personnelle ni secret n'est exposé.
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { migrationStatus } from "../db/migrations.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), path.basename(path.dirname(fileURLToPath(import.meta.url))) === "routes" ? "../db/migrations" : "migrations");

export default async function opsRoutes(app: FastifyInstance) {
  const { db, cfg } = app;
  const started = Date.now();
  const counters = { requests: new Map<string, number>(), durationSum: 0, durationCount: 0 };

  app.addHook("onResponse", async (req, reply) => {
    const cls = `${Math.floor(reply.statusCode / 100)}xx`;
    counters.requests.set(cls, (counters.requests.get(cls) ?? 0) + 1);
    counters.durationSum += reply.elapsedTime / 1000;
    counters.durationCount++;
  });

  // Vivacité : le processus répond (sans dépendre des services externes).
  app.get("/api/health", async () => ({ ok: true, service: "vyra-api", version: "0.3.1", uptimeS: Math.round((Date.now() - started) / 1000) }));

  // Disponibilité : chaque dépendance est vérifiée ; 503 si l'une manque.
  app.get("/api/ready", async (_req, reply) => {
    const checks: Record<string, { ok: boolean; detail?: string; ms?: number }> = {};
    const run = async (name: string, fn: () => Promise<string | void>) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        checks[name] = { ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) };
      } catch (e) {
        checks[name] = { ok: false, ms: Date.now() - t0, detail: String((e as Error).message ?? e).slice(0, 160) };
      }
    };
    await run("database", async () => void (await db.query("SELECT 1")));
    await run("migrations", async () => {
      // Lecture seule : registre comparé aux fichiers (en attente, modifiées, orphelines).
      const s = await migrationStatus(db, { dir: MIGRATIONS_DIR });
      if (s.pending.length || s.modified.length || s.orphans.length)
        throw new Error(`${s.applied.length} appliquée(s) ; en attente : ${s.pending.length}, modifiée(s) : ${s.modified.length}, orpheline(s) : ${s.orphans.length}`);
      return `${s.applied.length} appliquée(s)`;
    });
    await run("storage", async () => {
      const key = `sante/${crypto.randomUUID()}.bin`;
      const probe = crypto.randomBytes(16);
      await app.storage.put(key, probe);
      const back = await app.storage.get(key);
      await app.storage.delete(key);
      if (!back.equals(probe)) throw new Error("relecture différente");
    });
    await run("engine", async () => void (await app.engine.run("spin", { ms: 1 })));
    if (cfg.FILE_SCAN === "clamd")
      await run("antivirus", async () => {
        if (!(await app.scanner.ping())) throw new Error(`${app.scanner.engine} injoignable`);
      });
    await run("email_outbox", async () => {
      const { rows } = await db.query(
        "SELECT count(*) FILTER (WHERE sent_at IS NULL AND attempts >= 5)::int AS failed, EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE sent_at IS NULL AND attempts < 5))::int AS oldest FROM email_outbox",
      );
      if (rows[0].failed > 0) throw new Error(`${rows[0].failed} e-mail(s) en échec définitif`);
      if (cfg.MAIL_TRANSPORT !== "outbox" && (rows[0].oldest ?? 0) > 900) throw new Error(`e-mail en attente depuis ${rows[0].oldest} s`);
    });
    const ok = Object.values(checks).every((c) => c.ok);
    reply.code(ok ? 200 : 503);
    return { ok, checks };
  });

  // Métriques au format Prometheus : désactivées sans METRICS_TOKEN.
  app.get("/api/metrics", async (req, reply) => {
    if (!cfg.METRICS_TOKEN) return reply.code(404).send({ error: { code: "not_found", message: "Introuvable." } });
    const auth = String(req.headers.authorization ?? "");
    const expected = `Bearer ${cfg.METRICS_TOKEN}`;
    if (auth.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return reply.code(401).send();
    const q = async (sql: string) => (await db.query(sql)).rows;
    const outbox = (await q("SELECT count(*) FILTER (WHERE sent_at IS NULL AND attempts < 5)::int p, count(*) FILTER (WHERE sent_at IS NULL AND attempts >= 5)::int f FROM email_outbox"))[0];
    const scans = await q("SELECT scan_status s, count(*)::int n FROM files WHERE deleted_at IS NULL GROUP BY 1");
    const lines = [
      "# HELP vyra_http_requests_total Requêtes HTTP par classe de statut.",
      "# TYPE vyra_http_requests_total counter",
      ...[...counters.requests].map(([k, v]) => `vyra_http_requests_total{status="${k}"} ${v}`),
      "# TYPE vyra_http_request_duration_seconds summary",
      `vyra_http_request_duration_seconds_sum ${counters.durationSum.toFixed(3)}`,
      `vyra_http_request_duration_seconds_count ${counters.durationCount}`,
      "# TYPE vyra_engine_tasks_total counter",
      ...Object.entries(app.engine.stats).map(([k, v]) => `vyra_engine_tasks_total{result="${k}"} ${v}`),
      "# TYPE vyra_email_outbox gauge",
      `vyra_email_outbox{state="pending"} ${outbox.p}`,
      `vyra_email_outbox{state="failed"} ${outbox.f}`,
      "# TYPE vyra_files gauge",
      ...scans.map((r) => `vyra_files{scan_status="${r.s}"} ${r.n}`),
      "# TYPE vyra_process_resident_memory_bytes gauge",
      `vyra_process_resident_memory_bytes ${process.memoryUsage().rss}`,
      "# TYPE vyra_uptime_seconds gauge",
      `vyra_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`,
    ];
    reply.type("text/plain; version=0.0.4");
    return lines.join("\n") + "\n";
  });
}
