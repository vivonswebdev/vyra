import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import { createPool, type Db } from "../src/db/pool.js";
import { migrate } from "../src/db/migrations.js";
import { buildApp } from "../src/app.js";

export const TEST_DB = process.env.DATABASE_URL_TEST ?? "postgres://vyra:vyra@127.0.0.1:5432/vyra_test";
const ROLES_SQL = path.resolve(__dirname, "../../../scripts/db/roles.sql");
export const SETUP_SQL = path.resolve(__dirname, "../../../scripts/db/database-setup.sql");

export interface Ctx {
  app: FastifyInstance;
  /** Connexion d'administration du test (superutilisateur) : préparation et contrôles directs. */
  db: Db;
  /** Connexion de l'application testée : rôle vyra_app (SET ROLE), avec ses seuls droits. */
  appDb: Db;
  /** Lot H3 : connexions vyra_system et vyra_worker de l'application testée. */
  sysDb: Db;
  workerDb: Db;
  /** Les trois connexions, à passer telles quelles à buildApp. */
  pools: { db: Db; sys: Db; worker: Db };
  storageDir: string;
}

/** Connexion directe sous un rôle de connexion VYRA : mot de passe aléatoire posé pour ce test (instance locale). */
export async function roleUrl(role: string, url = TEST_DB): Promise<string> {
  const pw = crypto.randomBytes(16).toString("hex");
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`ALTER ROLE ${role} PASSWORD '${pw}'`);
  } finally {
    await admin.end();
  }
  const u = new URL(url);
  u.username = role;
  u.password = pw;
  return u.toString();
}

let rolesReady = false;
/** Les sept rôles (globaux à l'instance de test) : les migrations leur accordent des droits (009). */
export async function ensureRoles(db: Pick<Db, "query">) {
  if (rolesReady) return;
  await db.query(fs.readFileSync(ROLES_SQL, "utf8"));
  rolesReady = true;
}

/**
 * Pool de l'application sous le rôle vyra_app (lot H2) : la connexion d'administration du test prend le rôle
 * vyra_app dès son ouverture ; l'API n'a alors que les droits de la matrice (009_core_privileges), comme en
 * production. Aucun mot de passe de rôle n'est nécessaire.
 */
export function appPool(url = TEST_DB, role = "vyra_app"): Db {
  const pool = createPool(url);
  pool.on("connect", (c) => void c.query(`SET ROLE ${role}`));
  return pool;
}

/** Base de test remise à zéro (schémas vyra et public), migrations appliquées, application construite. */
export async function setup(overrides: Record<string, unknown> = {}): Promise<Ctx> {
  const db = createPool(TEST_DB);
  await ensureRoles(db);
  await db.query("DROP SCHEMA IF EXISTS vyra CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  // Comme en production : base préparée par l'administrateur, migrations par vyra_migrator sous le rôle vyra_owner.
  await db.query(fs.readFileSync(SETUP_SQL, "utf8"));
  const mig = appPool(TEST_DB, "vyra_migrator");
  try {
    await migrate(mig, () => {}, { setRole: "vyra_owner" });
  } finally {
    await mig.end();
  }
  const appDb = appPool();
  const sysDb = appPool(TEST_DB, "vyra_system");
  const workerDb = appPool(TEST_DB, "vyra_worker");
  const pools = { db: appDb, sys: sysDb, worker: workerDb };
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-test-storage-"));
  const cfg = loadConfig({ NODE_ENV: "test" } as any, {
    DATABASE_URL: TEST_DB,
    STORAGE_DIR: storageDir,
    LOG_LEVEL: "silent",
    PUBLIC_URL: "http://vyra.test",
    AUTH_RATE_LIMIT: 10_000,
    ...overrides,
  } as any);
  const app = await buildApp({ cfg, ...pools });
  await app.ready();
  return { app, db, appDb, sysDb, workerDb, pools, storageDir };
}

export async function teardown(ctx: Ctx) {
  await ctx.app.close();
  await Promise.all([ctx.appDb.end(), ctx.sysDb.end(), ctx.workerDb.end()]);
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
  const db = (app as any).worker as Db; // lecture de la file d'e-mails : vyra_worker (lot H3)
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
