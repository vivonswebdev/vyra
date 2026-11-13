import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrationStatus } from "../src/db/migrations.js";
import { setup, teardown, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const appWith = (over: Record<string, unknown> = {}) =>
  buildApp({
    cfg: loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: "unused", STORAGE_DIR: ctx.storageDir, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", ...over } as any),
    db: ctx.db,
  });

describe("exploitation", () => {
  it("vivacité et disponibilité détaillée", async () => {
    expect((await ctx.app.inject({ url: "/api/health" })).json()).toMatchObject({ ok: true, service: "vyra-api" });
    const r = await ctx.app.inject({ url: "/api/ready" });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json().checks)).toEqual(["database", "migrations", "storage", "engine", "email_outbox"]);
    expect(r.json().checks.migrations.detail).toMatch(/5 appliquée/);
  });

  it("disponibilité en échec si l'antivirus est injoignable ou un e-mail est en échec définitif", async () => {
    const app = await appWith({ FILE_SCAN: "clamd", CLAMD_PORT: 1, CLAMD_TIMEOUT_MS: 300 });
    const r = await app.inject({ url: "/api/ready" });
    expect(r.statusCode).toBe(503);
    expect(r.json().checks.antivirus.ok).toBe(false);
    await app.close();
    await ctx.db.query("INSERT INTO email_outbox (to_email, template, subject, body_text, attempts) VALUES ('x@example.com','verify','s','b',5)");
    const r2 = await ctx.app.inject({ url: "/api/ready" });
    expect(r2.statusCode).toBe(503);
    expect(r2.json().checks.email_outbox.detail).toMatch(/échec définitif/);
    await ctx.db.query("DELETE FROM email_outbox");
  });

  it("métriques : absentes sans jeton, refusées avec un mauvais jeton, lisibles avec le bon", async () => {
    expect((await ctx.app.inject({ url: "/api/metrics" })).statusCode).toBe(404);
    const token = "jeton-de-metriques-de-test-123456";
    const app = await appWith({ METRICS_TOKEN: token });
    await app.inject({ url: "/api/health" });
    expect((await app.inject({ url: "/api/metrics", headers: { authorization: "Bearer mauvais" } })).statusCode).toBe(401);
    const r = await app.inject({ url: "/api/metrics", headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/vyra_http_requests_total\{status="2xx"\} \d+/);
    expect(r.body).toContain('vyra_engine_tasks_total{result="timeouts"}');
    expect(r.body).toContain('vyra_email_outbox{state="pending"}');
    expect(r.body).not.toMatch(/@|password|token/i);
    await app.close();
  });

  it("identifiant de requête : repris du proxy s'il est sûr, sinon généré, toujours renvoyé", async () => {
    const a = await ctx.app.inject({ url: "/api/health", headers: { "x-request-id": "proxy-1234-abcd" } });
    expect(a.headers["x-request-id"]).toBe("proxy-1234-abcd");
    const b = await ctx.app.inject({ url: "/api/health", headers: { "x-request-id": "<script>x</script>" } });
    expect(b.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const c = await ctx.app.inject({ url: "/api/health" });
    expect(c.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("état des migrations : tout appliqué, rien de modifié", async () => {
    const s = await migrationStatus(ctx.db);
    expect(s.pending).toEqual([]);
    expect(s.modified).toEqual([]);
    expect(s.applied).toHaveLength(5);
  });
});
