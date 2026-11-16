// Mesure des performances de l'API sur une base locale jetable (lot H6). Compare deux versions du code sur la
// même machine : par exemple le lot H4 (sans RLS) et le lot H5 (RLS forcée, contexte vérifié par ctx_user()).
//
// Usage : npx tsx scripts/bench-api.mts <racine du code à mesurer> <étiquette>
//   BENCH_DATABASE_URL (superutilisateur d'une instance LOCALE ; défaut postgres://vyra:vyra@127.0.0.1:5432/vyra_bench)
// La base est recréée à chaque passage. Les requêtes passent par app.inject (sans réseau), sous les vrais rôles
// (vyra_app, vyra_system, vyra_worker par SET ROLE), avec la limitation de débit en base comme en production ;
// chaque requête porte une adresse IP distincte pour ne pas être freinée par la limite de 600 requêtes/min.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import pg from "pg";

const root = path.resolve(process.argv[2] ?? ".");
const label = process.argv[3] ?? path.basename(root);
const URL_ = process.env.BENCH_DATABASE_URL ?? "postgres://vyra:vyra@127.0.0.1:5432/vyra_bench";
const u = new URL(URL_);
if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("Instance non locale : mesure refusée.");
const imp = (p: string) => import(pathToFileURL(path.join(root, p)).href);

const { createPool } = await imp("apps/api/src/db/pool.ts");
const { migrate } = await imp("apps/api/src/db/migrations.ts");
const { buildApp } = await imp("apps/api/src/app.ts");
const { loadConfig } = await imp("apps/api/src/config.ts");

// 1. Base neuve, préparée comme en production, migrée par vyra_migrator sous vyra_owner.
const admin = new pg.Client({ connectionString: URL_.replace(/\/[^/]+$/, "/postgres") });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${u.pathname.slice(1)} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${u.pathname.slice(1)}`);
await admin.query(fs.readFileSync(path.join(root, "scripts/db/roles.sql"), "utf8"));
await admin.end();
const setup = new pg.Client({ connectionString: URL_ });
await setup.connect();
await setup.query(fs.readFileSync(path.join(root, "scripts/db/database-setup.sql"), "utf8"));
await setup.end();
const asRole = (role: string) => {
  const p = createPool(URL_);
  p.on("connect", (c: pg.PoolClient) => void c.query(`SET ROLE ${role}`));
  return p;
};
const mig = asRole("vyra_migrator");
await migrate(mig, () => {}, { setRole: "vyra_owner" });
await mig.end();

const pools = { db: asRole("vyra_app"), sys: asRole("vyra_system"), worker: asRole("vyra_worker") };
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-bench-"));
const cfg = loadConfig({ NODE_ENV: "test" } as any, { DATABASE_URL: URL_, STORAGE_DIR: storage, LOG_LEVEL: "silent", PUBLIC_URL: "http://vyra.test", AUTH_RATE_LIMIT: 1_000_000 } as any);
const app = await buildApp({ cfg, ...pools });
await app.ready();

let ipn = 0;
const ip = () => `10.${(++ipn >> 16) & 255}.${(ipn >> 8) & 255}.${ipn & 255}`;
let cookie = "";
const call = async (method: string, url: string, body?: unknown) => {
  const r = await app.inject({ method: method as any, url, remoteAddress: ip(), payload: body as any, headers: { "x-vyra-client": "web", ...(cookie ? { cookie } : {}) } });
  const set = r.cookies.find((c) => c.name === "vyra_session");
  if (set) cookie = `vyra_session=${set.value}`;
  if (r.statusCode >= 400) throw new Error(`${method} ${url} : ${r.statusCode} ${r.body.slice(0, 200)}`);
  return r;
};

// 2. Un compte, 20 projets avec un motif réaliste (10 objets), comme un utilisateur actif.
const email = "bench@example.com";
await call("POST", "/api/auth/signup", { email, password: "un-mot-de-passe-solide", displayName: "Banc", acceptTerms: true });
const { rows } = await pools.worker.query("SELECT body_text FROM email_outbox WHERE to_email = $1", [email]);
await call("POST", "/api/auth/verify-email", { token: /token=([A-Za-z0-9_-]+)/.exec(rows[0].body_text)![1] });
const ids: string[] = [];
for (let i = 0; i < 20; i++) ids.push((await call("POST", "/api/projects", { name: `Projet ${i}`, design: null })).json().project.id);

// 3. Mesures : latence séquentielle (médiane, 95e centile) puis débit avec 20 requêtes simultanées.
async function measure(name: string, n: number, fn: (i: number) => Promise<unknown>) {
  for (let i = 0; i < Math.min(100, n); i++) await fn(i); // chauffe
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await fn(i);
    t.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  t.sort((a, b) => a - b);
  return { name, n, p50: +t[Math.floor(n * 0.5)].toFixed(3), p95: +t[Math.floor(n * 0.95)].toFixed(3), mean: +(t.reduce((a, b) => a + b, 0) / n).toFixed(3) };
}
let rev = 1;
const results = [
  await measure("GET /api/projects (liste de 20)", 2000, () => call("GET", "/api/projects")),
  await measure("GET /api/projects/:id", 2000, (i) => call("GET", `/api/projects/${ids[i % 20]}`)),
  await measure("PATCH /api/projects/:id (enregistrement)", 500, async () => {
    const r = await call("PATCH", `/api/projects/${ids[0]}`, { baseRevision: rev, name: `Projet 0 v${rev}` });
    rev = r.json().project.revision;
  }),
  await measure("GET /api/me/sessions", 1000, () => call("GET", "/api/me/sessions")),
  await measure("GET /api/auth/me (session seule, sans withUser)", 2000, () => call("GET", "/api/auth/me")),
];
const N = 2000, C = 20;
let next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: C }, async () => { while (next++ < N) await call("GET", "/api/projects"); }));
const throughput = Math.round(N / ((Date.now() - t0) / 1000));

console.log(JSON.stringify({ label, results, throughput: { name: `GET /api/projects, ${C} simultanées`, n: N, perSecond: throughput } }));
await app.close();
await Promise.all(Object.values(pools).map((p) => p.end()));
fs.rmSync(storage, { recursive: true, force: true });
