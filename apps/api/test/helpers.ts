import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import { createPool, type Db } from "../src/db/pool.js";
import { migrate } from "../src/db/migrations.js";
import { buildApp } from "../src/app.js";

export const TEST_DB = process.env.DATABASE_URL_TEST ?? "postgres://vyra:vyra@127.0.0.1:5432/vyra_test";

export interface Ctx {
  app: FastifyInstance;
  db: Db;
  storageDir: string;
}

/** Base de test remise à zéro, migrations appliquées, application construite. */
export async function setup(overrides: Record<string, unknown> = {}): Promise<Ctx> {
  const db = createPool(TEST_DB);
  await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await migrate(db);
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-test-storage-"));
  const cfg = loadConfig({ NODE_ENV: "test" } as any, {
    DATABASE_URL: TEST_DB,
    STORAGE_DIR: storageDir,
    LOG_LEVEL: "silent",
    PUBLIC_URL: "http://vyra.test",
    AUTH_RATE_LIMIT: 10_000,
    ...overrides,
  } as any);
  const app = await buildApp({ cfg, db });
  await app.ready();
  return { app, db, storageDir };
}

export async function teardown(ctx: Ctx) {
  await ctx.app.close();
  await ctx.db.end();
  fs.rmSync(ctx.storageDir, { recursive: true, force: true });
}

/** Client de test : conserve le cookie de session et envoie l'en-tête anti-CSRF. */
export class Client {
  cookie = "";
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as any,
      url,
      payload: body === undefined ? undefined : (body as any),
      headers: { "x-vyra-client": "web", ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.cookies.find((c) => c.name === "vyra_session");
    if (set) this.cookie = set.value ? `vyra_session=${set.value}` : "";
    let json: any = null;
    try {
      json = res.json();
    } catch {}
    return { status: res.statusCode, json, res };
  }
  get = (url: string) => this.req("GET", url);
  post = (url: string, body?: unknown) => this.req("POST", url, body ?? {});
  patch = (url: string, body?: unknown) => this.req("PATCH", url, body ?? {});
  del = (url: string, body?: unknown) => this.req("DELETE", url, body);
}

/** Inscription complète : demande, lecture du lien reçu par e-mail, confirmation (qui ouvre la session). */
export async function signup(app: FastifyInstance, email = `u${Math.random().toString(36).slice(2, 8)}@example.com`) {
  const c = new Client(app);
  const r = await c.post("/api/auth/signup", { email, password: "un-mot-de-passe-solide", displayName: "Testeur", acceptTerms: true });
  if (r.status !== 202) throw new Error("signup " + r.status + " " + JSON.stringify(r.json));
  const db = (app as any).db as Db;
  const { rows } = await db.query("SELECT body_text FROM email_outbox WHERE to_email = $1 AND template = 'verify' ORDER BY id DESC LIMIT 1", [email]);
  const v = await c.post("/api/auth/verify-email", { token: tokenFrom(rows[0].body_text) });
  if (v.status !== 200 || !v.json.user) throw new Error("verify " + v.status + " " + JSON.stringify(v.json));
  return { c, user: v.json.user, email };
}

export async function lastEmail(db: Db, to: string) {
  const { rows } = await db.query("SELECT * FROM email_outbox WHERE to_email = $1 ORDER BY id DESC LIMIT 1", [to]);
  return rows[0];
}

export const tokenFrom = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? "";
